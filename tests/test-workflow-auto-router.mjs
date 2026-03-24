#!/usr/bin/env node
import assert from 'assert/strict';
import { classifyTaskComplexity } from '../chat/workflow-auto-router.mjs';

const parallel = classifyTaskComplexity('请并行处理登录页和报表页，这两个是独立的子任务。');
assert.equal(parallel.mode, 'parallel_split', 'parallel intent should route to parallel_split');
assert.equal(parallel.confidence, 'high', 'parallel intent should be high confidence');

const design = classifyTaskComplexity('请按照 https://www.figma.com/file/abc123/mock 里的交互稿完成实现。');
assert.equal(design.mode, 'careful_deliberation', 'design inputs should route to careful_deliberation');
assert.match(design.reason, /设计稿/u, 'design routing should explain the detected design input');

const architecture = classifyTaskComplexity('这次需要先做架构迁移评估，再给出技术选型建议。');
assert.equal(architecture.mode, 'careful_deliberation', 'architecture work should route to careful_deliberation');

const multiRequirement = classifyTaskComplexity([
  '目标：做一次中等规模改造',
  '1. 重写筛选条件区域',
  '2. 补齐结果列表空态',
  '3. 处理移动端适配',
].join('\n'));
assert.equal(multiRequirement.mode, 'standard_delivery', 'multiple explicit requirements should route to standard_delivery');

const multiEntity = classifyTaskComplexity('请同时调整 NodeConfigDrawer、WorkflowCanvas、SessionSurfacePanel 和 RunSummaryCard 的交互细节。');
assert.equal(multiEntity.mode, 'standard_delivery', 'multiple component mentions should route to standard_delivery');

const defaultRoute = classifyTaskComplexity('修一下空指针。');
assert.equal(defaultRoute.mode, 'quick_execute', 'small scoped tasks should default to quick_execute');

const contextDriven = classifyTaskComplexity('帮我落地这个页面。', { hasDesignInput: true });
assert.equal(contextDriven.mode, 'careful_deliberation', 'context.hasDesignInput should influence routing');

console.log('test-workflow-auto-router: ok');
