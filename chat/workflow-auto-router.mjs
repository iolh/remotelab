const PARALLEL_INTENT_PATTERNS = Object.freeze([
  /并行/u,
  /拆分/u,
  /独立的子任务/u,
  /同时做/u,
  /同时处理/u,
  /parallel/iu,
]);

const DESIGN_INPUT_PATTERNS = Object.freeze([
  /https?:\/\/[^\s]*figma\.com[^\s]*/iu,
  /https?:\/\/[^\s]*lanhuapp?\.com[^\s]*/iu,
  /https?:\/\/[^\s]*mastergo\.com[^\s]*/iu,
  /交互稿/u,
  /视觉稿/u,
  /设计稿/u,
  /蓝湖/u,
  /mastergo/iu,
  /figma/iu,
]);

const ARCHITECTURE_PATTERNS = Object.freeze([
  /重构/u,
  /架构/u,
  /迁移/u,
  /方案对比/u,
  /技术选型/u,
  /系统设计/u,
  /改造方案/u,
]);

const REQUIREMENT_POINT_PATTERNS = Object.freeze([
  /(?:^|\n)\s*\d+[.)、]\s+/gu,
  /(?:^|\n)\s*[一二三四五六七八九十]+[、.)]\s+/gu,
  /需求\s*\d+/gu,
]);

const ENTITY_PATTERNS = Object.freeze([
  /`([^`]+)`/gu,
  /\b[A-Z][A-Za-z0-9]{2,}\b/gu,
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/gu,
  /\b[A-Za-z0-9_./-]+\.[A-Za-z0-9_./-]+\b/gu,
]);

const ENTITY_STOP_WORDS = new Set([
  'Figma',
  'Mastergo',
  'Lanhu',
  'workflow',
  'auto',
  'Users',
  'liuhao',
  'http',
  'https',
  'json',
]);

export const WORKFLOW_AUTO_ROUTING_RULES = Object.freeze([
  { id: 'parallel_intent', mode: 'parallel_split', confidence: 'high', reason: '检测到并行/拆分意图' },
  { id: 'design_input', mode: 'careful_deliberation', confidence: 'high', reason: '检测到设计稿输入' },
  { id: 'architecture_scope', mode: 'careful_deliberation', confidence: 'high', reason: '检测到架构级决策需求' },
  { id: 'multi_requirement', mode: 'standard_delivery', confidence: 'medium', reason: '任务描述较长或包含多个需求点' },
  { id: 'multi_entity', mode: 'standard_delivery', confidence: 'medium', reason: '涉及多个文件、模块或组件' },
  { id: 'default', mode: 'quick_execute', confidence: 'medium', reason: '任务边界较集中，适合直接执行' },
]);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasAnyPattern(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function countRequirementPoints(text) {
  return REQUIREMENT_POINT_PATTERNS.reduce((count, pattern) => count + ((text.match(pattern) || []).length), 0);
}

function collectEntityMentions(text) {
  const matches = new Set();
  for (const pattern of ENTITY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const raw = normalizeText(match?.[1] || match?.[0] || '');
      if (!raw || raw.length < 3 || ENTITY_STOP_WORDS.has(raw)) continue;
      matches.add(raw);
    }
  }
  return [...matches];
}

export function classifyTaskComplexity(text, context = {}) {
  const normalizedText = normalizeText(text);
  const entityMentions = collectEntityMentions(normalizedText);
  const requirementPointCount = countRequirementPoints(normalizedText);
  const fileCount = Number.isInteger(context?.fileCount) ? context.fileCount : 0;

  if (context?.hasMultipleGoals === true || hasAnyPattern(normalizedText, PARALLEL_INTENT_PATTERNS)) {
    return { ...WORKFLOW_AUTO_ROUTING_RULES[0] };
  }

  if (context?.hasDesignInput === true || hasAnyPattern(normalizedText, DESIGN_INPUT_PATTERNS)) {
    return { ...WORKFLOW_AUTO_ROUTING_RULES[1] };
  }

  if (hasAnyPattern(normalizedText, ARCHITECTURE_PATTERNS)) {
    return { ...WORKFLOW_AUTO_ROUTING_RULES[2] };
  }

  if (normalizedText.length > 500 || requirementPointCount >= 2) {
    return { ...WORKFLOW_AUTO_ROUTING_RULES[3] };
  }

  if (fileCount > 3 || entityMentions.length > 3) {
    return { ...WORKFLOW_AUTO_ROUTING_RULES[4] };
  }

  return { ...WORKFLOW_AUTO_ROUTING_RULES[5] };
}
