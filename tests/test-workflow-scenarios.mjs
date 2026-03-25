#!/usr/bin/env node
import assert from 'assert/strict';
import test from 'node:test';
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
const REMOVED_SESSION_FIELDS = [
  'workflowDefinition',
  'workflowMode',
  'workflowAutoRoute',
  'workflowTaskContract',
  'workflowTaskTrace',
  'workflowTraceBridge',
  'workflowAutoTriggerDisabled',
  'pendingIntake',
];

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
  const home = mkdtempSync(join(tmpdir(), 'remotelab-workflow-scenarios-'));
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
        id: 'fake-codex-decision',
        name: 'Fake Codex Decision',
        command: 'fake-codex-decision',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
      {
        id: 'fake-codex-parallel',
        name: 'Fake Codex Parallel',
        command: 'fake-codex-parallel',
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
  let text = '已完成修改，debounce 已从 300ms 调整为 500ms。';
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
  } else if (prompt.includes('验收结果已自动回灌') || prompt.includes('辅助结论已自动回灌')) {
    text = [
      '已吸收辅助结论，并根据结果继续推进主线。',
      '<delivery_summary>',
      JSON.stringify({
        summary: '主线已吸收辅助结论并完成收口。',
        completed: ['吸收辅助结论', '完成最终收口'],
        remainingRisks: ['建议人工做一次页面级回看'],
      }),
      '</delivery_summary>',
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
  }
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 40);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  writeFileSync(
    join(localBin, 'fake-codex-decision'),
    `#!/usr/bin/env node
const prompt = process.argv.slice(2).join(' ');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-decision' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  let text = [
    '建议分三期迁移，第一期先迁内部 API。',
    '<decision_result>',
    JSON.stringify({
      summary: '建议分三期迁移，第一期先迁内部 API。',
      recommendation: '分三期迁移，先迁内部 API',
      confidence: 'medium',
      decisionNeeded: ['是否接受额外一周工期'],
      alternativesConsidered: ['全量一次迁移（风险过高）'],
      risks: ['第三方 SDK 兼容性'],
    }),
    '</decision_result>',
  ].join('\\n');
  if (prompt.includes('验收结果已自动回灌') || prompt.includes('辅助结论已自动回灌')) {
    text = [
      '已吸收辅助结论并完成收口。',
      '<delivery_summary>',
      JSON.stringify({
        summary: '主线已吸收辅助结论并完成收口。',
        completed: ['吸收辅助结论', '完成最终收口'],
        remainingRisks: ['建议人工复核最终方向'],
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
}, 40);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex-decision'), 0o755);
  writeFileSync(
    join(localBin, 'fake-codex-parallel'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-parallel' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: '已完成本仓库的 Vue3 组合式 API 升级。' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 30);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex-parallel'), 0o755);
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
  description = 'Workflow scenario',
} = {}) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool,
    name,
    appName,
    group,
    description,
  });
  assert.equal(res.status, 201, `create session should succeed for ${name}`);
  return res.json.session;
}

async function patchSession(port, sessionId, patch) {
  const res = await request(port, 'PATCH', `/api/sessions/${sessionId}`, patch);
  assert.equal(res.status, 200, `patch session should succeed for ${sessionId}`);
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
  assert.ok(res.status === 202 || res.status === 200, `submit message should succeed for ${sessionId}`);
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
  assert.equal(res.status, 200, `session detail should load for ${sessionId}`);
  return res.json.session;
}

async function listSessions(port) {
  const res = await request(port, 'GET', '/api/sessions');
  assert.equal(res.status, 200, 'session list should load');
  return Array.isArray(res.json?.sessions) ? res.json.sessions : [];
}

async function getEvents(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}/events?filter=all`);
  assert.equal(res.status, 200, `events should load for ${sessionId}`);
  return Array.isArray(res.json?.events) ? res.json.events : [];
}

async function acceptWorkflowSuggestion(port, sessionId) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/workflow-suggestion/accept`);
  assert.equal(res.status, 201, `workflow suggestion accept should succeed for ${sessionId}`);
  return res.json;
}

async function handoffResult(port, sessionId, body) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/handoff`, body);
  assert.equal(res.status, 201, `handoff should succeed for ${sessionId}`);
  return res.json;
}

async function updateConclusionStatus(port, sessionId, conclusionId, status) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/conclusions/${conclusionId}`, { status });
  assert.equal(res.status, 200, `conclusion status update should succeed for ${sessionId}`);
  return res.json.session;
}

function assertRemovedFieldsAbsent(session, label) {
  for (const field of REMOVED_SESSION_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(session || {}, field),
      false,
      `${label} should not expose removed field ${field}`,
    );
  }
}

function findConclusion(session, predicate) {
  const conclusions = Array.isArray(session?.workflowPendingConclusions) ? session.workflowPendingConclusions : [];
  return conclusions.find(predicate) || null;
}

test('workflow-scenarios', async (t) => {
  const { home } = setupTempHome();
  const port = await getAvailablePort();
  const server = await startServer({ home, port });
  const state = {
    directSessionId: '',
    mainlineVerificationId: '',
    deliberationMainlineId: '',
    parallelMainlineId: '',
    scenario2CurrentTask: '',
  };

  t.after(async () => {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  });

  await t.test('scenario 1: direct execute without workflow', async () => {
    const session = await createSession(port, {
      name: '日常修改',
      tool: 'fake-codex',
      description: 'Scenario 1 direct execute',
    });
    state.directSessionId = session.id;

    const submission = await submitMessage(
      port,
      session.id,
      'scenario-1-direct',
      '把 SearchBar 的 debounce 从 300 改成 500',
      { tool: 'fake-codex' },
    );
    const run = await waitForRunTerminal(port, submission.run?.id);
    assert.equal(run.state, 'completed', 'scenario 1 run should complete successfully');

    const detail = await getSessionDetail(port, session.id);
    assertRemovedFieldsAbsent(detail, 'scenario 1 detail');
    assert.ok(
      detail.workflowSuggestion == null,
      'scenario 1 non-mainline session should not surface workflow suggestions',
    );
    assert.ok(
      !Array.isArray(detail.workflowPendingConclusions) || detail.workflowPendingConclusions.length === 0,
      'scenario 1 should not accumulate workflow handoffs',
    );

    const events = await getEvents(port, session.id);
    const workflowEvents = events.filter((event) => (
      event?.type === 'workflow_metric'
      || event?.type === 'workflow_auto_absorb'
      || event?.type === 'workflow_auto_advance'
      || event?.messageKind === 'workflow_handoff'
    ));
    assert.equal(
      workflowEvents.length,
      0,
      'scenario 1 plain execute path should have zero workflow-specific events',
    );
  });

  await t.test('scenario 2: mainline + verification + auto-absorb', async () => {
    const mainline = await createSession(port, {
      name: '执行 · 搜索页修复',
      appName: '执行',
      tool: 'fake-codex',
      description: 'Scenario 2 mainline',
    });
    state.mainlineVerificationId = mainline.id;
    assert.equal(mainline.currentTask, '搜索页修复', 'scenario 2 mainline should derive currentTask from the name');

    const submission = await submitMessage(
      port,
      mainline.id,
      'scenario-2-mainline',
      '修复筛选条件重置后列表不刷新的问题，同时替换空态文案',
      { tool: 'fake-codex' },
    );
    await waitForRunTerminal(port, submission.run?.id);

    const withSuggestion = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      return detail?.workflowSuggestion?.type === 'suggest_verification' ? detail : null;
    }, 'scenario 2 verification suggestion');
    assertRemovedFieldsAbsent(withSuggestion, 'scenario 2 mainline detail before accept');

    const accepted = await acceptWorkflowSuggestion(port, mainline.id);
    const verificationSession = accepted.session;
    assert.equal(verificationSession.appName, '验收', 'scenario 2 suggestion accept should spawn a verification session');
    assert.equal(
      verificationSession.handoffTargetSessionId,
      mainline.id,
      'scenario 2 verification session should point back to the mainline',
    );
    assertRemovedFieldsAbsent(verificationSession, 'scenario 2 spawned verification session');

    await waitForRunTerminal(port, accepted.run?.id);

    const mainlineAccepted = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const acceptedConclusion = findConclusion(detail, (entry) => (
        entry?.status === 'accepted' && entry?.handoffType === 'verification_result'
      ));
      return acceptedConclusion && detail?.workflowState === 'done' ? detail : null;
    }, 'scenario 2 accepted verification handoff');
    const acceptedVerification = findConclusion(mainlineAccepted, (entry) => (
      entry?.status === 'accepted' && entry?.handoffType === 'verification_result'
    ));
    assert.ok(acceptedVerification, 'scenario 2 mainline should store an accepted verification_result conclusion');
    assert.equal(mainlineAccepted.workflowState, 'done', 'scenario 2 mainline should end in done after auto-absorb');
    assert.ok(mainlineAccepted.workflowSuggestion == null, 'scenario 2 mainline should clear the suggestion after acceptance');
    state.scenario2CurrentTask = mainlineAccepted.currentTask || '';
  });

  await t.test('scenario 3: deliberation + decision handoff', async () => {
    const mainline = await createSession(port, {
      name: '执行 · API 迁移',
      appName: '执行',
      tool: 'fake-codex',
      description: 'Scenario 3 mainline',
    });
    state.deliberationMainlineId = mainline.id;

    const deliberation = await createSession(port, {
      name: '再议 · API 迁移方案',
      appName: '再议',
      tool: 'fake-codex-decision',
      description: 'Scenario 3 deliberation lane',
    });
    await patchSession(port, deliberation.id, { handoffTargetSessionId: mainline.id });

    const submission = await submitMessage(
      port,
      deliberation.id,
      'scenario-3-deliberation',
      '评估从 REST 迁移到 tRPC 的影响范围和方案',
      { tool: 'fake-codex-decision' },
    );
    await waitForRunTerminal(port, submission.run?.id);

    await handoffResult(port, deliberation.id, {
      targetSessionId: mainline.id,
      handoffType: 'decision_result',
      summary: '建议分三期迁移',
      payload: {
        summary: '建议分三期迁移，第一期先迁内部 API',
        recommendation: '分三期迁移',
        confidence: 'medium',
        decisionNeeded: ['是否接受额外一周工期'],
      },
    });

    const waitingDecision = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const decision = findConclusion(detail, (entry) => (
        entry?.handoffType === 'decision_result' && entry?.status === 'needs_decision'
      ));
      return decision ? detail : null;
    }, 'scenario 3 needs_decision handoff');
    const pendingDecision = findConclusion(waitingDecision, (entry) => (
      entry?.handoffType === 'decision_result' && entry?.status === 'needs_decision'
    ));
    assert.ok(pendingDecision, 'scenario 3 should produce a needs_decision decision_result handoff');
    assert.equal(waitingDecision.workflowState, 'waiting_user', 'scenario 3 mainline should pause in waiting_user');

    await updateConclusionStatus(port, mainline.id, pendingDecision.id, 'accepted');

    const acceptedDecision = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const decision = findConclusion(detail, (entry) => (
        entry?.id === pendingDecision.id && entry?.status === 'accepted'
      ));
      return decision && detail?.workflowState === 'done' ? detail : null;
    }, 'scenario 3 accepted decision_result handoff');
    const finalDecision = findConclusion(acceptedDecision, (entry) => entry?.id === pendingDecision.id);
    assert.equal(finalDecision.status, 'accepted', 'scenario 3 accepted decision_result should retain accepted terminal status');
    assert.equal(acceptedDecision.workflowState, 'done', 'scenario 3 mainline should return to done after accepting the decision handoff');
  });

  await t.test('scenario 4: parallel fan-out via multi-session handoff', async () => {
    const mainline = await createSession(port, {
      name: '执行 · Vue3 升级',
      appName: '执行',
      tool: 'fake-codex',
      description: 'Scenario 4 mainline',
    });
    state.parallelMainlineId = mainline.id;

    const fineops = await createSession(port, {
      name: '执行 · fineops 升级',
      appName: '执行',
      tool: 'fake-codex-parallel',
      description: 'Scenario 4 fineops',
    });
    const webui = await createSession(port, {
      name: '执行 · webui 升级',
      appName: '执行',
      tool: 'fake-codex-parallel',
      description: 'Scenario 4 webui',
    });

    await patchSession(port, fineops.id, { handoffTargetSessionId: mainline.id });
    await patchSession(port, webui.id, { handoffTargetSessionId: mainline.id });

    const [fineopsRun, webuiRun] = await Promise.all([
      submitMessage(port, fineops.id, 'scenario-4-fineops', '升级 fineops 到 Vue3', { tool: 'fake-codex-parallel' }),
      submitMessage(port, webui.id, 'scenario-4-webui', '升级 fineops-webui 到 Vue3', { tool: 'fake-codex-parallel' }),
    ]);
    await Promise.all([
      waitForRunTerminal(port, fineopsRun.run?.id),
      waitForRunTerminal(port, webuiRun.run?.id),
    ]);

    await handoffResult(port, fineops.id, {
      targetSessionId: mainline.id,
      handoffType: 'verification_result',
      summary: 'fineops 升级完成',
      payload: {
        summary: 'fineops 升级完成',
        recommendation: 'ok',
        confidence: 'high',
        validated: ['fineops 主流程升级完成'],
        evidence: ['fake-codex-parallel fineops'],
      },
    });

    await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const accepted = Array.isArray(detail?.workflowPendingConclusions)
        ? detail.workflowPendingConclusions.filter((entry) => entry?.status === 'accepted')
        : [];
      return accepted.length >= 1 ? detail : null;
    }, 'scenario 4 first accepted handoff');

    await handoffResult(port, webui.id, {
      targetSessionId: mainline.id,
      handoffType: 'verification_result',
      summary: 'webui 升级完成',
      payload: {
        summary: 'webui 升级完成',
        recommendation: 'ok',
        confidence: 'high',
        validated: ['webui 主流程升级完成'],
        evidence: ['fake-codex-parallel webui'],
      },
    });

    const finalParallel = await waitFor(async () => {
      const detail = await getSessionDetail(port, mainline.id);
      const accepted = Array.isArray(detail?.workflowPendingConclusions)
        ? detail.workflowPendingConclusions.filter((entry) => entry?.status === 'accepted' && entry?.handoffType === 'verification_result')
        : [];
      return accepted.length === 2 && detail?.workflowState === 'done' ? detail : null;
    }, 'scenario 4 both accepted handoffs');
    assert.equal(
      finalParallel.workflowPendingConclusions.filter((entry) => entry?.status === 'accepted').length,
      2,
      'scenario 4 mainline should retain two accepted verification handoffs',
    );
    assertRemovedFieldsAbsent(finalParallel, 'scenario 4 mainline detail');
  });

  await t.test('scenario 5: preserved primitives survive full lifecycle', async () => {
    await patchSession(port, state.mainlineVerificationId, { workflowPriority: 'urgent' });

    const detail = await getSessionDetail(port, state.mainlineVerificationId);
    assertRemovedFieldsAbsent(detail, 'scenario 5 detail');
    assert.equal(detail.workflowState, 'done', 'scenario 5 should preserve workflowState after the full lifecycle');
    assert.equal(detail.workflowPriority, 'high', 'scenario 5 should preserve normalized workflowPriority after patch');
    assert.equal(
      detail.currentTask,
      state.scenario2CurrentTask,
      'scenario 5 should preserve currentTask after the verification lifecycle',
    );
  });

  await t.test('scenario 6: session list shape for mobile display', async () => {
    const sessions = await listSessions(port);
    const direct = sessions.find((entry) => entry?.id === state.directSessionId);
    const verificationMainline = sessions.find((entry) => entry?.id === state.mainlineVerificationId);
    const deliberationMainline = sessions.find((entry) => entry?.id === state.deliberationMainlineId);
    const parallelMainline = sessions.find((entry) => entry?.id === state.parallelMainlineId);

    assert.ok(direct, 'scenario 6 should find the direct execute session in the list');
    assert.ok(verificationMainline, 'scenario 6 should find the verification mainline session in the list');
    assert.ok(deliberationMainline, 'scenario 6 should find the deliberation mainline session in the list');
    assert.ok(parallelMainline, 'scenario 6 should find the parallel mainline session in the list');

    assertRemovedFieldsAbsent(direct, 'scenario 6 direct session list item');
    assertRemovedFieldsAbsent(verificationMainline, 'scenario 6 verification mainline list item');
    assertRemovedFieldsAbsent(deliberationMainline, 'scenario 6 deliberation mainline list item');
    assertRemovedFieldsAbsent(parallelMainline, 'scenario 6 parallel mainline list item');

    assert.ok(
      direct.workflowState == null,
      'scenario 6 direct execute session should not invent a workflowState in the mobile list',
    );
    assert.equal(verificationMainline.workflowState, 'done', 'scenario 6 scenario 2 mainline should appear as done');
    assert.equal(verificationMainline.workflowPriority, 'high', 'scenario 6 scenario 2 mainline should preserve workflowPriority');
    assert.equal(deliberationMainline.workflowState, 'done', 'scenario 6 scenario 3 mainline should appear as done');
    assert.equal(parallelMainline.workflowState, 'done', 'scenario 6 scenario 4 mainline should appear as done');

    for (const entry of sessions) {
      assertRemovedFieldsAbsent(entry, `scenario 6 list item ${entry?.name || entry?.id || 'unknown'}`);
    }
  });
});
