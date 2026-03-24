#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const bootstrapSource = readFileSync(join(repoRoot, 'static', 'chat', 'bootstrap.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const markers = [`async function ${functionName}`, `function ${functionName}`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index !== -1);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `Missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start);
  assert.notEqual(end, -1, `Missing end token: ${endToken}`);
  return source.slice(start, end);
}

const normalizeWorkflowTaskTextSource = extractFunctionSource(bootstrapSource, 'normalizeWorkflowTaskText');
const buildWorkflowTaskSessionNameSource = extractFunctionSource(bootstrapSource, 'buildWorkflowTaskSessionName');
const createWorkflowTaskSessionSource = extractFunctionSource(bootstrapSource, 'createWorkflowTaskSession');
const classifyWorkflowTaskSource = extractFunctionSource(bootstrapSource, 'classifyWorkflowTask');
const normalizeWorkflowTaskInputSource = extractFunctionSource(bootstrapSource, 'normalizeWorkflowTaskInput');
const buildWorkflowAssessmentSignalSource = extractFunctionSource(bootstrapSource, 'buildWorkflowAssessmentSignal');
const normalizeWorkflowModeKeySource = extractFunctionSource(bootstrapSource, 'normalizeWorkflowModeKey');
const mapWorkflowModeToComplexityLevelSource = extractFunctionSource(bootstrapSource, 'mapWorkflowModeToComplexityLevel');
const shouldWorkflowAutoConfirmSimpleTaskSource = extractFunctionSource(bootstrapSource, 'shouldWorkflowAutoConfirmSimpleTask');
const buildWorkflowIntakeQuestionSource = extractFunctionSource(bootstrapSource, 'buildWorkflowIntakeQuestion');
const assessWorkflowTaskCompletenessSource = extractFunctionSource(bootstrapSource, 'assessWorkflowTaskCompleteness');
const canStartWorkflowOnAttachedSessionSource = extractFunctionSource(bootstrapSource, 'canStartWorkflowOnAttachedSession');
const canStartWorkflowFromComposerContextSource = extractFunctionSource(bootstrapSource, 'canStartWorkflowFromComposerContext');
const startWorkflowOnAttachedSessionSource = extractFunctionSource(bootstrapSource, 'startWorkflowOnAttachedSession');
const confirmWorkflowIntakeOnAttachedSessionSource = extractFunctionSource(bootstrapSource, 'confirmWorkflowIntakeOnAttachedSession');
const cancelWorkflowIntakeOnAttachedSessionSource = extractFunctionSource(bootstrapSource, 'cancelWorkflowIntakeOnAttachedSession');
const workflowBridgeSource = sliceBetween(
  bootstrapSource,
  'window.remotelabWorkflowBridge = {',
  '\n\nrefreshFrontendBtn?.addEventListener',
);

function createContext({ currentSession = null, responses = {} } = {}) {
  const fetchCalls = [];
  const attachCalls = [];
  const renderCalls = [];
  const toastCalls = [];
  const upsertedSessions = new Map();
  const localStorage = {
    values: new Map(),
    getItem(key) {
      return this.values.has(key) ? this.values.get(key) : null;
    },
    setItem(key, value) {
      this.values.set(key, String(value));
    },
    removeItem(key) {
      this.values.delete(key);
    },
  };
  const context = {
    console,
    Promise,
    JSON,
    Math,
    URL,
    encodeURIComponent,
    fetchCalls,
    attachCalls,
    renderCalls,
    toastCalls,
    availableApps: [],
    preferredTool: 'codex',
    selectedTool: 'claude',
    toolsList: [{ id: 'codex' }, { id: 'claude' }],
    DEFAULT_TOOL_ID: 'codex',
    DEFAULT_APP_ID: 'chat',
    DEFAULT_APP_NAME: 'Chat',
    isDesktop: true,
    visitorMode: false,
    closeSidebarFn() {
      throw new Error('closeSidebarFn should not be used in this test');
    },
    showAppToast(message, tone) {
      toastCalls.push({ message, tone });
    },
    resolveSelectedSessionPrincipal() {
      return { kind: 'admin', userId: 'admin-user' };
    },
    buildSessionPrincipalPayload(principal) {
      return principal?.userId ? { userId: principal.userId } : {};
    },
    getCurrentSession() {
      return currentSession;
    },
    upsertSession(session) {
      upsertedSessions.set(session.id, session);
      return session;
    },
    renderSessionList() {
      renderCalls.push(upsertedSessions.size);
    },
    attachSession(sessionId, session) {
      attachCalls.push({ sessionId, session });
    },
    async fetchJsonOrRedirect(url, options = {}) {
      fetchCalls.push({ url: String(url), options });
      const response = responses[String(url)];
      if (typeof response === 'function') {
        return response({ url: String(url), options, fetchCalls });
      }
      if (response) return response;
      throw new Error(`Unexpected fetch call: ${url}`);
    },
    window: {
      location: {
        origin: 'https://remotelab.local',
      },
      localStorage,
    },
  };
  context.globalThis = context;
  return context;
}

async function main() {
  const script = [
    normalizeWorkflowTaskTextSource,
    buildWorkflowTaskSessionNameSource,
    createWorkflowTaskSessionSource,
    classifyWorkflowTaskSource,
    normalizeWorkflowTaskInputSource,
    buildWorkflowAssessmentSignalSource,
    normalizeWorkflowModeKeySource,
    mapWorkflowModeToComplexityLevelSource,
    shouldWorkflowAutoConfirmSimpleTaskSource,
    buildWorkflowIntakeQuestionSource,
    assessWorkflowTaskCompletenessSource,
    canStartWorkflowOnAttachedSessionSource,
    canStartWorkflowFromComposerContextSource,
    startWorkflowOnAttachedSessionSource,
    confirmWorkflowIntakeOnAttachedSessionSource,
    cancelWorkflowIntakeOnAttachedSessionSource,
    workflowBridgeSource,
  ].join('\n\n');

  const attachedContext = createContext({
    currentSession: {
      id: 'session-current',
      archived: false,
      activity: { run: { state: 'idle' } },
    },
    responses: {
      '/api/sessions/session-current/workflow/start': {
        session: { id: 'session-current', name: '当前会话', appName: '执行' },
        run: { id: 'run-current' },
      },
    },
  });
  vm.runInNewContext(script, attachedContext, { filename: 'static/chat/bootstrap.js' });

  const attachedResult = await attachedContext.window.remotelabWorkflowBridge.startTask({
    appNames: ['再议'],
    workflowMode: 'careful_deliberation',
    gatePolicy: 'always_pause',
    input: { goal: '修复移动端登录按钮', project: '/repo/app' },
    kickoffMessage: '开始执行',
    successToast: '任务已开始',
  });

  assert.equal(attachedContext.fetchCalls.length, 1, 'attached sessions should go straight to workflow/start');
  assert.equal(attachedContext.fetchCalls[0].url, '/api/sessions/session-current/workflow/start');
  assert.deepEqual(
    JSON.parse(attachedContext.fetchCalls[0].options.body),
    {
      input: { goal: '修复移动端登录按钮', project: '/repo/app' },
      workflowCurrentTask: '修复移动端登录按钮',
      kickoffMessage: '开始执行',
    },
    'attached-session workflow starts should only send generic kickoff fields to the server',
  );
  assert.ok(
    !attachedContext.fetchCalls[0].options.body.includes('careful_deliberation')
      && !attachedContext.fetchCalls[0].options.body.includes('always_pause')
      && !attachedContext.fetchCalls[0].options.body.includes('再议'),
    'frontend preview data should not leak into the server-authoritative workflow start payload',
  );
  assert.equal(attachedResult?.session?.id, 'session-current');
  assert.equal(attachedContext.attachCalls.length, 1, 'attached sessions should re-attach the updated session once');

  const createdContext = createContext({
    currentSession: {
      id: 'session-busy',
      archived: false,
      activity: { run: { state: 'running' } },
    },
    responses: {
      '/api/sessions': {
        session: { id: 'session-new', name: '任务 · 修复移动端登录按钮', folder: '/repo/app' },
      },
      '/api/sessions/session-new/workflow/start': {
        session: { id: 'session-new', name: '任务 · 修复移动端登录按钮', appName: '再议' },
        run: { id: 'run-new' },
      },
    },
  });
  vm.runInNewContext(script, createdContext, { filename: 'static/chat/bootstrap.js' });

  const createdResult = await createdContext.window.remotelabWorkflowBridge.startTask({
    appNames: ['执行'],
    workflowMode: 'quick_execute',
    gatePolicy: 'low_confidence_only',
    input: { goal: '修复移动端登录按钮', project: '/repo/app' },
    kickoffMessage: '开始执行',
    successToast: '任务已开始',
  });

  assert.equal(createdContext.fetchCalls.length, 2, 'new task sessions should create a base session then call workflow/start');
  assert.equal(createdContext.fetchCalls[0].url, '/api/sessions');
  assert.deepEqual(
    JSON.parse(createdContext.fetchCalls[0].options.body),
    {
      folder: '/repo/app',
      tool: 'codex',
      name: '任务 · 修复移动端登录按钮',
      description: '修复移动端登录按钮',
      sourceId: 'chat',
      sourceName: 'Chat',
      worktree: true,
      userId: 'admin-user',
    },
    'new task sessions should be created with a generic task shell before the server picks a workflow route',
  );
  assert.equal(createdContext.fetchCalls[1].url, '/api/sessions/session-new/workflow/start');
  assert.deepEqual(
    JSON.parse(createdContext.fetchCalls[1].options.body),
    {
      input: { goal: '修复移动端登录按钮', project: '/repo/app' },
      workflowCurrentTask: '修复移动端登录按钮',
      kickoffMessage: '开始执行',
    },
    'new-session workflow starts should also defer route selection to the backend',
  );
  assert.equal(createdContext.attachCalls.length, 2, 'new task sessions should attach once after creation and once after workflow start');
  assert.equal(createdContext.renderCalls.length, 2, 'new task sessions should refresh the list after creation and workflow start');
  assert.equal(createdResult?.run?.id, 'run-new');

  const classifyContext = createContext({
    responses: {
      '/api/workflow/classify?text=%E6%A0%B9%E6%8D%AE+Figma+%E8%AE%BE%E8%AE%A1%E7%A8%BF%E9%87%8D%E6%9E%84%E6%90%9C%E7%B4%A2%E9%A1%B5&folder=%2Frepo%2Fapp': {
        mode: 'careful_deliberation',
        confidence: 'high',
        reason: '检测到设计稿输入，适合先收敛方向',
      },
    },
  });
  vm.runInNewContext(script, classifyContext, { filename: 'static/chat/bootstrap.js' });

  const classified = await classifyContext.window.remotelabWorkflowBridge.classifyTask({
    text: '根据 Figma 设计稿重构搜索页',
    folder: '/repo/app',
  });
  assert.deepEqual(classified, {
    mode: 'careful_deliberation',
    confidence: 'high',
    reason: '检测到设计稿输入，适合先收敛方向',
  }, 'workflow bridge classifyTask should proxy the server classification response');
  assert.equal(
    classifyContext.fetchCalls[0]?.url,
    '/api/workflow/classify?text=%E6%A0%B9%E6%8D%AE+Figma+%E8%AE%BE%E8%AE%A1%E7%A8%BF%E9%87%8D%E6%9E%84%E6%90%9C%E7%B4%A2%E9%A1%B5&folder=%2Frepo%2Fapp',
    'workflow bridge classifyTask should call the unified server-side route preview endpoint',
  );

  const assessmentContext = createContext({
    responses: {
      '/api/workflow/classify?text=%E9%87%8D%E6%9E%84%E8%AE%A4%E8%AF%81%E6%A8%A1%E5%9D%97&folder=%2Frepo%2Fapp': {
        mode: 'careful_deliberation',
        confidence: 'high',
        reason: '涉及核心鉴权链路',
      },
    },
  });
  vm.runInNewContext(script, assessmentContext, { filename: 'static/chat/bootstrap.js' });
  const assessment = await assessmentContext.window.remotelabWorkflowBridge.assessCompleteness({
    input: { goal: '重构认证模块', project: '/repo/app' },
  });
  assert.equal(assessment.complete, false, 'workflow bridge assessCompleteness should block incomplete high-complexity tasks');
  assert.deepEqual([...assessment.missingFields], ['constraints'], 'high-complexity tasks should require explicit constraints');
  assert.equal(assessment.complexityLevel, 'high');
  assert.equal(assessment.reason, '涉及核心鉴权链路');
  assert.equal(assessment.autoConfirm, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(assessment.classification)),
    {
      mode: 'careful_deliberation',
      confidence: 'high',
      reason: '涉及核心鉴权链路',
    },
    'workflow bridge assessCompleteness should preserve the server classification payload',
  );
  assert.equal(
    assessment.suggestedQuestion,
    '这件事看起来复杂度较高（涉及核心鉴权链路）。开始前请补一句边界/不能动的地方；如无特殊要求可直接回复“无”。',
    'workflow bridge assessCompleteness should return a user-facing follow-up question',
  );

  const lowIntentAssessmentContext = createContext({
    responses: {
      '/api/workflow/classify?text=%E4%BD%A0%E5%A5%BD': {
        mode: '',
        confidence: 'low',
        reason: '',
      },
    },
  });
  vm.runInNewContext(script, lowIntentAssessmentContext, { filename: 'static/chat/bootstrap.js' });
  const lowIntentAssessment = await lowIntentAssessmentContext.window.remotelabWorkflowBridge.assessCompleteness({
    input: { goal: '你好' },
  });
  assert.equal(lowIntentAssessment.intentConfident, false, 'low-confidence non-task messages should not count as workflow intent');
  assert.equal(lowIntentAssessment.autoConfirm, false, 'low-confidence non-task messages should never auto-confirm');
  assert.equal(lowIntentAssessment.classification, null, 'low-confidence non-task messages should not retain a workflow classification');

  const intakeActionContext = createContext({
    currentSession: {
      id: 'session-current',
      archived: false,
      activity: { run: { state: 'idle' } },
    },
    responses: {
      '/api/sessions/session-current/workflow/intake/confirm': {
        session: { id: 'session-current', name: '当前会话', pendingIntake: false, appName: '执行' },
        run: { id: 'run-intake-confirm' },
      },
      '/api/sessions/session-current/workflow/intake/cancel': {
        session: { id: 'session-current', name: '当前会话', pendingIntake: false },
      },
    },
  });
  vm.runInNewContext(script, intakeActionContext, { filename: 'static/chat/bootstrap.js' });
  const confirmed = await intakeActionContext.window.remotelabWorkflowBridge.confirmIntake({
    input: { goal: '重构认证模块', constraints: '不改数据库 schema' },
  });
  assert.equal(
    intakeActionContext.fetchCalls[0]?.url,
    '/api/sessions/session-current/workflow/intake/confirm',
    'workflow bridge confirmIntake should use the dedicated intake confirm endpoint',
  );
  assert.deepEqual(
    JSON.parse(intakeActionContext.fetchCalls[0].options.body),
    {
      input: { goal: '重构认证模块', project: '', constraints: '不改数据库 schema', progress: '', concern: '', preference: '' },
    },
    'workflow bridge confirmIntake should normalize and submit the edited intake payload',
  );
  assert.equal(confirmed?.run?.id, 'run-intake-confirm');

  const cancelled = await intakeActionContext.window.remotelabWorkflowBridge.cancelIntake();
  assert.equal(
    intakeActionContext.fetchCalls[1]?.url,
    '/api/sessions/session-current/workflow/intake/cancel',
    'workflow bridge cancelIntake should use the dedicated intake cancel endpoint',
  );
  assert.equal(cancelled?.pendingIntake, false);

  assert.equal(
    assessmentContext.window.remotelabWorkflowBridge.canStartFromComposer(),
    true,
    'composer intake should be allowed when there is no attached session',
  );

  const busyComposerContext = createContext({
    currentSession: {
      id: 'session-running',
      archived: false,
      activity: { run: { state: 'running' } },
    },
  });
  vm.runInNewContext(script, busyComposerContext, { filename: 'static/chat/bootstrap.js' });
  assert.equal(
    busyComposerContext.window.remotelabWorkflowBridge.canStartFromComposer(),
    false,
    'composer intake should not hijack sessions that already have a running workflow',
  );

  console.log('test-chat-workflow-bridge: ok');
}

main().catch((error) => {
  console.error('test-chat-workflow-bridge: failed');
  console.error(error);
  process.exitCode = 1;
});
