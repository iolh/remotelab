#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
        requiresHumanReview: false,
      }),
      '</verification_result>',
    ].join('\\n');
  } else if (prompt.includes('<decision_result>')) {
    text = [
      '建议先收敛方向，再继续推进实现。',
      '<decision_result>',
      JSON.stringify({
        summary: '建议先收敛方向，再继续推进实现。',
        recommendation: '优先沿方案 B 继续推进，并先补齐边界说明。',
        confidence: 'high',
        rejectedOptions: ['直接扩大改动范围'],
        tradeoffs: ['实现节奏更稳，但前置判断更多'],
        decisionNeeded: [],
      }),
      '</decision_result>',
    ].join('\\n');
  } else if (prompt.includes('<delivery_summary>')) {
    text = [
      '已完成最终收口。',
      '<delivery_summary>',
      JSON.stringify({
        summary: '最终交付已收口，主流程可进入完成态。',
        completed: ['吸收辅助结论', '更新主线输出', '补齐最终摘要'],
        remainingRisks: ['仍建议人工做一次页面级回看'],
      }),
      '</delivery_summary>',
    ].join('\\n');
  } else if (prompt.includes('再议结论已自动回灌')) {
    text = '已吸收再议结论，执行计划已更新，并继续沿新方向推进。';
  } else if (prompt.includes('验收结果已自动回灌') || prompt.includes('辅助结论已自动回灌')) {
    text = '已吸收验收结论，并根据结果继续推进主线。';
  }
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text }
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 }
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
    item: { type: 'agent_message', text: '验收已结束，但这次没有附带结构化结果。' }
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 }
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
  workflowMode = '',
  gatePolicy = '',
}) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool,
    name,
    appName,
    group,
    description,
    workflowMode,
    gatePolicy,
  });
  assert.equal(res.status, 201, 'create session should succeed');
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
    if (res.status !== 200) return false;
    if (!['completed', 'failed', 'cancelled'].includes(res.json.run.state)) return false;
    return res.json.run;
  }, `run ${runId} terminal`);
}

function readRunManifest(home, runId) {
  return JSON.parse(
    readFileSync(join(home, '.config', 'remotelab', 'chat-runs', runId, 'manifest.json'), 'utf8'),
  );
}

async function getEvents(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}/events`);
  assert.equal(res.status, 200, 'events request should succeed');
  return res.json.events || [];
}

async function getAllEvents(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}/events?filter=all`);
  assert.equal(res.status, 200, 'all-events request should succeed');
  return res.json.events || [];
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

const { home } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, port });

try {
  const mainline = await createSession(port, { name: '主交付 · 搜索页改造', appName: '主交付' });
  const review = await createSession(port, { name: '风险复核 · 搜索页改造', appName: '风险复核' });
  assert.equal(mainline.workflowCurrentTask, '搜索页改造', 'mainline sessions should derive an initial current task from the session name');

  const reviewSubmit = await submitMessage(port, review.id, 'req-handoff-source', 'Review this change');
  await waitForRunTerminal(port, reviewSubmit.run.id);

  const remember = await request(port, 'PATCH', `/api/sessions/${review.id}`, {
    handoffTargetSessionId: mainline.id,
  });
  assert.equal(remember.status, 200, 'session patch should persist the default handoff target');
  assert.equal(remember.json.session?.handoffTargetSessionId, mainline.id, 'stored handoff target should round-trip through the client shape');

  const handoff = await request(port, 'POST', `/api/sessions/${review.id}/handoff`, {
    summary: '第一轮验证摘要：旧结果。',
  });
  assert.equal(handoff.status, 201, 'handoff should append the latest assistant conclusion to the target session');
  assert.equal(handoff.json.session?.id, mainline.id, 'handoff should return the refreshed target session');
  assert.equal(handoff.json.sourceSession?.handoffTargetSessionId, mainline.id, 'handoff response should preserve the remembered target on the source session');
  assert.equal(handoff.json.handoff?.kind, 'risk_review', 'risk review sessions should report the risk review handoff kind');
  assert.equal(handoff.json.handoff?.type, 'verification_result', 'risk review sessions should map to verification results');
  assert.equal(Array.isArray(handoff.json.session?.workflowPendingConclusions), true, 'handoff should persist a pending workflow conclusion on the target session');
  assert.equal(handoff.json.session?.workflowPendingConclusions?.[0]?.status, 'pending', 'new handoffs should start as pending conclusions');
  assert.equal(handoff.json.session?.workflowPendingConclusions?.[0]?.handoffType, 'verification_result', 'pending conclusions should persist the typed handoff');
  assert.equal(handoff.json.session?.workflowPendingConclusions?.[0]?.round, 1, 'first handoff should start from round one');

  const targetEvents = await getEvents(port, mainline.id);
  const handoffEvent = targetEvents.find((event) => event.type === 'message' && event.messageKind === 'workflow_handoff');
  assert.ok(handoffEvent, 'target session should receive a structured handoff message');
  assert.equal(handoffEvent.handoffSourceSessionId, review.id, 'handoff message should keep the source session id');
  assert.equal(handoffEvent.handoffType, 'verification_result', 'handoff event should include the typed handoff');
  assert.match(handoffEvent.content || '', /(?:验收结果|执行验收结果)/, 'handoff message should use the typed label for the mainline session');
  assert.match(handoffEvent.content || '', /第一轮验证摘要：旧结果。/, 'handoff message should include the handoff summary');

  const conclusionId = handoff.json.session?.workflowPendingConclusions?.[0]?.id;
  assert.ok(conclusionId, 'handoff should return a stable conclusion id');

  const secondHandoff = await request(port, 'POST', `/api/sessions/${review.id}/handoff`, {
    summary: '移动端空态未验证，筛选重置已验证通过。',
    payload: {
      validated: ['筛选条件切换'],
      unverified: ['移动端空态'],
      findings: ['URL 参数残留'],
      evidence: ['npm test 通过'],
      recommendation: 'needs_more_validation',
    },
  });
  assert.equal(secondHandoff.status, 201, 'typed handoff payloads should also be accepted');
  const allConclusions = secondHandoff.json.session?.workflowPendingConclusions || [];
  assert.equal(allConclusions.length, 2, 'second handoff should supersede instead of deleting prior conclusions');
  const superseded = allConclusions.find((entry) => entry.id === conclusionId);
  const latest = allConclusions.find((entry) => entry.id !== conclusionId);
  assert.equal(superseded?.status, 'superseded', 'older unresolved handoffs should be marked as superseded');
  assert.equal(latest?.status, 'needs_decision', 'verification handoffs with unverified findings should stop at human review');
  assert.equal(latest?.round, 2, 'second handoff should increment the round');
  assert.equal(latest?.supersedesHandoffId, conclusionId, 'latest handoff should reference the superseded handoff');
  assert.deepEqual(latest?.payload?.validated, ['筛选条件切换'], 'typed handoffs should persist validated evidence');
  assert.equal(latest?.payload?.recommendation, 'needs_more_validation', 'typed handoffs should persist structured recommendations');

  const mainlineSubmit = await submitMessage(port, mainline.id, 'req-handoff-mainline', '目标：完成搜索页改造\n成功标准：搜索、筛选和结果列表都正常工作');
  await waitForRunTerminal(port, mainlineSubmit.run.id);
  const mainlineManifest = readRunManifest(home, mainlineSubmit.run.id);
  assert.match(mainlineManifest.prompt || '', /Current workflow task: 完成搜索页改造/, 'mainline prompt should include the explicit current workflow task');
  assert.match(mainlineManifest.prompt || '', /Open workflow conclusions requiring attention:/, 'mainline prompt should include open workflow conclusions');
  assert.match(mainlineManifest.prompt || '', /(?:验收结果|执行验收结果)/, 'mainline prompt should include the typed handoff label');
  assert.match(mainlineManifest.prompt || '', /移动端空态未验证，筛选重置已验证通过。/, 'mainline prompt should include the latest handoff summary');
  assert.doesNotMatch(mainlineManifest.prompt || '', /第一轮验证摘要：旧结果。/, 'mainline prompt should not surface superseded summaries');
  const refreshedMainline = await getSession(port, mainline.id);
  assert.equal(refreshedMainline.workflowCurrentTask, '完成搜索页改造', 'mainline sessions should persist the latest explicit workflow current task');

  const latestConclusionId = latest?.id;
  assert.ok(latestConclusionId, 'latest typed handoff should expose a stable id');

  const needsDecision = await request(port, 'POST', `/api/sessions/${mainline.id}/conclusions/${latestConclusionId}`, {
    status: 'needs_decision',
  });
  assert.equal(needsDecision.status, 200, 'workflow conclusion status updates should succeed');
  const decisionEntry = (needsDecision.json.session?.workflowPendingConclusions || []).find((entry) => entry.id === latestConclusionId);
  assert.equal(decisionEntry?.status, 'needs_decision', 'conclusion status should update in session detail responses');

  const accepted = await request(port, 'POST', `/api/sessions/${mainline.id}/conclusions/${latestConclusionId}`, {
    status: 'accepted',
  });
  assert.equal(accepted.status, 200, 'workflow conclusion status should support terminal acceptance');
  const acceptedEntry = (accepted.json.session?.workflowPendingConclusions || []).find((entry) => entry.id === latestConclusionId);
  assert.equal(acceptedEntry?.status, 'accepted', 'accepted conclusions should stay recorded with their terminal status');

  const afterAcceptanceSubmit = await submitMessage(port, mainline.id, 'req-handoff-mainline-after-accept', '继续推进搜索页改造');
  await waitForRunTerminal(port, afterAcceptanceSubmit.run.id);
  const afterAcceptanceManifest = readRunManifest(home, afterAcceptanceSubmit.run.id);
  assert.match(afterAcceptanceManifest.prompt || '', /No open workflow handoffs\./, 'mainline prompt should explicitly declare the empty handoff state');

  const decision = await createSession(port, { name: 'PR把关 · 搜索页改造', appName: 'PR把关' });
  const decisionSubmit = await submitMessage(port, decision.id, 'req-handoff-decision-source', 'Decide between plan A and B');
  await waitForRunTerminal(port, decisionSubmit.run.id);
  const decisionHandoff = await request(port, 'POST', `/api/sessions/${decision.id}/handoff`, {
    targetSessionId: mainline.id,
    summary: '推荐方案 B，但需要确认是否接受额外 1 天工期。',
    payload: {
      recommendation: '方案 B',
      rejectedOptions: ['方案 A'],
      tradeoffs: ['改动更小'],
      decisionNeeded: ['是否接受额外 1 天工期'],
      confidence: 'high',
    },
  });
  assert.equal(decisionHandoff.status, 201, 'decision handoffs should also be accepted');
  assert.equal(decisionHandoff.json.handoff?.type, 'decision_result', 'PR gate sessions should map to decision results');
  const decisionEntryStored = (decisionHandoff.json.session?.workflowPendingConclusions || []).find((entry) => entry.sourceSessionId === decision.id);
  assert.equal(decisionEntryStored?.handoffType, 'decision_result', 'decision handoffs should persist the typed decision result');
  assert.equal(decisionEntryStored?.payload?.confidence, 'high', 'decision handoffs should persist confidence');

  const parallelDecision = await createSession(port, { name: 'PR把关 · 并行拆分', appName: 'PR把关' });
  const parallelDecisionHandoff = await request(port, 'POST', `/api/sessions/${parallelDecision.id}/handoff`, {
    targetSessionId: mainline.id,
    summary: [
      '建议拆成两条并行执行线。',
      '<parallel_tasks>',
      JSON.stringify({
        parallelTasks: [
          { title: '并行子线 A', task: '新增 alpha 文件', boundary: '只改 alpha', repo: '/tmp/parallel-a' },
          { title: '并行子线 B', task: '新增 beta 文件', boundary: '只改 beta', repo: '/tmp/parallel-b' },
        ],
      }, null, 2),
      '</parallel_tasks>',
    ].join('\n\n'),
  });
  assert.equal(parallelDecisionHandoff.status, 201, 'decision handoffs with embedded parallel tasks should be accepted');
  const parallelDecisionEntry = (parallelDecisionHandoff.json.session?.workflowPendingConclusions || [])
    .find((entry) => entry.sourceSessionId === parallelDecision.id);
  assert.equal(Array.isArray(parallelDecisionEntry?.payload?.parallelTasks), true, 'embedded parallel tasks should survive handoff normalization');
  assert.equal(parallelDecisionEntry?.payload?.parallelTasks?.length, 2, 'handoff should persist all parsed parallel tasks');
  assert.equal(parallelDecisionEntry?.payload?.parallelTasks?.[0]?.title, '并行子线 A', 'handoff should preserve the first parsed task title');

  const verification = await createSession(port, { name: '执行验收 · 搜索页改造', appName: '执行验收' });
  const verificationSubmit = await submitMessage(port, verification.id, 'req-verification-runtime', '请验证搜索页改造');
  await waitForRunTerminal(port, verificationSubmit.run.id);
  const verificationManifest = readRunManifest(home, verificationSubmit.run.id);
  assert.equal(verificationManifest.options?.executionMode, 'verification_read_only', 'verification sessions should declare a read-only execution mode');
  assert.equal(verificationManifest.options?.sandboxMode, 'read-only', 'verification sessions should request the read-only sandbox');
  assert.equal(verificationManifest.options?.approvalPolicy, 'never', 'verification sessions should disable approval prompts in detached mode');
  assert.match(
    verificationManifest.options?.developerInstructions || '',
    /Treat the workspace as read-only\./,
    'verification sessions should pass explicit read-only developer instructions to Codex',
  );

  const phase2Mainline = await createSession(port, {
    name: '执行 · 自动验收测试',
    appName: '执行',
    workflowMode: 'standard_delivery',
  });
  const phase2Submit = await submitMessage(port, phase2Mainline.id, 'req-phase2-mainline', '目标：完成自动验收测试\n成功标准：首轮实现完成后给出下一步建议');
  const phase2Run = await waitForRunTerminal(port, phase2Submit.run.id);
  assert.equal(phase2Run.state, 'completed', 'phase 2 mainline run should complete');

  const phase2VerificationChild = await waitFor(async () => {
    const sessions = await listSessions(port);
    return sessions.find((item) => item.handoffTargetSessionId === phase2Mainline.id && item.appName === '验收') || false;
  }, 'phase2 verification auto-start');
  const phase2MainlineDetail = await getSession(port, phase2Mainline.id);
  assert.equal(phase2MainlineDetail.workflowSuggestion || null, null, 'non-terminal verification suggestions should auto-run without a visible suggestion card');
  assert.equal(phase2MainlineDetail.workflowDefinition?.currentStageIndex, 1, 'auto-advanced suggestions should move the mainline into the verification stage');

  const phase2VerificationChildDetail = await getSession(port, phase2VerificationChild.id);
  assert.equal(phase2VerificationChildDetail.handoffTargetSessionId, phase2Mainline.id, 'auto-started verification sessions should hand off back to the mainline');
  assert.equal(phase2VerificationChildDetail.tool, 'fake-codex', 'auto-started verification sessions should inherit the source tool');
  assert.equal(phase2VerificationChildDetail.effort, 'high', 'auto-started verification sessions should raise the effort for validation');
  const phase2VerificationRunId = await waitFor(async () => {
    const events = await getAllEvents(port, phase2VerificationChild.id);
    const assistantEvent = events.find((event) => event.type === 'message' && event.role === 'assistant' && event.runId);
    return assistantEvent?.runId || false;
  }, 'phase2 verification run id');
  await waitForRunTerminal(port, phase2VerificationRunId);
  const acceptedVerificationManifest = readRunManifest(home, phase2VerificationRunId);
  assert.match(acceptedVerificationManifest.prompt || '', /自动验收测试/, 'accepted suggestions should seed verification context from the mainline task');
  assert.match(acceptedVerificationManifest.prompt || '', /<verification_result>/, 'auto-started verification runs should request a typed verification result block');
  assert.equal(acceptedVerificationManifest.options?.executionMode, 'verification_read_only', 'auto-created verification sessions should preserve the read-only verification runtime');
  const phase2Absorbed = await waitFor(async () => {
    const detail = await getSession(port, phase2Mainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === phase2VerificationChild.id);
    if (!entry || entry.status !== 'accepted') return false;
    if (detail.workflowDefinition?.currentStageIndex !== 2) return false;
    return { detail, entry };
  }, 'phase2 auto absorb completion');
  assert.equal(phase2Absorbed.entry?.handoffType, 'verification_result', 'auto-handoff should persist the typed verification result');
  assert.equal(phase2Absorbed.detail?.workflowDefinition?.currentStageIndex, 2, 'standard_delivery should advance into the terminal execute stage after verification absorb');
  assert.equal(phase2Absorbed.detail?.workflowTaskTrace?.taskId, phase2Absorbed.detail?.workflowTaskContract?.id, 'mainline trace roots should anchor to the task contract id');
  assert.equal(
    phase2Absorbed.detail?.workflowTaskTrace?.sessionLinks?.some((entry) => entry.sessionId === phase2VerificationChild.id),
    true,
    'task traces should link the verification child session back to the mainline task',
  );
  assert.equal(
    phase2Absorbed.detail?.workflowTaskTrace?.stageTraces?.some((entry) => (
      entry.sessionId === phase2VerificationChild.id
      && entry.runId === phase2VerificationRunId
    )),
    true,
    'task traces should retain substage run traces across sessions',
  );
  const phase2ReconcileRecord = (phase2Absorbed.detail?.workflowTaskTrace?.reconcileRecords || []).find((entry) => (
    entry.sourceSessionId === phase2VerificationChild.id
    && entry.conclusionId === phase2Absorbed.entry.id
  ));
  assert.equal(phase2ReconcileRecord?.status, 'accepted', 'reconcile records should track direct auto-accept status');
  assert.equal(phase2ReconcileRecord?.costAttribution?.sourceRunId, phase2VerificationRunId, 'reconcile records should keep the originating substage run id');
  const phase2ChildDetail = await getSession(port, phase2VerificationChild.id);
  assert.equal(phase2ChildDetail.workflowTraceBridge?.rootSessionId, phase2Mainline.id, 'child sessions should keep a bridge pointer back to the root task session');
  assert.equal(phase2ChildDetail.workflowTraceBridge?.taskId, phase2Absorbed.detail?.workflowTaskContract?.id, 'child session bridges should share the root task id');
  const phase2Events = await getAllEvents(port, phase2Mainline.id);
  const phase2AutoAbsorbEvent = phase2Events.find((event) => (
    event.type === 'workflow_auto_absorb'
    && /已自动吸收/.test(event.content || '')
  ));
  assert.ok(phase2AutoAbsorbEvent, 'auto-accepted conclusions should leave a workflow_auto_absorb event');

  const phase2SubmitRound2 = await submitMessage(port, phase2Mainline.id, 'req-phase2-mainline-round2', '目标：完成自动验收测试第二轮\n成功标准：继续复用已有验收线');
  await waitForRunTerminal(port, phase2SubmitRound2.run.id);
  const phase2Round2Detail = await getSession(port, phase2Mainline.id);
  assert.equal(phase2Round2Detail.workflowSuggestion || null, null, 'terminal execute runs should not emit another verification suggestion');

  const quickExecute = await createSession(port, {
    name: '执行 · 快速修复',
    appName: '执行',
    workflowMode: 'quick_execute',
  });
  assert.equal(quickExecute.workflowMode, 'quick_execute', 'create session should preserve workflow launch mode');
  assert.equal(quickExecute.workflowDefinition?.stages?.length, 1, 'workflow sessions should expose a structured workflow definition');
  assert.equal(quickExecute.workflowDefinition?.currentStageIndex, 0, 'new workflow definitions should start from stage 0');
  const quickSubmit = await submitMessage(port, quickExecute.id, 'req-quick-execute', '修一下空指针');
  await waitForRunTerminal(port, quickSubmit.run.id);
  const quickExecuteDetail = await getSession(port, quickExecute.id);
  assert.equal(quickExecuteDetail.workflowSuggestion || null, null, 'quick execute sessions should not emit verification suggestions after completion');
  assert.equal(acceptedVerificationManifest.options?.sandboxMode, 'read-only', 'auto-created verification sessions should keep the read-only sandbox');
  assert.equal(acceptedVerificationManifest.options?.approvalPolicy, 'never', 'auto-created verification sessions should disable approvals');

  const dismissMainline = await createSession(port, {
    name: '执行 · 跳过验收测试',
    appName: '执行',
    workflowMode: 'standard_delivery',
    gatePolicy: 'always_manual',
  });
  const dismissSubmit = await submitMessage(port, dismissMainline.id, 'req-phase2-dismiss', '目标：验证跳过建议的路径');
  await waitForRunTerminal(port, dismissSubmit.run.id);
  const dismissBefore = await getSession(port, dismissMainline.id);
  assert.equal(dismissBefore.workflowSuggestion?.type, 'suggest_verification', 'dismiss flow should start with a pending verification suggestion');
  const dismissSuggestion = await request(port, 'POST', `/api/sessions/${dismissMainline.id}/workflow-suggestion/dismiss`);
  assert.equal(dismissSuggestion.status, 200, 'dismissing a workflow suggestion should succeed');
  assert.equal(dismissSuggestion.json.session?.workflowSuggestion || null, null, 'dismiss should remove the suggestion from the session');

  const plainSession = await createSession(port, { name: '普通会话', appName: '' });
  const plainSubmit = await submitMessage(port, plainSession.id, 'req-plain-before-workflow', '先做一轮普通对话');
  await waitForRunTerminal(port, plainSubmit.run.id);
  const workflowStart = await request(port, 'POST', `/api/sessions/${plainSession.id}/workflow/start`, {
    appNames: ['执行', '主交付', '功能交付'],
    input: {
      goal: '把当前会话切进主线 workflow',
    },
    workflowMode: 'standard_delivery',
    workflowCurrentTask: '把当前会话切进主线 workflow',
    kickoffMessage: '目标：把当前会话切进主线 workflow\n约束：保留当前已有历史',
  });
  assert.equal(workflowStart.status, 200, 'existing sessions should be able to enter workflow mode in place');
  assert.equal(workflowStart.json.session?.templateAppName, '执行', 'current-session workflow start should set the workflow template identity');
  assert.equal(workflowStart.json.session?.workflowMode, 'standard_delivery', 'current-session workflow start should persist the requested workflow mode');
  assert.equal(workflowStart.json.session?.workflowCurrentTask, '把当前会话切进主线 workflow', 'current-session workflow start should persist the current workflow task');
  assert.equal(workflowStart.json.session?.workflowDefinition?.stages?.length, 3, 'starting workflow in place should materialize the workflow definition');
  assert.equal(workflowStart.json.session?.workflowDefinition?.currentStageIndex, 0, 'in-place workflow starts should begin from the first stage');
  assert.equal(workflowStart.json.session?.workflowDefinition?.gatePolicy, 'low_confidence_only', 'workflow definitions should default gate policy to low_confidence_only');
  assert.equal(workflowStart.json.session?.workflowTaskContract?.goal, '把当前会话切进主线 workflow', 'workflow starts should materialize a task contract');
  assert.equal(workflowStart.json.session?.workflowTaskContract?.stage, 'executing', 'execute-first workflows should start in the executing task stage');
  assert.equal(workflowStart.json.session?.workflowAutoRoute?.autoRouted, false, 'explicit workflow starts should record a non-auto route');
  assert.ok(workflowStart.json.run?.id, 'starting workflow on the current session should also kick off the workflow message');
  await waitForRunTerminal(port, workflowStart.json.run.id);
  const startedWorkflowManifest = readRunManifest(home, workflowStart.json.run.id);
  assert.match(startedWorkflowManifest.prompt || '', /Current workflow task: 把当前会话切进主线 workflow/, 'in-place workflow starts should make the current task visible to the mainline prompt');
  assert.match(startedWorkflowManifest.prompt || '', /Current workflow: standard_delivery \(stage 1 of 3\)/, 'mainline prompts should expose the structured workflow stage block');

  const autoRoutedMainline = await createSession(port, {
    name: '普通会话 · 自动路由测试',
    appName: '',
  });
  const autoRoutedStart = await request(port, 'POST', `/api/sessions/${autoRoutedMainline.id}/workflow/start`, {
    input: {
      goal: '根据 Figma 设计稿重构搜索页筛选与空态交互，并评估兼容风险',
      constraints: '先不要改后端接口',
    },
    workflowCurrentTask: '根据 Figma 设计稿重构搜索页筛选与空态交互，并评估兼容风险',
    kickoffMessage: '目标：根据 Figma 设计稿重构搜索页筛选与空态交互，并评估兼容风险\n约束：先不要改后端接口',
  });
  assert.equal(autoRoutedStart.status, 200, 'workflow start should auto-route when no mode is provided');
  assert.equal(autoRoutedStart.json.session?.workflowMode, 'careful_deliberation', 'design-heavy starts should auto-route into careful_deliberation');
  assert.equal(autoRoutedStart.json.session?.workflowDefinition?.stages?.length, 5, 'auto-routed careful_deliberation should materialize the 5-stage workflow');
  assert.equal(autoRoutedStart.json.session?.workflowDefinition?.gatePolicy, 'low_confidence_only', 'auto-routed starts should still default to low_confidence_only');
  assert.equal(autoRoutedStart.json.session?.templateAppName, '再议', 'server-side auto routing should adopt the inferred first-stage template app');
  assert.equal(autoRoutedStart.json.session?.appName, '再议', 'new auto-routed sessions should adopt the inferred first-stage app name');
  assert.equal(autoRoutedStart.json.session?.workflowTaskContract?.stage, 'planning', 'deliberation-first auto routes should start in planning');
  assert.equal(autoRoutedStart.json.session?.workflowAutoRoute?.autoRouted, true, 'auto-routed starts should record that the mode was inferred');
  assert.match(autoRoutedStart.json.session?.workflowAutoRoute?.reason || '', /设计稿|交互输入/, 'auto-routed starts should expose a reason');
  await waitForRunTerminal(port, autoRoutedStart.json.run.id);
  const autoRoutedManifest = readRunManifest(home, autoRoutedStart.json.run.id);
  assert.match(autoRoutedManifest.prompt || '', /Current workflow: careful_deliberation \(stage 1 of 5\)/, 'auto-routed workflow starts should surface the inferred stage block');
  const autoRoutedEvents = await getAllEvents(port, autoRoutedMainline.id);
  const autoRoutedActivationMetric = autoRoutedEvents.find((event) => (
    event.type === 'workflow_metric'
    && event.event === 'activated'
  ));
  assert.equal(autoRoutedActivationMetric?.autoRouted, true, 'auto-routed starts should emit an activation metric');
  assert.equal(autoRoutedActivationMetric?.mode, 'careful_deliberation', 'activation metrics should preserve the inferred mode');
  assert.ok(autoRoutedActivationMetric?.taskId, 'activation metrics should link back to the task contract');

  const deliberateMainline = await createSession(port, {
    name: '执行 · 再议闭环测试',
    appName: '执行',
    workflowMode: 'careful_deliberation',
  });
  const deliberateSubmit = await submitMessage(port, deliberateMainline.id, 'req-deliberate-mainline', '目标：先做一轮再议，再按裁决推进');
  await waitForRunTerminal(port, deliberateSubmit.run.id);
  const deliberateManifest = readRunManifest(home, deliberateSubmit.run.id);
  assert.match(deliberateManifest.prompt || '', /Current workflow: careful_deliberation \(stage 1 of 5\)/, 'careful_deliberation should expose the initial deliberate stage in the prompt');
  const deliberateChild = await waitFor(async () => {
    const sessions = await listSessions(port);
    return sessions.find((item) => item.handoffTargetSessionId === deliberateMainline.id && item.appName === '再议') || false;
  }, 'careful_deliberation decision auto-start');
  const deliberateDetailBefore = await getSession(port, deliberateMainline.id);
  assert.equal(deliberateDetailBefore.workflowSuggestion || null, null, 'careful_deliberation should auto-start non-terminal deliberation substages');
  const deliberateChildDetail = await getSession(port, deliberateChild.id);
  const deliberateChildRunId = await waitFor(async () => {
    const events = await getAllEvents(port, deliberateChild.id);
    const assistantEvent = events.find((event) => event.type === 'message' && event.role === 'assistant' && event.runId);
    return assistantEvent?.runId || false;
  }, 'careful_deliberation child run id');
  await waitForRunTerminal(port, deliberateChildRunId);
  const deliberateChildManifest = readRunManifest(home, deliberateChildRunId);
  assert.match(deliberateChildManifest.prompt || '', /<decision_result>/, 'auto-started deliberation runs should request a typed decision result block');
  assert.equal(deliberateChildManifest.options?.executionMode, 'deliberation_advisory', 'deliberation sessions should run in advisory mode');
  assert.match(
    deliberateChildManifest.options?.developerInstructions || '',
    /do not modify files and do not produce code changes\./i,
    'deliberation sessions should pass explicit no-code-change developer instructions',
  );
  const deliberateOutcome = await waitFor(async () => {
    const detail = await getSession(port, deliberateMainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === deliberateChild.id);
    if (!entry || entry.status !== 'accepted') return false;
    if (detail.workflowDefinition?.currentStageIndex !== 1) return false;
    return { detail, entry };
  }, 'careful_deliberation decision auto absorb');
  assert.equal(deliberateOutcome.entry?.handoffType, 'decision_result', 'deliberation sessions should hand off structured decision results');
  assert.equal(deliberateOutcome.detail?.workflowTaskContract?.stage, 'executing', 'task contracts should advance with the workflow stage');
  const deliberateEvents = await getAllEvents(port, deliberateMainline.id);
  const deliberateAdvanceMetric = deliberateEvents.find((event) => (
    event.type === 'workflow_metric'
    && event.event === 'stage_advance'
    && event.fromStageRole === 'deliberate'
    && event.toStageRole === 'execute'
  ));
  assert.equal(deliberateAdvanceMetric?.toStageIndex, 1, 'stage advance metrics should track the new workflow index');

  const manualDecisionMainline = await createSession(port, {
    name: '执行 · 再议手动接受测试',
    appName: '执行',
    workflowMode: 'careful_deliberation',
    gatePolicy: 'always_manual',
  });
  const manualDecisionSubmit = await submitMessage(port, manualDecisionMainline.id, 'req-deliberate-manual-accept', '目标：验证再议手动接受后的 stage 推进');
  await waitForRunTerminal(port, manualDecisionSubmit.run.id);
  const manualDecisionAcceptSuggestion = await request(port, 'POST', `/api/sessions/${manualDecisionMainline.id}/workflow-suggestion/accept`);
  assert.equal(manualDecisionAcceptSuggestion.status, 201, 'always_manual deliberation should still create a deliberation session');
  await waitForRunTerminal(port, manualDecisionAcceptSuggestion.json.run.id);
  const manualDecisionPending = await waitFor(async () => {
    const detail = await getSession(port, manualDecisionMainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === manualDecisionAcceptSuggestion.json.session.id);
    if (!entry || entry.status !== 'needs_decision') return false;
    return { detail, entry };
  }, 'manual deliberation decision pending');
  const manualDecisionAccepted = await request(
    port,
    'POST',
    `/api/sessions/${manualDecisionMainline.id}/conclusions/${manualDecisionPending.entry.id}`,
    { status: 'accepted' },
  );
  assert.equal(manualDecisionAccepted.status, 200, 'manual acceptance of a deliberation conclusion should succeed');
  assert.equal(
    manualDecisionAccepted.json.session?.workflowDefinition?.currentStageIndex,
    1,
    'manual acceptance should advance the workflow stage from deliberate to execute',
  );

  const ignoredDecisionMainline = await createSession(port, {
    name: '执行 · 再议手动忽略测试',
    appName: '执行',
    workflowMode: 'careful_deliberation',
    gatePolicy: 'always_manual',
  });
  const ignoredDecisionSubmit = await submitMessage(port, ignoredDecisionMainline.id, 'req-deliberate-manual-ignore', '目标：验证再议手动忽略后的 stage 推进');
  await waitForRunTerminal(port, ignoredDecisionSubmit.run.id);
  const ignoredDecisionSuggestion = await request(port, 'POST', `/api/sessions/${ignoredDecisionMainline.id}/workflow-suggestion/accept`);
  assert.equal(ignoredDecisionSuggestion.status, 201, 'manual ignore flow should still create a deliberation session');
  await waitForRunTerminal(port, ignoredDecisionSuggestion.json.run.id);
  const ignoredDecisionPending = await waitFor(async () => {
    const detail = await getSession(port, ignoredDecisionMainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === ignoredDecisionSuggestion.json.session.id);
    if (!entry || entry.status !== 'needs_decision') return false;
    return { detail, entry };
  }, 'manual deliberation ignore pending');
  const ignoredDecision = await request(
    port,
    'POST',
    `/api/sessions/${ignoredDecisionMainline.id}/conclusions/${ignoredDecisionPending.entry.id}`,
    { status: 'ignored' },
  );
  assert.equal(ignoredDecision.status, 200, 'manual ignore of a deliberation conclusion should succeed');
  assert.equal(
    ignoredDecision.json.session?.workflowDefinition?.currentStageIndex,
    1,
    'manual ignore should also advance the workflow stage from deliberate to execute',
  );

  const manualMainline = await createSession(port, {
    name: '执行 · 每步确认测试',
    appName: '执行',
    workflowMode: 'standard_delivery',
    gatePolicy: 'always_manual',
  });
  const manualSubmit = await submitMessage(port, manualMainline.id, 'req-manual-mainline', '目标：验证每步确认策略');
  await waitForRunTerminal(port, manualSubmit.run.id);
  const manualSuggestion = await getSession(port, manualMainline.id);
  assert.equal(manualSuggestion.workflowSuggestion?.type, 'suggest_verification', 'always_manual should still surface the verification suggestion');
  const manualAccept = await request(port, 'POST', `/api/sessions/${manualMainline.id}/workflow-suggestion/accept`);
  assert.equal(manualAccept.status, 201, 'always_manual acceptance should still create a verification session');
  await waitForRunTerminal(port, manualAccept.json.run.id);
  const manualOutcome = await waitFor(async () => {
    const detail = await getSession(port, manualMainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === manualAccept.json.session.id);
    if (!entry || entry.status !== 'needs_decision') return false;
    return { detail, entry };
  }, 'always_manual verification completion');
  assert.equal(manualOutcome.detail?.workflowState, 'waiting_user', 'always_manual should pause the mainline for human review');
  const manualEvents = await getAllEvents(port, manualMainline.id);
  const manualPauseMetric = manualEvents.find((event) => (
    event.type === 'workflow_metric'
    && event.event === 'human_pause'
    && event.reason === 'handoff_requires_decision'
  ));
  assert.equal(manualPauseMetric?.stageRole, 'verify', 'human pause metrics should record the active stage when user review is required');
  const manualDecisionRecord = (manualOutcome.detail?.workflowTaskTrace?.decisionRecords || []).find((entry) => (
    entry.conclusionId === manualOutcome.entry.id
    && entry.reason === 'handoff_requires_decision'
  ));
  assert.equal(manualDecisionRecord?.status, 'pending', 'human-reviewed pauses should materialize decision records in the task trace');

  const finalConfirmMainline = await createSession(port, {
    name: '执行 · 最终确认测试',
    appName: '执行',
    workflowMode: 'standard_delivery',
    gatePolicy: 'final_confirm_only',
  });
  const finalConfirmSubmit = await submitMessage(port, finalConfirmMainline.id, 'req-final-confirm-mainline', '目标：验证只在最终确认策略');
  await waitForRunTerminal(port, finalConfirmSubmit.run.id);
  const finalConfirmChild = await waitFor(async () => {
    const sessions = await listSessions(port);
    return sessions.find((item) => item.handoffTargetSessionId === finalConfirmMainline.id && item.appName === '验收') || false;
  }, 'final_confirm_only verification session creation');
  const finalConfirmDetailBefore = await getSession(port, finalConfirmMainline.id);
  assert.equal(finalConfirmDetailBefore.workflowSuggestion || null, null, 'final_confirm_only should auto-accept without leaving a visible suggestion');
  const finalConfirmOutcome = await waitFor(async () => {
    const detail = await getSession(port, finalConfirmMainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === finalConfirmChild.id);
    if (!entry || entry.status !== 'accepted') return false;
    if (detail.workflowDefinition?.currentStageIndex !== 2) return false;
    return { detail, entry };
  }, 'final_confirm_only verification acceptance');
  assert.equal(finalConfirmOutcome.detail?.workflowDefinition?.currentStageIndex, 2, 'final_confirm_only should still advance into the terminal execute stage after auto acceptance');

  const invalidContractMainline = await createSession(port, {
    name: '执行 · 结构化契约测试',
    tool: 'fake-codex-invalid',
    appName: '执行',
    workflowMode: 'standard_delivery',
    gatePolicy: 'always_manual',
  });
  const invalidContractSubmit = await submitMessage(
    port,
    invalidContractMainline.id,
    'req-invalid-contract-mainline',
    '目标：验证缺失 verification_result 时的回退',
    { tool: 'fake-codex-invalid' },
  );
  await waitForRunTerminal(port, invalidContractSubmit.run.id);
  const invalidContractAccept = await request(port, 'POST', `/api/sessions/${invalidContractMainline.id}/workflow-suggestion/accept`);
  assert.equal(invalidContractAccept.status, 201, 'invalid verification flow should still create a verification session shell');
  await waitForRunTerminal(port, invalidContractAccept.json.run.id);
  const invalidContractOutcome = await waitFor(async () => {
    const detail = await getSession(port, invalidContractMainline.id);
    const entry = (detail.workflowPendingConclusions || []).find((item) => item.sourceSessionId === invalidContractAccept.json.session.id);
    if (!entry || entry.status !== 'needs_decision') return false;
    return { detail, entry };
  }, 'verification_result retry fallback');
  assert.match(invalidContractOutcome.entry?.summary || '', /验收已结束/, 'invalid verification payloads should fall back to a human-reviewed textual summary after retry');
  const invalidContractSource = await getSession(port, invalidContractAccept.json.session.id);
  assert.ok(invalidContractSource.verificationResultRetryRunId, 'invalid verification sessions should record the retry run id');

  const inlineWorkflowSession = await createSession(port, {
    name: '普通会话 · 内联声明',
    appName: '',
  });
  const inlineWorkflowText = '模式：标准交付\n策略：每步确认\n\n目标：测试内联声明';
  const inlineWorkflowSubmit = await submitMessage(
    port,
    inlineWorkflowSession.id,
    'req-inline-workflow-start',
    inlineWorkflowText,
  );
  await waitForRunTerminal(port, inlineWorkflowSubmit.run.id);
  const inlineWorkflowDetail = await getSession(port, inlineWorkflowSession.id);
  assert.equal(inlineWorkflowDetail.templateAppName, '执行', 'inline workflow activation should mark the current session as the execute template');
  assert.equal(inlineWorkflowDetail.workflowDefinition?.mode, 'standard_delivery', 'inline workflow declarations should activate the requested workflow mode');
  assert.equal(inlineWorkflowDetail.workflowDefinition?.stages?.length, 3, 'standard_delivery inline activation should materialize the 3-stage workflow');
  assert.equal(inlineWorkflowDetail.workflowDefinition?.gatePolicy, 'always_manual', 'inline workflow declarations should persist the requested gate policy');
  assert.match(inlineWorkflowDetail.workflowCurrentTask || '', /测试内联声明/, 'inline workflow activation should seed the workflow current task from the cleaned message');
  const inlineWorkflowEvents = await getEvents(port, inlineWorkflowSession.id);
  const inlineWorkflowUserEvent = inlineWorkflowEvents.find((event) => (
    event.type === 'message'
    && event.role === 'user'
    && event.requestId === 'req-inline-workflow-start'
  ));
  assert.equal(inlineWorkflowUserEvent?.content, inlineWorkflowText, 'inline workflow declarations should remain visible in the user-visible transcript');
  const inlineWorkflowManifest = readRunManifest(home, inlineWorkflowSubmit.run.id);
  assert.doesNotMatch(inlineWorkflowManifest.prompt || '', /模式：标准交付/, 'inline workflow declarations should be stripped from the execution prompt');
  assert.doesNotMatch(inlineWorkflowManifest.prompt || '', /策略：每步确认/, 'inline workflow gate policy declarations should be stripped from the execution prompt');

  const inlineWorkflowCreatedAt = inlineWorkflowDetail.workflowDefinition?.createdAt || '';
  const repeatedInlineSubmit = await submitMessage(
    port,
    inlineWorkflowSession.id,
    'req-inline-workflow-repeat',
    '模式：快速执行\n策略：只看最终\n\n目标：第二次提交不应重建 workflow',
  );
  await waitForRunTerminal(port, repeatedInlineSubmit.run.id);
  const repeatedInlineDetail = await getSession(port, inlineWorkflowSession.id);
  assert.equal(repeatedInlineDetail.workflowDefinition?.mode, 'standard_delivery', 'existing workflow sessions should ignore later inline mode declarations');
  assert.equal(repeatedInlineDetail.workflowDefinition?.stages?.length, 3, 'existing workflow definitions should remain intact after later inline declarations');
  assert.equal(repeatedInlineDetail.workflowDefinition?.gatePolicy, 'always_manual', 'existing workflow gate policy should not be overwritten by later inline declarations');
  assert.equal(repeatedInlineDetail.workflowDefinition?.createdAt || '', inlineWorkflowCreatedAt, 'existing workflow sessions should not recreate the workflow definition');

  const inlineAutoWorkflowSession = await createSession(port, {
    name: '普通会话 · 自动声明',
    appName: '',
  });
  const inlineAutoText = '工作流：自动\n策略：每步确认\n\n目标：根据 Figma 设计稿重构筛选交互并判断兼容风险';
  const inlineAutoSubmit = await submitMessage(
    port,
    inlineAutoWorkflowSession.id,
    'req-inline-workflow-auto',
    inlineAutoText,
  );
  await waitForRunTerminal(port, inlineAutoSubmit.run.id);
  const inlineAutoDetail = await getSession(port, inlineAutoWorkflowSession.id);
  assert.equal(inlineAutoDetail.workflowDefinition?.mode, 'careful_deliberation', 'workflow:auto declarations should auto-route into careful_deliberation when design input is present');
  assert.equal(inlineAutoDetail.workflowDefinition?.gatePolicy, 'always_manual', 'workflow:auto declarations should preserve the requested gate policy');
  assert.equal(inlineAutoDetail.workflowAutoRoute?.autoRouted, true, 'workflow:auto declarations should mark the route as auto');
  assert.equal(inlineAutoDetail.workflowTaskContract?.stage, 'executing', 'task contracts should move forward with the active workflow stage after inline auto routing');
  const inlineAutoManifest = readRunManifest(home, inlineAutoSubmit.run.id);
  assert.doesNotMatch(inlineAutoManifest.prompt || '', /工作流：自动/, 'workflow:auto declarations should be stripped from the execution prompt');
  assert.doesNotMatch(inlineAutoManifest.prompt || '', /策略：每步确认/, 'workflow:auto gate policy declarations should be stripped from the execution prompt');

  console.log('test-http-session-handoff: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
