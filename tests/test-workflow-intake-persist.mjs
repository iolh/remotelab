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
  const home = mkdtempSync(join(tmpdir(), 'remotelab-workflow-intake-'));
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
    const sessionManager = await import(`${pathToFileURL(join(repoRoot, 'chat', 'session-manager.mjs')).href}?workflowIntakePersist=${Date.now()}`);
    return sessionManager.createSession(repoRoot, 'fake-codex', 'Visitor Intake', {
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

async function createSession(port, name, description = 'Workflow intake persistence test') {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name,
    description,
  });
  assert.equal(res.status, 201, 'create session should succeed');
  return res.json.session;
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

async function confirmIntake(port, sessionId, input) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/workflow/intake/confirm`, {
    input,
  });
  return res;
}

async function cancelIntake(port, sessionId) {
  return request(port, 'POST', `/api/sessions/${sessionId}/workflow/intake/cancel`, {});
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

async function getSession(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}`);
  assert.equal(res.status, 200, 'session detail should succeed');
  return res.json.session;
}

async function listSessions(port) {
  const res = await request(port, 'GET', '/api/sessions');
  assert.equal(res.status, 200, 'session list should succeed');
  return Array.isArray(res.json.sessions) ? res.json.sessions : [];
}

async function getAllEvents(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}/events?filter=all`);
  assert.equal(res.status, 200, 'all-events request should succeed');
  return Array.isArray(res.json.events) ? res.json.events : [];
}

function findLatestAssistantIntake(events, phase = '') {
  const matches = (Array.isArray(events) ? events : []).filter((event) => (
    event?.type === 'message'
    && event.role === 'assistant'
    && event?.metadata?.workflowIntake
    && (!phase || event.metadata.workflowIntake.phase === phase)
  ));
  return matches[matches.length - 1] || null;
}

function findLatestUserIntakeReply(events) {
  const matches = (Array.isArray(events) ? events : []).filter((event) => (
    event?.type === 'message'
    && event.role === 'user'
    && event?.metadata?.workflowIntakeReply
  ));
  return matches[matches.length - 1] || null;
}

async function main() {
  const { home } = setupTempHome();
  const visitorSession = await createVisitorSessionDirect(home);
  const port = await getAvailablePort();
  const server = await startServer({ home, port });

  try {
    const complexSession = await createSession(port, 'Persisted Intake');
    const firstRes = await submitMessage(port, complexSession.id, 'req-intake-1', '重构认证模块');
    assert.equal(firstRes.json?.workflowAutoTriggered, undefined, 'complex tasks should enter persisted intake instead of direct auto-start');
    assert.equal(firstRes.json?.run, null, 'persisted intake should not create a provider run before confirmation');
    assert.equal(firstRes.json?.session?.pendingIntake, true, 'complex tasks should mark the session as having pending intake');
    assert.equal(firstRes.json?.session?.workflowDefinition, null, 'persisted intake should not materialize workflow definition before confirmation');

    const detailAfterClarify = await getSession(port, complexSession.id);
    assert.equal(detailAfterClarify.pendingIntake, true, 'session detail should preserve pending intake across refreshes');
    const listedAfterClarify = (await listSessions(port)).find((session) => session.id === complexSession.id);
    assert.equal(listedAfterClarify?.pendingIntake, true, 'session list should expose pending intake for cross-tab recovery');

    const clarifyEvents = await getAllEvents(port, complexSession.id);
    const clarifyPrompt = findLatestAssistantIntake(clarifyEvents, 'clarify');
    assert.ok(clarifyPrompt, 'complex tasks should persist an assistant clarify message');
    assert.match(clarifyPrompt.content || '', /边界|不能动/, 'clarify intake message should ask for constraints');
    assert.equal(clarifyPrompt.metadata.workflowIntake.complexityLevel, 'high');
    assert.deepEqual(
      clarifyPrompt.metadata.workflowIntake.missingFields,
      ['constraints'],
      'clarify intake metadata should record the missing constraints field',
    );
    assert.equal(clarifyPrompt.metadata.workflowIntake.inputSnapshot.goal, '重构认证模块');

    const prematureConfirmRes = await confirmIntake(port, complexSession.id, {
      goal: '重构认证模块',
      project: repoRoot,
    });
    assert.equal(prematureConfirmRes.status, 400, 'confirm should reject incomplete high-complexity intake payloads');
    assert.match(prematureConfirmRes.json?.error || '', /incomplete|constraints/i, 'confirm errors should explain the missing field');

    const replyRes = await submitMessage(port, complexSession.id, 'req-intake-2', '不改数据库 schema');
    assert.equal(replyRes.json?.run, null, 'clarify replies should stay inside intake until explicit confirmation');
    assert.equal(replyRes.json?.session?.pendingIntake, true, 'clarify replies should keep the session in pending intake');

    const confirmEvents = await getAllEvents(port, complexSession.id);
    const replyEvent = findLatestUserIntakeReply(confirmEvents);
    assert.ok(replyEvent, 'clarify replies should be persisted as normal user messages with workflow intake reply metadata');
    assert.equal(replyEvent.metadata.workflowIntakeReply.phase, 'clarify');

    const confirmPrompt = findLatestAssistantIntake(confirmEvents, 'confirm');
    assert.ok(confirmPrompt, 'completing intake should persist a confirm message');
    assert.match(confirmPrompt.content || '', /点“开始”即可|确认后开始/, 'confirm intake message should invite the user to start the workflow');
    assert.equal(confirmPrompt.metadata.workflowIntake.inputSnapshot.constraints, '不改数据库 schema');
    assert.equal(confirmPrompt.metadata.workflowIntake.classification.mode, 'careful_deliberation');

    const confirmRes = await confirmIntake(port, complexSession.id, {
      goal: '重构认证模块',
      project: repoRoot,
      constraints: '不改数据库 schema',
    });
    assert.equal(confirmRes.status, 200, 'confirm endpoint should start the workflow once intake is complete');
    assert.equal(confirmRes.json?.session?.pendingIntake, false, 'confirming intake should clear pending intake');
    assert.equal(confirmRes.json?.session?.workflowDefinition?.mode, 'careful_deliberation', 'confirming intake should start the classified workflow mode');
    assert.ok(confirmRes.json?.run?.id, 'confirming intake should return the started run');
    await waitForRunTerminal(port, confirmRes.json.run.id);

    const directSession = await createSession(port, 'Quick Execute');
    const quickRes = await submitMessage(port, directSession.id, 'req-quick', '修个 typo');
    assert.equal(quickRes.json?.workflowAutoTriggered?.mode, 'quick_execute', 'simple tasks should still skip intake and auto-start directly');
    assert.notEqual(quickRes.json?.session?.pendingIntake, true, 'simple tasks should not leave pending intake state behind');
    await waitForRunTerminal(port, quickRes.json?.run?.id);

    const greetingSession = await createSession(port, 'Greeting');
    const greetingRes = await submitMessage(port, greetingSession.id, 'req-greeting', '你好');
    assert.equal(greetingRes.json?.workflowAutoTriggered, undefined, 'greetings should not enter intake');
    assert.equal(greetingRes.json?.session?.workflowDefinition, null, 'greetings should stay in normal chat flow');
    assert.notEqual(greetingRes.json?.session?.pendingIntake, true, 'greetings should not create pending intake state');
    await waitForRunTerminal(port, greetingRes.json?.run?.id);

    const cancelSession = await createSession(port, 'Cancelled Intake');
    const cancelStartRes = await submitMessage(port, cancelSession.id, 'req-cancel-1', '重构认证模块');
    assert.equal(cancelStartRes.json?.session?.pendingIntake, true, 'cancel scenario should start with pending intake');
    const cancelRes = await cancelIntake(port, cancelSession.id);
    assert.equal(cancelRes.status, 200, 'cancel endpoint should succeed');
    assert.equal(cancelRes.json?.session?.pendingIntake, false, 'cancel endpoint should clear pending intake');
    const cancelEvents = await getAllEvents(port, cancelSession.id);
    const cancelStatus = cancelEvents.find((event) => event?.type === 'status' && /已取消本次 workflow intake/.test(event?.content || ''));
    assert.ok(cancelStatus, 'cancel endpoint should persist a status event for later review');

    const visitorRes = await submitMessage(port, visitorSession.id, 'req-visitor', '重构认证模块');
    assert.equal(visitorRes.json?.workflowAutoTriggered, undefined, 'visitor sessions should remain outside persisted intake');
    assert.notEqual(visitorRes.json?.session?.pendingIntake, true, 'visitor sessions should not gain pending intake');
    await waitForRunTerminal(port, visitorRes.json?.run?.id);

    console.log('test-workflow-intake-persist: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('test-workflow-intake-persist: failed');
  console.error(error);
  process.exitCode = 1;
});
