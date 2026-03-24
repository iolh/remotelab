export const WORKFLOW_STAGE_ROLES = Object.freeze(['execute', 'verify', 'deliberate']);

export const GATE_POLICIES = Object.freeze(['always_manual', 'low_confidence_only', 'final_confirm_only']);

export const RUNTIME_TIERS = Object.freeze(['strong', 'balanced', 'efficient']);

export const DEFAULT_ROLE_RUNTIME_HINTS = Object.freeze({
  execute: { tier: 'strong' },
  verify: { tier: 'efficient' },
  deliberate: { tier: 'strong' },
});

export const WORKFLOW_RISK_SIGNAL_KEYWORDS = Object.freeze([
  '不确定',
  '需要确认',
  '需要你',
  '风险',
  '冲突',
  'blocked',
  'breaking change',
  '无法确定',
  '建议人工',
]);

export const WORKFLOW_MODE_DEFINITIONS = Object.freeze({
  quick_execute: {
    mode: 'quick_execute',
    stages: [
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], terminal: true },
    ],
  },
  standard_delivery: {
    mode: 'standard_delivery',
    stages: [
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], terminal: false },
      { role: 'verify', appNames: ['验收', '执行验收', '风险复核'], terminal: false },
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], label: '收口', terminal: true },
    ],
  },
  careful_deliberation: {
    mode: 'careful_deliberation',
    stages: [
      { role: 'deliberate', appNames: ['再议', '深度裁决', 'PR把关', '推敲'], terminal: false },
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], terminal: false },
      { role: 'deliberate', appNames: ['再议', '深度裁决', 'PR把关', '推敲'], label: '复盘', terminal: false },
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], label: '收口', terminal: false },
      { role: 'verify', appNames: ['验收', '执行验收', '风险复核'], terminal: true },
    ],
  },
  parallel_split: {
    mode: 'parallel_split',
    stages: [
      { role: 'deliberate', appNames: ['再议', '深度裁决', 'PR把关', '推敲'], terminal: false },
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], label: '主线', terminal: false },
      { role: 'execute', appNames: ['执行', '主交付', '功能交付'], label: '支线', terminal: false },
      { role: 'verify', appNames: ['验收', '执行验收', '风险复核'], terminal: true },
    ],
  },
});

export function normalizeGatePolicy(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (GATE_POLICIES.includes(normalized)) return normalized;
  return 'low_confidence_only';
}

function normalizeRuntimeHint(hint) {
  if (!hint || typeof hint !== 'object') return null;
  const tier = typeof hint.tier === 'string' ? hint.tier.trim().toLowerCase() : '';
  if (!RUNTIME_TIERS.includes(tier)) return null;
  return { tier };
}

export function getStageRuntimeHint(stage) {
  if (!stage) return null;
  const explicit = normalizeRuntimeHint(stage.runtimeHint);
  if (explicit) return explicit;
  return DEFAULT_ROLE_RUNTIME_HINTS[stage.role] || null;
}

function normalizeStage(stage) {
  if (!isValidStage(stage)) return null;
  const appNames = stage.appNames
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);
  if (appNames.length === 0) return null;
  const runtimeHint = normalizeRuntimeHint(stage.runtimeHint);
  return {
    role: stage.role,
    appNames,
    ...(typeof stage.label === 'string' && stage.label.trim() ? { label: stage.label.trim() } : {}),
    ...(stage.terminal === true ? { terminal: true } : {}),
    ...(runtimeHint ? { runtimeHint } : {}),
  };
}

export function resolveWorkflowDefinitionForMode(mode, gatePolicy = 'low_confidence_only') {
  const template = WORKFLOW_MODE_DEFINITIONS[mode];
  if (!template) return null;
  return {
    mode: template.mode,
    stages: template.stages.map((stage) => ({ ...stage })),
    currentStageIndex: 0,
    gatePolicy: normalizeGatePolicy(gatePolicy),
    createdAt: new Date().toISOString(),
  };
}

export function normalizeWorkflowDefinition(value) {
  if (!value || typeof value !== 'object') return null;
  const mode = typeof value.mode === 'string' ? value.mode.trim() : '';
  const stages = Array.isArray(value.stages)
    ? value.stages.map((stage) => normalizeStage(stage)).filter(Boolean)
    : [];
  if (stages.length === 0) return null;
  const currentStageIndex = Number.isInteger(value.currentStageIndex) && value.currentStageIndex >= 0
    ? Math.min(value.currentStageIndex, stages.length - 1)
    : 0;
  return {
    mode,
    stages,
    currentStageIndex,
    gatePolicy: normalizeGatePolicy(value.gatePolicy),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
  };
}

function isValidStage(stage) {
  return stage
    && typeof stage === 'object'
    && typeof stage.role === 'string'
    && WORKFLOW_STAGE_ROLES.includes(stage.role)
    && Array.isArray(stage.appNames)
    && stage.appNames.length > 0;
}

export function getCurrentWorkflowStage(session) {
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  if (!definition) return null;
  return definition.stages[definition.currentStageIndex] || null;
}

export function getNextWorkflowStage(session) {
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  if (!definition) return null;
  const nextIndex = definition.currentStageIndex + 1;
  if (nextIndex >= definition.stages.length) return null;
  return { stage: definition.stages[nextIndex], index: nextIndex };
}

export function isWorkflowTerminalStage(session) {
  const current = getCurrentWorkflowStage(session);
  if (!current) return false;
  return current.terminal === true;
}

export function isWorkflowComplete(session) {
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  if (!definition) return false;
  return definition.currentStageIndex >= definition.stages.length - 1
    && definition.stages[definition.currentStageIndex]?.terminal === true;
}

export function getWorkflowSuggestionTypeForNextStage(session) {
  const next = getNextWorkflowStage(session);
  if (!next) return null;
  return getWorkflowSuggestionTypeForRole(next.stage.role);
}

export function getWorkflowSuggestionTypeForRole(role) {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalizedRole === 'verify') return 'suggest_verification';
  if (normalizedRole === 'deliberate') return 'suggest_decision';
  return null;
}

export function getWorkflowHandoffTypeForRole(role) {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalizedRole === 'verify') return 'verification_result';
  if (normalizedRole === 'deliberate') return 'decision_result';
  return null;
}

export function getWorkflowGatePolicy(session) {
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  return definition?.gatePolicy || 'low_confidence_only';
}
