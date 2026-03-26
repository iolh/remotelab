#!/usr/bin/env node
import assert from 'assert/strict';
import {
  buildWorkflowDeliberationSessionName,
  buildWorkflowVerificationSessionName,
} from '../chat/workflow-engine.mjs';

const shortFromMainlineName = buildWorkflowVerificationSessionName({
  name: '执行 · 认证模块改造',
});
assert.equal(
  shortFromMainlineName,
  '验收 · 认证模块改造',
  'verification session names should reuse a concise mainline task name when available',
);

const longFromDescription = buildWorkflowVerificationSessionName({
  name: 'Workflow 链路验收测试',
  description: 'Workflow 链路验收测试，开启复杂任务提示，当前任务仍在等待 intake 确认，请点击“开始”或“取消”，或使用 /form 修改字段。但是没有找到开始按钮，是不是交互逻辑有问题。',
});
assert.ok(
  longFromDescription.startsWith('验收 · Workflow 链路验收测试，开启复杂任务提示'),
  'verification session names should preserve a useful one-line prefix',
);
assert.ok(
  longFromDescription.endsWith('…'),
  'long verification session names should end with an ellipsis',
);
assert.ok(
  !longFromDescription.includes('\n'),
  'verification session names should stay on one line',
);
assert.ok(
  !longFromDescription.includes('[... truncated by RemoteLab ...]'),
  'verification session names should not embed compaction markers',
);

const longDeliberationName = buildWorkflowDeliberationSessionName({
  currentTask: '评估从 REST 迁移到 tRPC 的影响范围、风险、回滚方案，以及与现有鉴权中间件的兼容性。',
});
assert.ok(
  longDeliberationName.startsWith('再议 · 评估从 REST 迁移到 tRPC'),
  'deliberation session names should use the current task text when present',
);
assert.ok(!longDeliberationName.includes('\n'));
assert.ok(!longDeliberationName.includes('[... truncated by RemoteLab ...]'));

console.log('test-workflow-substage-session-name: ok');
