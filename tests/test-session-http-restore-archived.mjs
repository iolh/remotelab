#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionHttpSource = readFileSync(join(repoRoot, 'static/chat/session-http-helpers.js'), 'utf8')
  + '\n'
  + readFileSync(join(repoRoot, 'static/chat/session-http-list-state.js'), 'utf8')
  + '\n'
  + readFileSync(join(repoRoot, 'static/chat/session-http.js'), 'utf8');

function makeElement() {
  return {
    style: {},
    disabled: false,
    textContent: '',
    innerHTML: '',
    children: [],
    className: '',
    value: '',
    parentNode: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
    },
    remove() {
      this.parentNode = null;
    },
    addEventListener() {},
    focus() {},
    scrollIntoView() {},
    querySelector() {
      return null;
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
  };
}

function createFetchResponse(body, { status = 200, etag = '"etag-restore-archived"' } = {}) {
  const headers = new Map([
    ['content-type', 'application/json; charset=utf-8'],
    ['etag', etag],
  ]);
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected: false,
    url: 'http://127.0.0.1/api/sessions/archived-target',
    headers: {
      get(name) {
        return headers.get(String(name).toLowerCase()) || null;
      },
    },
    async json() {
      return body;
    },
  };
}

function createContext() {
  const fetchCalls = [];
  const attached = [];
  const context = {
    console,
    URL,
    Headers,
    Map,
    Set,
    Math,
    Date,
    JSON,
    fetchCalls,
    attached,
    navigator: {},
    Notification: function Notification() {},
    atob(value) {
      return Buffer.from(String(value), 'base64').toString('binary');
    },
    window: {
      location: {
        origin: 'http://127.0.0.1',
        href: 'http://127.0.0.1/?session=archived-target&tab=sessions',
        pathname: '/',
        search: '?session=archived-target&tab=sessions',
      },
      focus() {},
      crypto: {
        randomUUID() {
          return 'req_test';
        },
      },
    },
    history: {
      replaceState() {},
      pushState() {},
    },
    document: {
      visibilityState: 'visible',
      title: '',
      getElementById() {
        return null;
      },
      createElement() {
        return makeElement();
      },
    },
    pendingNavigationState: {
      sessionId: 'archived-target',
      tab: 'sessions',
    },
    activeTab: 'sessions',
    visitorMode: false,
    visitorSessionId: null,
    currentSessionId: null,
    hasAttachedSession: false,
    hasLoadedSessions: true,
    archivedSessionCount: 5,
    archivedSessionsLoaded: false,
    archivedSessionsLoading: false,
    archivedSessionsRefreshPromise: null,
    sessions: [
      {
        id: 'current-session',
        name: 'Current session',
        status: 'idle',
        updatedAt: '2026-03-12T09:00:00.000Z',
        archived: false,
        appId: 'chat',
      },
    ],
    jsonResponseCache: new Map(),
    renderedEventState: {
      sessionId: null,
      latestSeq: 0,
      eventCount: 0,
    },
    emptyState: makeElement(),
    messagesInner: makeElement(),
    messagesEl: {
      scrollHeight: 0,
      scrollTop: 0,
      clientHeight: 0,
    },
    sidebarSessionRefreshPromises: new Map(),
    pendingSidebarSessionRefreshes: new Set(),
    pendingCurrentSessionRefresh: false,
    currentSessionRefreshPromise: null,
    contextTokens: makeElement(),
    compactBtn: makeElement(),
    dropToolsBtn: makeElement(),
    resumeBtn: makeElement(),
    headerTitle: makeElement(),
    inlineToolSelect: makeElement(),
    toolsList: [],
    selectedTool: '',
    loadModelsForCurrentTool() {},
    restoreDraft() {},
    updateStatus() {},
    renderQueuedMessagePanel() {},
    renderSessionWorktreePanel() {},
    renderWorkflowSummaryPanel() {},
    syncForkButton() {},
    syncShareButton() {},
    syncBrowserState() {},
    persistActiveSessionId() {},
    switchTab() {},
    getSessionDisplayName(session) {
      return session?.name || '';
    },
    getEffectiveSessionAppId(session) {
      return session?.appId || 'chat';
    },
    normalizeSessionStatus(status) {
      return status || 'idle';
    },
    sortSessionsInPlace() {},
    refreshAppCatalog() {},
    renderSessionList() {},
    clearMessages() {},
    showEmpty() {},
    resolveRestoreTargetSession() {
      return context.sessions.find((session) => session.id === 'archived-target') || null;
    },
    attachSession(id, session) {
      attached.push({ id, archived: session?.archived === true });
      context.currentSessionId = id;
      context.hasAttachedSession = true;
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url) === '/api/sessions/archived-target') {
        return createFetchResponse({
          session: {
            id: 'archived-target',
            name: 'Archived target',
            archived: true,
            updatedAt: '2026-03-12T10:00:00.000Z',
            appId: 'chat',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  context.globalThis = context;
  context.self = context;
  return context;
}

const context = createContext();
vm.runInNewContext(sessionHttpSource, context, { filename: 'static/chat/session-http.js' });

await context.restoreOwnerSessionSelection();

assert.equal(context.fetchCalls.length, 1, 'restore should fetch the missing archived session by id');
assert.equal(context.fetchCalls[0], '/api/sessions/archived-target', 'restore should request the specific archived session');
assert.equal(context.attached.length, 1, 'restore should attach the fetched archived session');
assert.equal(context.attached[0].id, 'archived-target', 'restore should attach the requested archived session');
assert.equal(context.attached[0].archived, true, 'restore should preserve archived state');
assert.equal(
  context.sessions.some((session) => session.id === 'archived-target' && session.archived === true),
  true,
  'restore should keep the fetched archived session in the local session catalog',
);
assert.equal(context.pendingNavigationState, null, 'restore should clear the pending navigation target once attached');

console.log('test-session-http-restore-archived: ok');
