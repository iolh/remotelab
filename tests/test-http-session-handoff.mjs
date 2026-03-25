#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function randomPort() {
  return 36000 + Math.floor(Math.random() * 2000);
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
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-handoff-'));
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
      {
        id: 'fake-codex-invalid',
        name: 'Fake Codex Invalid',
        command: 'fake-codex-invalid',
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
const prompt = process.argv.slice(2).join(' ');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  let text = 'finished from fake codex';
  if (prompt.includes('<verification_result>')) {
    text = [
      '自动验收通过，核心路径可继续推进。',
      '<verification_result>',
      JSON.stringify({
        summary: '自动验收通过，核心路径可继续推进。',
        recommendation: 'ok',
        confidence: 'high',
        validated: ['主流程冒烟'],
        evidence: ['fake-codex smoke'],
      }),
      '</verification_result>',
    ].join('\\n');
  } else if (prompt.includes('<delivery_summary>')) {
    text = [
      '已完成最终收口。',
      '<delivery_summary>',
      JSON.stringify({
        summary: '最终交付已收口，主流程可进入完成态。',
        completed: ['吸收辅助结论', '更新主线输出'],
        remainingRisks: ['仍建议人工做一次页面级回看'],
      }),
      '</delivery_summary>',
    ].join('\\n');
  } else if (prompt.includes('验收结果已自动回灌') || prompt.includes('辅助结论已自动回灌')) {
    text = [
      '已吸收验收结论，并根据结果继续推进主线。',
      '<delivery_summary>',
      JSON.stringify({
        summary: '主线已吸收验收结论并完成收口。',
        completed: ['吸收辅助结论', '完成最终收口'],
        remainingRisks: ['建议人工做一次页面级回看'],
      }),
      '</delivery_summary>',
    ].join('\\n');
  }
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 50);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  writeFileSync(
    join(localBin, 'fake-codex-invalid'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test-invalid' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: '验收已结束，但这次没有附带结构化结果。' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 50);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex-invalid'), 0o755);
  return { home };
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

async function createSession(port, {
  name,
  tool = 'fake-codex',
  appName = '',
  group = 'Tests',
  description = 'Workflow handoff',
} = {}) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool,
    name,
    appName,
    group,
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

async function submitMessage(port, sessionId, requestId, text, options = {}) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId,
    text,
    tool: typeof options.tool === 'string' ? options.tool : 'fake-codex',
    model: typeof options.model === 'string' ? options.model : 'fake-model',
    effort: typeof options.effort === 'string' ? options.effort : 'low',
  });
  assert.ok(res.status === 202 || res.status === 200, 'submit message should succeed');
  return res.json;
}

async function waitForRunTerminal(port, runId) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return null;
    const state = res.json?.run?.state || '';
    return ['completed', 'failed', 'cancelled'].includes(state) ? res.json.run : null;
  }, `run ${runId} terminal`);
}

async function getSessionDetail(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}`);
  assert.equal(res.status, 200, 'session detail should load');
  return res.json.session;
}

async function startWorkflow(port, sessionId, body) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/workflow/start`, body);
  assert.equal(res.status, 200, 'workflow start should succeed');
  return res.json;
}

async function main() {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });

  try {
    const mainline = await createSession(port, { name: '执行 · 搜索页改造', appName: '执行' });
    assert.equal(mainline.currentTask, '搜索页改造', 'mainline sessions should derive currentTask from the session name');

    const mainlineSubmit = await submitMessage(port, mainline.id, 'req-mainline', '完成搜索页改造');
    const mainlineRun = await waitForRunTerminal(port, mainlineSubmit.run?.id);
    assert.equal(mainlineRun.state, 'completed', 'mainline run should complete');

    const mainlineAfterRun = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      return detail?.workflowSuggestion?.type === 'suggest_verification' ? detail : null;
    }, 'workflow suggestion after mainline run');
    assert.equal(mainlineAfterRun.currentTask, '完成搜索页改造', 'mainline sessions should persist the latest explicit currentTask');
    assert.equal(mainlineAfterRun.workflowSuggestion?.status, 'pending', 'completed mainline runs should surface a pending verification suggestion');

    const acceptedSuggestion = await request(port, 'POST', `/api/sessions/${mainline.id}/workflow-suggestion/accept`);
    assert.equal(acceptedSuggestion.status, 201, 'accepting a workflow suggestion should succeed');
    assert.equal(acceptedSuggestion.json?.session?.appName, '验收', 'accepting the suggestion should spawn a verification session');
    assert.equal(
      acceptedSuggestion.json?.session?.handoffTargetSessionId,
      mainline.id,
      'spawned verification sessions should point back to the mainline',
    );

    const verificationRun = await waitForRunTerminal(port, acceptedSuggestion.json?.run?.id);
    assert.equal(verificationRun.state, 'completed', 'auto-started verification runs should complete');

    const mainlineAfterAbsorb = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const conclusions = Array.isArray(detail?.workflowPendingConclusions) ? detail.workflowPendingConclusions : [];
      return conclusions.some((entry) => entry?.status === 'accepted') ? detail : null;
    }, 'accepted verification handoff on the mainline');
    const acceptedConclusion = mainlineAfterAbsorb.workflowPendingConclusions[0];
    assert.equal(acceptedConclusion.handoffType, 'verification_result', 'accepted conclusions should retain the handoff type');
    assert.equal(acceptedConclusion.status, 'accepted', 'high-confidence verification results should auto-accept');
    assert.equal(
      acceptedConclusion.sourceSessionId,
      acceptedSuggestion.json?.session?.id,
      'accepted conclusions should point back to the verification session',
    );
    assert.equal(mainlineAfterAbsorb.workflowState, 'done', 'auto-absorbed verification should drive the mainline to done');
    assert.equal(mainlineAfterAbsorb.workflowSuggestion ?? null, null, 'accepting the suggestion should clear it from the mainline');

    const plainSession = await createSession(port, { name: '普通会话' });
    const startedWorkflow = await startWorkflow(port, plainSession.id, {
      input: { goal: '把当前会话切进主线 workflow' },
      currentTask: '把当前会话切进主线 workflow',
      kickoffMessage: '开始推进',
      appNames: ['执行'],
    });
    assert.equal(
      startedWorkflow.session?.currentTask,
      '把当前会话切进主线 workflow',
      'workflow/start should persist currentTask on the session detail',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(startedWorkflow.session || {}, 'workflowDefinition'),
      false,
      'workflow/start should not materialize legacy workflowDefinition metadata',
    );
    await waitForRunTerminal(port, startedWorkflow.run?.id);

    const invalidMainline = await createSession(port, { name: '执行 · 认证模块改造', appName: '执行' });
    const invalidVerification = await createSession(port, {
      name: '验收 · 认证模块改造',
      appName: '验收',
      tool: 'fake-codex-invalid',
    });
    const patchedInvalidVerification = await patchSession(port, invalidVerification.id, {
      handoffTargetSessionId: invalidMainline.id,
    });
    assert.equal(
      patchedInvalidVerification.handoffTargetSessionId,
      invalidMainline.id,
      'verification sessions should allow wiring a handoff target',
    );

    const invalidSubmit = await submitMessage(
      port,
      invalidVerification.id,
      'req-invalid-verification',
      '请开始验收',
      { tool: 'fake-codex-invalid' },
    );
    const invalidRun = await waitForRunTerminal(port, invalidSubmit.run?.id);
    assert.equal(invalidRun.state, 'completed', 'invalid verification run should still complete');

    const invalidOutcome = await waitFor(async () => {
      const detail = await getSessionDetail(port, invalidMainline.id);
      const conclusions = Array.isArray(detail?.workflowPendingConclusions) ? detail.workflowPendingConclusions : [];
      return conclusions.some((entry) => entry?.status === 'needs_decision') ? detail : null;
    }, 'needs_decision handoff after invalid verification result');
    const pendingDecision = invalidOutcome.workflowPendingConclusions[0];
    assert.equal(
      pendingDecision.handoffType,
      'verification_result',
      'invalid verification handoffs should still identify as verification_result',
    );
    assert.equal(
      pendingDecision.status,
      'needs_decision',
      'invalid or incomplete verification payloads should pause for manual decision',
    );
    assert.equal(
      invalidOutcome.workflowState,
      'waiting_user',
      'manual review handoffs should move the mainline into waiting_user',
    );

    console.log('test-http-session-handoff: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('test-http-session-handoff: failed');
  console.error(error);
  process.exitCode = 1;
});
