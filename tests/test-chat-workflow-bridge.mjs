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
const getWorkflowTaskSeedInputSource = extractFunctionSource(bootstrapSource, 'getWorkflowTaskSeedInput');
const ensureWorkflowTaskAppsLoadedSource = extractFunctionSource(bootstrapSource, 'ensureWorkflowTaskAppsLoaded');
const canStartWorkflowOnAttachedSessionSource = extractFunctionSource(bootstrapSource, 'canStartWorkflowOnAttachedSession');
const startWorkflowOnAttachedSessionSource = extractFunctionSource(bootstrapSource, 'startWorkflowOnAttachedSession');
const workflowBridgeSource = sliceBetween(
  bootstrapSource,
  'window.remotelabWorkflowBridge = {',
  '\n\nrefreshFrontendBtn?.addEventListener',
);

function createContext({ currentSession = null, responses = {} } = {}) {
  const fetchCalls = [];
  const attachCalls = [];
  const renderCalls = [];
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
    showAppToast() {},
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
    getWorkflowTaskSeedInputSource,
    ensureWorkflowTaskAppsLoadedSource,
    canStartWorkflowOnAttachedSessionSource,
    startWorkflowOnAttachedSessionSource,
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
      currentTask: '修复移动端登录按钮',
      kickoffMessage: '开始执行',
    },
    'attached-session workflow starts should only send currentTask and kickoff fields to the server',
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
        session: { id: 'session-new', name: '任务 · 修复移动端登录按钮', appName: '执行' },
        run: { id: 'run-new' },
      },
    },
  });
  vm.runInNewContext(script, createdContext, { filename: 'static/chat/bootstrap.js' });

  const createdResult = await createdContext.window.remotelabWorkflowBridge.startTask({
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
    'new task sessions should still be created as generic task shells',
  );
  assert.equal(createdContext.fetchCalls[1].url, '/api/sessions/session-new/workflow/start');
  assert.deepEqual(
    JSON.parse(createdContext.fetchCalls[1].options.body),
    {
      input: { goal: '修复移动端登录按钮', project: '/repo/app' },
      currentTask: '修复移动端登录按钮',
      kickoffMessage: '开始执行',
    },
    'new-session workflow starts should also send currentTask instead of legacy workflowCurrentTask',
  );
  assert.equal(createdContext.attachCalls.length, 2, 'new task sessions should attach once after creation and once after workflow start');
  assert.equal(createdContext.renderCalls.length, 2, 'new task sessions should refresh the list after creation and workflow start');
  assert.equal(createdResult?.run?.id, 'run-new');

  const classifyContext = createContext();
  vm.runInNewContext(script, classifyContext, { filename: 'static/chat/bootstrap.js' });
  const classified = await classifyContext.window.remotelabWorkflowBridge.classifyTask({
    text: '根据 Figma 设计稿重构搜索页',
    folder: '/repo/app',
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(classified)),
    {
      mode: 'standard_delivery',
      confidence: 'high',
      reason: '',
    },
    'workflow bridge classifyTask should use the local simplified default classifier',
  );
  assert.equal(classifyContext.fetchCalls.length, 0, 'simplified classifyTask should not hit a server route');

  const bridgeShapeContext = createContext({
    currentSession: {
      id: 'session-seed',
      archived: false,
      folder: '/repo/app',
      name: '修复移动端登录按钮',
      activity: { run: { state: 'idle' } },
    },
  });
  vm.runInNewContext(script, bridgeShapeContext, { filename: 'static/chat/bootstrap.js' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(bridgeShapeContext.window.remotelabWorkflowBridge.getSeedInput())),
    {
      goal: '修复移动端登录按钮',
      project: '/repo/app',
    },
    'workflow bridge should still expose the explicit task-form seed input',
  );
  assert.equal(
    typeof bridgeShapeContext.window.remotelabWorkflowBridge.assessCompleteness,
    'undefined',
    'simplified workflow bridge should no longer expose intake completeness helpers',
  );
  assert.equal(
    typeof bridgeShapeContext.window.remotelabWorkflowBridge.canStartFromComposer,
    'undefined',
    'simplified workflow bridge should no longer expose composer auto-start helpers',
  );
  assert.equal(
    typeof bridgeShapeContext.window.remotelabWorkflowBridge.getSimpleTaskAutoConfirm,
    'undefined',
    'simplified workflow bridge should no longer expose intake auto-confirm flags',
  );
  assert.equal(
    typeof bridgeShapeContext.window.remotelabWorkflowBridge.confirmIntake,
    'undefined',
    'simplified workflow bridge should no longer expose legacy intake confirm actions',
  );
  assert.equal(
    typeof bridgeShapeContext.window.remotelabWorkflowBridge.cancelIntake,
    'undefined',
    'simplified workflow bridge should no longer expose legacy intake cancel actions',
  );

  console.log('test-chat-workflow-bridge: ok');
}

main().catch((error) => {
  console.error('test-chat-workflow-bridge: failed');
  console.error(error);
  process.exitCode = 1;
});
