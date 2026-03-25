#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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
      const port = server.address()?.port || 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 15000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

function request(port, method, path, body = null) {
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
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-handoff-lifecycle-'));
  const configDir = join(home, '.config', 'remotelab');
  const localBin = join(home, '.local', 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({ 'test-session': { expiry: Date.now() + 3600000, role: 'owner' } }),
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
        id: 'fake-codex-risk',
        name: 'Fake Codex Risk',
        command: 'fake-codex-risk',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
    ]),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex'),
    `#!/usr/bin/env node
const prompt = process.argv.slice(2).join(' ');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-mainline' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  let text = '完成普通执行。';
  if (prompt.includes('验收结果已自动回灌') || prompt.includes('辅助结论已自动回灌')) {
    text = [
      '已吸收验收结论并完成收口。',
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
}, 30);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  writeFileSync(
    join(localBin, 'fake-codex-risk'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-risk' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: '需要确认：虽然主路径通过，但仍存在未验证边界。' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 30);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex-risk'), 0o755);
  return { home };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, CHAT_PORT: String(port), SECURE_COOKIES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  await waitFor(async () => {
    try {
      return (await request(port, 'GET', '/api/auth/me')).status === 200;
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
  description = 'Workflow handoff lifecycle',
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

async function submitMessage(port, sessionId, requestId, text, tool = 'fake-codex') {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId,
    text,
    tool,
    model: 'fake-model',
    effort: 'low',
  });
  assert.ok(res.status === 202 || res.status === 200, 'submit message should succeed');
  return res.json.run;
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

async function handoffResult(port, sessionId, body) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/handoff`, body);
  assert.equal(res.status, 201, 'handoff should succeed');
  return res.json;
}

async function updateConclusionStatus(port, sessionId, conclusionId, status) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/conclusions/${conclusionId}`, { status });
  assert.equal(res.status, 200, 'updating the workflow conclusion should succeed');
  return res.json.session;
}

async function main() {
  const { home } = setupTempHome();
  const port = await getAvailablePort();
  const server = await startServer({ home, port });

  try {
    const mainline = await createSession(port, { name: '执行 · 搜索页改造', appName: '执行' });
    const riskSource = await createSession(port, {
      name: '验收 · 搜索页改造',
      appName: '验收',
      tool: 'fake-codex-risk',
    });

    const riskRun = await submitMessage(port, riskSource.id, 'req-risk', '请检查当前结果', 'fake-codex-risk');
    await waitForRunTerminal(port, riskRun.id);

    const pendingHandoff = await handoffResult(port, riskSource.id, {
      targetSessionId: mainline.id,
      handoffType: 'verification_result',
      sourceRunId: riskRun.id,
      summary: '核心路径通过，但边界仍需确认。',
      payload: {
        summary: '核心路径通过，但边界仍需确认。',
        recommendation: 'ok',
        confidence: 'high',
        validated: ['主流程冒烟'],
        evidence: ['fake-codex-risk'],
      },
    });
    assert.equal(pendingHandoff.handoff?.status, 'pending', 'risk-bearing handoffs should stay pending before manual acceptance');

    const pendingDetail = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const conclusions = Array.isArray(detail?.workflowPendingConclusions) ? detail.workflowPendingConclusions : [];
      return conclusions.some((entry) => entry?.status === 'pending') ? detail : null;
    }, 'pending verification handoff');
    const pendingConclusion = pendingDetail.workflowPendingConclusions.find((entry) => entry?.status === 'pending');
    assert.equal(pendingConclusion.handoffType, 'verification_result', 'pending handoffs should preserve their typed contract');

    await updateConclusionStatus(port, mainline.id, pendingConclusion.id, 'accepted');

    const acceptedDetail = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const conclusions = Array.isArray(detail?.workflowPendingConclusions) ? detail.workflowPendingConclusions : [];
      const accepted = conclusions.find((entry) => entry?.id === pendingConclusion.id && entry?.status === 'accepted');
      if (!accepted) return null;
      return detail?.workflowState === 'done' ? detail : null;
    }, 'accepted handoff after auto-absorb');
    const acceptedConclusion = acceptedDetail.workflowPendingConclusions.find((entry) => entry?.id === pendingConclusion.id);
    assert.equal(acceptedConclusion.status, 'accepted', 'accepted handoffs should persist the accepted terminal state');
    assert.equal(acceptedDetail.workflowState, 'done', 'manual acceptance should still drive the mainline to done after auto-absorb');

    const reviewMainline = await createSession(port, { name: '执行 · 认证模块改造', appName: '执行' });
    const reviewSource = await createSession(port, { name: '验收 · 认证模块改造', appName: '验收' });

    const firstNeedsDecision = await handoffResult(port, reviewSource.id, {
      targetSessionId: reviewMainline.id,
      handoffType: 'verification_result',
      summary: '首轮验收未完成，建议先补齐回归测试。',
      payload: {
        summary: '首轮验收未完成，建议先补齐回归测试。',
        recommendation: 'needs_fix',
        confidence: 'medium',
      },
    });
    assert.equal(firstNeedsDecision.handoff?.status, 'needs_decision', 'low-confidence verification handoffs should require human review');

    const firstDecisionDetail = await waitFor(async () => {
      const detail = await getSessionDetail(port, reviewMainline.id);
      const conclusions = Array.isArray(detail?.workflowPendingConclusions) ? detail.workflowPendingConclusions : [];
      return conclusions.some((entry) => entry?.status === 'needs_decision') ? detail : null;
    }, 'first needs_decision handoff');
    const firstConclusion = firstDecisionDetail.workflowPendingConclusions.find((entry) => entry?.status === 'needs_decision');
    assert.equal(firstDecisionDetail.workflowState, 'waiting_user', 'needs_decision handoffs should move the mainline into waiting_user');

    await handoffResult(port, reviewSource.id, {
      targetSessionId: reviewMainline.id,
      handoffType: 'verification_result',
      summary: '第二轮验收仍需人工确认，但已经替换掉旧结论。',
      payload: {
        summary: '第二轮验收仍需人工确认，但已经替换掉旧结论。',
        recommendation: 'needs_more_validation',
        confidence: 'medium',
      },
    });

    const supersededDetail = await waitFor(async () => {
      const detail = await getSessionDetail(port, reviewMainline.id);
      const conclusions = Array.isArray(detail?.workflowPendingConclusions) ? detail.workflowPendingConclusions : [];
      const superseded = conclusions.find((entry) => entry?.id === firstConclusion.id && entry?.status === 'superseded');
      const latest = conclusions.find((entry) => entry?.status === 'needs_decision' && entry?.id !== firstConclusion.id);
      return superseded && latest ? detail : null;
    }, 'superseded lifecycle after repeated handoff');

    const supersededConclusion = supersededDetail.workflowPendingConclusions.find((entry) => entry?.id === firstConclusion.id);
    const replacementConclusion = supersededDetail.workflowPendingConclusions.find((entry) => entry?.status === 'needs_decision');
    assert.equal(supersededConclusion.status, 'superseded', 'a newer handoff from the same source and type should supersede the prior unresolved one');
    assert.equal(replacementConclusion.supersedesHandoffId, firstConclusion.id, 'replacement handoffs should record the superseded predecessor');
    assert.equal(replacementConclusion.round, 2, 'replacement handoffs should increment the round counter');
    assert.equal(supersededDetail.workflowState, 'waiting_user', 'the replacement needs_decision handoff should keep the mainline waiting on the user');

    console.log('test-handoff-lifecycle: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('test-handoff-lifecycle: failed');
  console.error(error);
  process.exitCode = 1;
});
