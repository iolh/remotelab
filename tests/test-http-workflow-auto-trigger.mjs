#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

function request(port, method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-auto-trigger-'));
  const configDir = join(home, '.config', 'remotelab');
  const localBin = join(home, '.local', 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({
      'test-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' },
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'tools.json'),
    JSON.stringify([
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
    ], null, 2),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'fake codex finished' }
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 }
  }));
}, 30);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  return { home };
}

async function createVisitorSessionDirect(home) {
  const previousHome = process.env.HOME;
  const previousSecureCookies = process.env.SECURE_COOKIES;
  process.env.HOME = home;
  process.env.SECURE_COOKIES = '0';
  try {
    const sessionManager = await import(`${pathToFileURL(join(repoRoot, 'chat', 'session-manager.mjs')).href}?autoTriggerTest=${Date.now()}`);
    return sessionManager.createSession(repoRoot, 'fake-codex', 'Visitor Auto Trigger', {
      visitorId: 'visitor-test',
      visitorName: 'Visitor',
      description: 'Visitor session',
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSecureCookies === undefined) delete process.env.SECURE_COOKIES;
    else process.env.SECURE_COOKIES = previousSecureCookies;
  }
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  await waitFor(async () => {
    try {
      const res = await request(port, 'GET', '/api/auth/me');
      return res.status === 200;
    } catch {
      return false;
    }
  }, 'server startup');

  return { child, getStderr: () => stderr };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function createSession(port, name, description = 'Workflow auto trigger test') {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name,
    description,
  });
  assert.equal(res.status, 201, 'create session should succeed');
  return res.json.session;
}

async function patchSession(port, sessionId, patch) {
  const res = await request(port, 'PATCH', `/api/sessions/${sessionId}`, patch);
  assert.equal(res.status, 200, 'patch session should succeed');
  return res.json.session;
}

async function startWorkflow(port, sessionId, goal) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/workflow/start`, {
    input: { goal },
    workflowCurrentTask: goal,
  });
  assert.equal(res.status, 200, 'workflow start should succeed');
  return res.json;
}

async function submitMessage(port, sessionId, requestId, text) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId,
    text,
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });
  assert.ok(res.status === 202 || res.status === 200, 'submit message should succeed');
  return res;
}

async function waitForRunTerminal(port, runId) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200 || !res.json?.run) return null;
    const state = String(res.json.run.state || '');
    if (['completed', 'failed', 'cancelled'].includes(state)) {
      return res.json.run;
    }
    return null;
  }, `run ${runId} terminal`);
}

async function main() {
  const { home } = setupTempHome();
  const visitorSession = await createVisitorSessionDirect(home);
  const port = await getAvailablePort();
  const server = await startServer({ home, port });

  try {
    const classifyRes = await request(
      port,
      'GET',
      `/api/workflow/classify?text=${encodeURIComponent('根据 Figma 设计稿重构搜索页交互，并评估筛选、空态、提交流程、错误提示、加载反馈和移动端适配的实现取舍。')}&folder=${encodeURIComponent(repoRoot)}`,
    );
    assert.equal(classifyRes.status, 200, 'classify endpoint should succeed');
    assert.equal(classifyRes.json?.mode, 'careful_deliberation', 'classify endpoint should reuse the server-side auto router');
    assert.equal(classifyRes.json?.confidence, 'high', 'classify endpoint should expose confidence');
    assert.match(classifyRes.json?.reason || '', /设计稿|交互/, 'classify endpoint should expose a readable reason');

    const quickSession = await createSession(port, 'Quick Auto Trigger');
    const quickRes = await submitMessage(
      port,
      quickSession.id,
      'req-quick',
      '修个 typo',
    );
    assert.equal(quickRes.json?.workflowAutoTriggered?.mode, 'quick_execute', 'simple tasks should auto-start the quick workflow');
    assert.equal(quickRes.json?.workflowAutoTriggered?.confidence, 'high', 'quick auto-start should expose classification confidence');
    assert.equal(quickRes.json?.session?.workflowDefinition?.mode, 'quick_execute', 'simple tasks should materialize the quick workflow definition');
    assert.notEqual(quickRes.json?.session?.pendingIntake, true, 'simple tasks should not leave a pending intake behind');
    assert.equal(quickRes.json?.run?.requestId, 'req-quick', 'quick auto-start should still preserve the original request id');
    await waitForRunTerminal(port, quickRes.json?.run?.id);

    const mediumSession = await createSession(port, 'Medium Confidence');
    const mediumRes = await submitMessage(
      port,
      mediumSession.id,
      'req-medium',
      [
        '需求如下：',
        '1. 调整搜索页结果列表布局',
        '2. 补齐筛选回填和提交按钮文案',
      ].join('\n'),
    );
    assert.equal(mediumRes.json?.workflowAutoTriggered, undefined, 'medium-confidence task signals should stay on the chat path');
    assert.equal(mediumRes.json?.session?.workflowDefinition, null, 'medium-confidence task signals should not implicitly create a workflow');
    assert.notEqual(mediumRes.json?.session?.pendingIntake, true, 'medium-confidence task signals should not open persisted intake implicitly');
    await waitForRunTerminal(port, mediumRes.json?.run?.id);

    const activeWorkflowSession = await createSession(port, 'Existing Workflow');
    await startWorkflow(port, activeWorkflowSession.id, '先进入工作流');
    const existingWorkflowRes = await submitMessage(
      port,
      activeWorkflowSession.id,
      'req-existing',
      '请根据 Figma 设计稿重构搜索页交互，并评估筛选、空态、提交流程、错误提示、加载反馈和移动端适配的实现取舍。',
    );
    assert.equal(existingWorkflowRes.json?.workflowAutoTriggered, undefined, 'sessions with an active workflow should never auto-trigger again');
    await waitForRunTerminal(port, existingWorkflowRes.json?.run?.id);

    const greetingSession = await createSession(port, 'Greeting Message');
    const greetingRes = await submitMessage(port, greetingSession.id, 'req-greeting', '你好');
    assert.equal(greetingRes.json?.workflowAutoTriggered, undefined, 'greetings must never trigger workflow intake or auto-start');
    assert.equal(greetingRes.json?.session?.workflowDefinition, null, 'greetings should stay on the normal chat path');
    assert.notEqual(greetingRes.json?.session?.pendingIntake, true, 'greetings should not create a persisted intake');
    await waitForRunTerminal(port, greetingRes.json?.run?.id);

    const questionSession = await createSession(port, 'Open Question');
    const questionRes = await submitMessage(port, questionSession.id, 'req-question', '这个 bug 怎么回事？');
    assert.equal(questionRes.json?.workflowAutoTriggered, undefined, 'open-ended questions must not be misclassified as workflow intent');
    assert.equal(questionRes.json?.session?.workflowDefinition, null, 'open-ended questions should remain plain chat');
    assert.notEqual(questionRes.json?.session?.pendingIntake, true, 'open-ended questions should not create a persisted intake');
    await waitForRunTerminal(port, questionRes.json?.run?.id);

    const optOutSession = await createSession(port, 'Opt Out');
    const patchedOptOut = await patchSession(port, optOutSession.id, { workflowAutoTriggerDisabled: true });
    assert.equal(patchedOptOut.workflowAutoTriggerDisabled, true, 'session opt-out should persist on the session record');
    const optOutRes = await submitMessage(
      port,
      optOutSession.id,
      'req-opt-out',
      '请根据 Figma 设计稿重构搜索页交互，并评估筛选、空态、提交流程、错误提示、加载反馈和移动端适配的实现取舍。',
    );
    assert.equal(optOutRes.json?.workflowAutoTriggered, undefined, 'opted-out sessions should not auto-trigger');
    assert.equal(optOutRes.json?.session?.workflowDefinition, null, 'opted-out sessions should remain plain chat sessions');
    await waitForRunTerminal(port, optOutRes.json?.run?.id);

    const visitorRes = await submitMessage(
      port,
      visitorSession.id,
      'req-visitor',
      '请根据 Figma 设计稿重构搜索页交互，并评估筛选、空态、提交流程、错误提示、加载反馈和移动端适配的实现取舍。',
    );
    assert.equal(visitorRes.json?.workflowAutoTriggered, undefined, 'visitor sessions should never auto-trigger');
    assert.equal(visitorRes.json?.session?.workflowDefinition, null, 'visitor sessions should stay outside workflow auto-trigger');
    await waitForRunTerminal(port, visitorRes.json?.run?.id);

    console.log('test-http-workflow-auto-trigger: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('test-http-workflow-auto-trigger: failed');
  console.error(error);
  process.exitCode = 1;
});
