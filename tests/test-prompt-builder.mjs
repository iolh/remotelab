#!/usr/bin/env node
import assert from 'assert/strict';
import {
  buildManagerTurnContextText,
  buildPreparedContinuationContext,
  buildSavedTemplateContextContent,
  resolveResumeState,
  wrapPrivatePromptBlock,
} from '../chat/prompt-builder.mjs';
import { configureWorkflowEngine } from '../chat/workflow-engine.mjs';

configureWorkflowEngine({
  getSession() { return null; },
  createSession() { return null; },
  enrichSessionMeta(meta) { return meta; },
  broadcastSessionInvalidation() {},
  broadcastSessionsInvalidation() {},
  shouldExposeSession() { return false; },
  isInternalSession() { return false; },
  nowIso() { return '2026-03-25T00:00:00.000Z'; },
  createInternalRequestId() { return 'internal-test'; },
  updateSessionHandoffTarget() { return null; },
  applySessionAppMetadata() { return null; },
  submitHttpMessage() { return null; },
});

const mainlineContext = buildManagerTurnContextText({
  appName: '执行',
  currentTask: '把 workflow 简化为 handoff 驱动',
  workflowPendingConclusions: [
    {
      id: 'decision-1',
      handoffType: 'decision_result',
      label: '再议结论',
      sourceSessionName: '再议 · 搜索页改造',
      summary: '建议先收敛 session-manager 的职责边界，再做 UI 清理。',
      status: 'needs_decision',
      payload: { confidence: 'medium' },
    },
  ],
}, '继续推进这次重构');

assert.match(mainlineContext, /Manager note:/, 'manager context should include the manager turn policy block');
assert.match(mainlineContext, /Current task: 把 workflow 简化为 handoff 驱动/, 'manager context should include currentTask');
assert.match(mainlineContext, /Open workflow conclusions requiring attention:/, 'manager context should inject open handoffs for mainline sessions');
assert.match(mainlineContext, /再议结论/, 'manager context should surface the handoff label');
assert.match(mainlineContext, /状态：待用户决策/, 'manager context should keep the simplified needs_decision status copy');
assert.doesNotMatch(mainlineContext, /stage|阶段/iu, 'manager context should not inject legacy workflow stage blocks');

const continuationContext = buildPreparedContinuationContext({
  summary: '之前已经完成 prompt-builder 拆分。',
  continuationBody: '最近变更：\n- 删除 workflow stage timeline\n- 保留 handoff UI',
}, 'claude', 'codex');

assert.match(continuationContext, /\[Conversation summary\]/, 'prepared continuation should retain the summary heading');
assert.match(continuationContext, /之前已经完成 prompt-builder 拆分。/, 'prepared continuation should include the summary body');
assert.match(continuationContext, /删除 workflow stage timeline/, 'prepared continuation should retain the continuation body');

const savedTemplateContext = buildSavedTemplateContextContent({
  summary: '模板摘要',
  continuationBody: '模板续写正文',
});

assert.match(savedTemplateContext, /模板摘要/, 'saved template context should keep the summary');
assert.match(savedTemplateContext, /模板续写正文/, 'saved template context should keep the continuation body');

assert.deepEqual(
  resolveResumeState('codex', { codexThreadId: 'thread-123' }),
  {
    hasResume: true,
    providerResumeId: 'thread-123',
    claudeSessionId: null,
    codexThreadId: 'thread-123',
  },
  'resume state should preserve codex thread ids when freshThread is not requested',
);

assert.deepEqual(
  resolveResumeState('codex', { codexThreadId: 'thread-123' }, { freshThread: true }),
  {
    hasResume: false,
    providerResumeId: null,
    claudeSessionId: null,
    codexThreadId: null,
  },
  'freshThread should force prompt-builder to start without a resume id',
);

assert.equal(
  wrapPrivatePromptBlock('internal only'),
  '<private>\ninternal only\n</private>',
  'private prompt blocks should preserve the wrapper contract',
);

console.log('test-prompt-builder: ok');
