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
    item: { type: 'agent_message', text: 'finished from fake codex' }
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
  appName = '',
  group = 'Tests',
  description = 'Workflow handoff',
}) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name,
    appName,
    group,
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

async function getSession(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}`);
  assert.equal(res.status, 200, 'session detail should succeed');
  return res.json.session;
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
  assert.match(handoffEvent.content || '', /执行验收结果/, 'handoff message should use the typed label for the mainline session');
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
  assert.equal(latest?.status, 'pending', 'latest handoff should remain pending');
  assert.equal(latest?.round, 2, 'second handoff should increment the round');
  assert.equal(latest?.supersedesHandoffId, conclusionId, 'latest handoff should reference the superseded handoff');
  assert.deepEqual(latest?.payload?.validated, ['筛选条件切换'], 'typed handoffs should persist validated evidence');
  assert.equal(latest?.payload?.recommendation, 'needs_more_validation', 'typed handoffs should persist structured recommendations');

  const mainlineSubmit = await submitMessage(port, mainline.id, 'req-handoff-mainline', '目标：完成搜索页改造\n成功标准：搜索、筛选和结果列表都正常工作');
  await waitForRunTerminal(port, mainlineSubmit.run.id);
  const mainlineManifest = readRunManifest(home, mainlineSubmit.run.id);
  assert.match(mainlineManifest.prompt || '', /Current workflow task: 完成搜索页改造/, 'mainline prompt should include the explicit current workflow task');
  assert.match(mainlineManifest.prompt || '', /Open workflow conclusions requiring attention:/, 'mainline prompt should include open workflow conclusions');
  assert.match(mainlineManifest.prompt || '', /执行验收结果/, 'mainline prompt should include the typed handoff label');
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

  console.log('test-http-session-handoff: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
