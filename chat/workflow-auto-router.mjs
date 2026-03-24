function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countExplicitRequirementMarkers(text) {
  if (!text) return 0;
  const matches = text.match(/(?:^|\n)\s*(?:\d+[.)、]|[-*•])\s+/gmu);
  return Array.isArray(matches) ? matches.length : 0;
}

function countEntityMentions(text) {
  if (!text) return 0;
  const matches = text.match(/(?:文件|模块|组件|页面|接口|路由|服务|表单|列表|按钮)\s*[:：]?\s*([A-Za-z0-9_./-]{2,})/gmu);
  if (!Array.isArray(matches) || matches.length === 0) return 0;
  return new Set(matches.map((entry) => normalizeText(entry).toLowerCase())).size;
}

function hasParallelIntent(text) {
  return /(并行|同时做|同时推进|独立子任务|子任务|拆成两条|拆成两块|worktree|主线.*支线|支线.*主线)/iu.test(text);
}

function hasDesignInput(text) {
  return /(figma|mastergo|蓝湖|交互稿|视觉稿|设计稿|原型稿)/iu.test(text);
}

function hasArchitectureIntent(text) {
  return /(重构|架构|迁移|技术选型|方案对比|兼容性|跨模块|跨层|系统设计|tradeoff|取舍)/iu.test(text);
}

export function classifyTaskComplexity(text, context = {}) {
  const source = normalizeText(text);
  const fileCount = Number.isFinite(context?.fileCount) ? Number(context.fileCount) : 0;
  const entityMentions = countEntityMentions(source);
  const requirementMarkers = countExplicitRequirementMarkers(source);
  const multipleGoals = context?.hasMultipleGoals === true
    || requirementMarkers >= 2
    || /(另外|同时|以及|并且|分别|第一|第二|第三)/iu.test(source);
  const designInput = context?.hasDesignInput === true || hasDesignInput(source);
  const parallelIntent = context?.wantsParallel === true || hasParallelIntent(source);
  const architectureIntent = context?.hasArchitectureDecision === true || hasArchitectureIntent(source);

  if (parallelIntent) {
    return {
      mode: 'parallel_split',
      confidence: 'high',
      reason: '检测到并行拆分或多子任务推进意图',
    };
  }

  if (designInput) {
    return {
      mode: 'careful_deliberation',
      confidence: 'high',
      reason: '检测到设计稿或交互输入，适合先收敛方向',
    };
  }

  if (architectureIntent) {
    return {
      mode: 'careful_deliberation',
      confidence: 'high',
      reason: '检测到架构级决策或重构意图，适合先再议',
    };
  }

  if (source.length > 500 || multipleGoals) {
    return {
      mode: 'standard_delivery',
      confidence: source.length > 700 || requirementMarkers >= 3 ? 'high' : 'medium',
      reason: '任务描述较长或包含多个明确需求点，适合标准交付链路',
    };
  }

  if (fileCount > 3 || entityMentions > 3) {
    return {
      mode: 'standard_delivery',
      confidence: 'medium',
      reason: '涉及多个文件、模块或组件，建议保留独立验收阶段',
    };
  }

  return {
    mode: 'quick_execute',
    confidence: source.length <= 120 ? 'high' : 'medium',
    reason: '任务边界相对集中，适合先单轮直接推进',
  };
}
