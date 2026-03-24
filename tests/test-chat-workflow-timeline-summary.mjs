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
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
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

const context = {
  console,
  sessions: [
    {
      id: 'verify-1',
      handoffTargetSessionId: 'main-1',
      appName: '验收',
      name: '验收 · 子线',
      activity: { run: { state: 'running' } },
    },
  ],
  window: {},
  cloneChromeSummarySuggestion() {
    return null;
  },
  getChromeWorkflowStatusLabel() {
    return '进行中';
  },
  isWorkflowMainlineSession() {
    return true;
  },
  getWorkflowConclusionsByStatus(session, statuses = []) {
    const allowed = new Set(statuses);
    return (Array.isArray(session?.workflowPendingConclusions) ? session.workflowPendingConclusions : [])
      .filter((entry) => allowed.has(entry?.status));
  },
  getWorkflowPanelCurrentTask() {
    return '修复历史会话恢复';
  },
  renderedEventState: {
    sessionId: 'main-1',
    displayEvents: [
      {
        seq: 91,
        type: 'workflow_auto_advance',
        content: '已自动启动验收阶段。',
        timestamp: '2026-03-24T10:05:00.000Z',
      },
      {
        seq: 92,
        type: 'status',
        content: '已自动启用工作流 · 审慎模式（原因：检测到设计稿输入）',
        timestamp: '2026-03-24T10:10:00.000Z',
      },
    ],
  },
};
context.globalThis = context;

vm.runInNewContext(
  [
    'const CHROME_WORKFLOW_STAGE_ROLE_LABELS = { execute: "执行", verify: "验收", deliberate: "再议" };',
    extractFunctionSource(bootstrapSource, 'normalizeWorkflowTaskText'),
    extractFunctionSource(bootstrapSource, 'cloneChromeSummaryConclusion'),
    extractFunctionSource(bootstrapSource, 'getNormalizedWorkflowDefinitionForChrome'),
    extractFunctionSource(bootstrapSource, 'getWorkflowStageBaseLabelForChrome'),
    extractFunctionSource(bootstrapSource, 'getWorkflowCurrentStageLabelForChrome'),
    extractFunctionSource(bootstrapSource, 'isWorkflowActiveForChrome'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowStages'),
    extractFunctionSource(bootstrapSource, 'getChromeWorkflowTimelineSortValue'),
    extractFunctionSource(bootstrapSource, 'getChromeWorkflowTimelineTone'),
    extractFunctionSource(bootstrapSource, 'getChromeWorkflowTimelineStatusLabel'),
    extractFunctionSource(bootstrapSource, 'getChromeWorkflowTimelineKindLabel'),
    extractFunctionSource(bootstrapSource, 'getChromeWorkflowAutomationTone'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowStageTimelineEntry'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowDecisionTimelineEntry'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowReconcileTimelineEntry'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowAutomationTimelineEntry'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowAutomationTimeline'),
    extractFunctionSource(bootstrapSource, 'buildChromeWorkflowTimeline'),
    extractFunctionSource(bootstrapSource, 'buildChromeBridgeSummary'),
    'globalThis.buildChromeBridgeSummary = buildChromeBridgeSummary;',
  ].join('\n'),
  context,
  { filename: 'static/chat/bootstrap.js' },
);

const summary = context.buildChromeBridgeSummary({
  id: 'main-1',
  name: '执行 · 主线',
  appName: '执行',
  workflowState: 'running',
  workflowDefinition: {
    currentStageIndex: 1,
    stages: [
      { role: 'execute' },
      { role: 'verify' },
      { role: 'execute', label: '收口' },
    ],
  },
  workflowPendingConclusions: [
    {
      id: 'conclusion-1',
      status: 'pending',
      summary: '验收还缺一轮移动端复查。',
      label: '验收结果',
      sourceSessionName: '验收 · 子线',
    },
  ],
  workflowTaskTrace: {
    currentStageTraceId: 'trace-stage-2',
    stageTraces: [
      {
        id: 'trace-stage-1',
        stage: '执行',
        stageRole: 'execute',
        stageIndex: 0,
        sessionKind: 'mainline',
        sessionName: '执行 · 主线',
        status: 'completed',
        startedAt: '2026-03-24T09:00:00.000Z',
        completedAt: '2026-03-24T09:20:00.000Z',
      },
      {
        id: 'trace-stage-2',
        stage: '验收',
        stageRole: 'verify',
        stageIndex: 1,
        sessionKind: 'mainline',
        sessionName: '执行 · 主线',
        status: 'running',
        startedAt: '2026-03-24T09:30:00.000Z',
        updatedAt: '2026-03-24T09:35:00.000Z',
      },
      {
        id: 'trace-stage-3',
        stage: '验收',
        stageRole: 'verify',
        sessionKind: 'workflow_substage',
        sessionName: '验收 · 子线',
        status: 'completed',
        startedAt: '2026-03-24T09:40:00.000Z',
        completedAt: '2026-03-24T09:50:00.000Z',
      },
    ],
    decisionRecords: [
      {
        id: 'trace-decision-1',
        reason: '验收置信度不足',
        summary: '需要你决定是否继续补验。',
        status: 'needs_decision',
        createdAt: '2026-03-24T10:00:00.000Z',
      },
    ],
    reconcileRecords: [
      {
        id: 'trace-reconcile-1',
        handoffType: 'verification_result',
        summary: '子线验收已回流主线。',
        status: 'accepted',
        updatedAt: '2026-03-24T09:55:00.000Z',
      },
    ],
  },
});

assert.equal(summary?.currentTask, '修复历史会话恢复', 'summary should keep the current task label');
assert.equal(summary?.workflowStages?.length, 3, 'summary should keep the structured workflow stages');
assert.equal(summary?.workflowStages?.[1]?.label, '验收中', 'current stage labels should remain intact');
assert.equal(summary?.activeVerification?.id, 'verify-1', 'summary should still expose active verification sessions');
assert.equal(summary?.workflowTimeline?.length, 7, 'summary should expose automation events alongside stage, decision, and reconcile entries');
assert.deepEqual(
  Array.from(summary?.workflowTimeline || [], (entry) => entry.kind),
  ['event', 'event', 'decision', 'reconcile', 'stage', 'stage', 'stage'],
  'timeline entries should be sorted by recency across automation, decision, reconcile, and stage entries',
);
assert.equal(summary?.workflowTimeline?.[0]?.title, '自动启用工作流', 'timeline should surface workflow auto-trigger feedback');
assert.equal(summary?.workflowTimeline?.[1]?.title, '自动推进', 'timeline should surface workflow auto-advance feedback');
assert.equal(summary?.workflowTimeline?.[2]?.statusLabel, '待决策', 'decision entries should expose a readable status label');
assert.equal(summary?.workflowTimeline?.[3]?.title, '验收结论回流', 'reconcile entries should expose a readable handoff title');
assert.equal(summary?.workflowTimeline?.[4]?.title, '验收子线', 'substage entries should be labeled as child stages');
assert.equal(summary?.workflowTimeline?.[6]?.title, '阶段 1 · 执行', 'mainline stage entries should retain their stage ordinal');

console.log('test-chat-workflow-timeline-summary: ok');
