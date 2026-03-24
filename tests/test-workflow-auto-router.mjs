#!/usr/bin/env node
import assert from 'assert/strict';
import { classifyTaskComplexity } from '../chat/workflow-auto-router.mjs';

{
  const route = classifyTaskComplexity('请把搜索页拆成主线和支线并行推进，两个子任务分别处理筛选和结果列表。');
  assert.equal(route.mode, 'parallel_split');
  assert.equal(route.confidence, 'high');
}

{
  const route = classifyTaskComplexity('根据 Figma 设计稿重构搜索页交互，先判断筛选和空态该怎么改。');
  assert.equal(route.mode, 'careful_deliberation');
  assert.equal(route.confidence, 'high');
}

{
  const route = classifyTaskComplexity('这个需求涉及架构迁移和跨模块重构，需要先比较方案取舍。');
  assert.equal(route.mode, 'careful_deliberation');
  assert.equal(route.confidence, 'high');
}

{
  const route = classifyTaskComplexity([
    '需求如下：',
    '1. 调整搜索页结果列表',
    '2. 补齐筛选回填',
    '3. 修复空态按钮',
  ].join('\n'));
  assert.equal(route.mode, 'standard_delivery');
}

{
  const route = classifyTaskComplexity('修复移动端登录按钮无响应。');
  assert.equal(route.mode, 'quick_execute');
}

console.log('test-workflow-auto-router: ok');
