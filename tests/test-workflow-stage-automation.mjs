#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'remotelab-workflow-auto-'));

process.env.HOME = tempHome;

await fs.mkdir(path.join(tempHome, '.config', 'remotelab'), { recursive: true });
await fs.writeFile(
  path.join(tempHome, '.config', 'remotelab', 'tools.json'),
  `${JSON.stringify([
    {
      id: 'fake-codex',
      name: 'Fake Codex',
      command: 'fake-codex',
      runtimeFamily: 'codex-json',
      models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
      reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
    },
  ], null, 2)}\n`,
  'utf8',
);

const {
  createSession,
  detectRunRiskSignals,
  getSession,
  handoffSessionResult,
  shouldAutoAdvanceWorkflowStage,
} = await import('../chat/session-manager.mjs');
const { appendEvent, loadHistory } = await import('../chat/history.mjs');
const { mutateSessionMeta } = await import('../chat/session-meta-store.mjs');
const { messageEvent } = await import('../chat/normalizer.mjs');

function buildStandardDeliverySession(gatePolicy) {
  return {
    workflowDefinition: {
      mode: 'standard_delivery',
      gatePolicy,
      currentStageIndex: 0,
      createdAt: new Date().toISOString(),
      stages: [
        { role: 'execute', appNames: ['执行'], terminal: false },
        { role: 'verify', appNames: ['验收'], terminal: false },
        { role: 'execute', appNames: ['执行'], terminal: true },
      ],
    },
  };
}

async function setCurrentStageIndex(sessionId, index) {
  await mutateSessionMeta(sessionId, (session) => {
    if (!session.workflowDefinition || typeof session.workflowDefinition !== 'object') return false;
    session.workflowDefinition = {
      ...session.workflowDefinition,
      currentStageIndex: index,
    };
    session.updatedAt = new Date().toISOString();
    return true;
  });
}

function findConclusion(session, sourceSessionId) {
  return (session.workflowPendingConclusions || []).find((entry) => entry.sourceSessionId === sourceSessionId) || null;
}

async function createVerificationTarget(name, gatePolicy = 'low_confidence_only') {
  const session = await createSession(repoRoot, 'fake-codex', name, {
    appName: '执行',
    workflowMode: 'standard_delivery',
    gatePolicy,
  });
  await setCurrentStageIndex(session.id, 1);
  return (await getSession(session.id)) || session;
}

async function createSourceSession(name, runId, content) {
  const session = await createSession(repoRoot, 'fake-codex', name, {
    appName: '验收',
  });
  await appendEvent(session.id, messageEvent('assistant', content, undefined, { runId }));
  return session;
}

try {
  assert.equal(
    shouldAutoAdvanceWorkflowStage(buildStandardDeliverySession('low_confidence_only'), 'suggest_verification'),
    true,
    'low_confidence_only should auto-advance non-terminal suggestions when no risk signal is present',
  );
  assert.equal(
    shouldAutoAdvanceWorkflowStage(
      buildStandardDeliverySession('low_confidence_only'),
      'suggest_verification',
      { hasRiskSignals: true },
    ),
    false,
    'risk signals should block low_confidence_only auto-advance',
  );
  assert.equal(
    shouldAutoAdvanceWorkflowStage(buildStandardDeliverySession('final_confirm_only'), 'suggest_verification'),
    true,
    'final_confirm_only should auto-advance non-terminal suggestions when no risk signal is present',
  );
  assert.equal(
    shouldAutoAdvanceWorkflowStage(
      buildStandardDeliverySession('final_confirm_only'),
      'suggest_verification',
      { hasRiskSignals: true },
    ),
    false,
    'risk signals should block final_confirm_only auto-advance',
  );
  assert.equal(
    shouldAutoAdvanceWorkflowStage(buildStandardDeliverySession('always_manual'), 'suggest_verification'),
    false,
    'always_manual should never auto-advance suggestions',
  );
  assert.equal(
    shouldAutoAdvanceWorkflowStage(
      buildStandardDeliverySession('always_manual'),
      'suggest_verification',
      { hasRiskSignals: true },
    ),
    false,
    'always_manual should remain manual even when risk signals are present',
  );

  await appendEvent('risk-session', messageEvent(
    'assistant',
    '当前方案存在风险，需要确认后再继续。',
    undefined,
    { runId: 'run-risk' },
  ));
  const riskSignals = await detectRunRiskSignals({ id: 'risk-session' }, 'run-risk');
  assert.equal(riskSignals.hasRiskSignals, true, 'detectRunRiskSignals should flag configured risk keywords');
  assert.equal(riskSignals.matches.includes('风险'), true, 'detectRunRiskSignals should report matched risk keywords');
  assert.equal(riskSignals.matches.includes('需要确认'), true, 'detectRunRiskSignals should report confirmation keywords');

  await appendEvent('safe-session', messageEvent(
    'assistant',
    '验收通过，主流程可以继续推进。',
    undefined,
    { runId: 'run-safe' },
  ));
  const safeSignals = await detectRunRiskSignals({ id: 'safe-session' }, 'run-safe');
  assert.equal(safeSignals.hasRiskSignals, false, 'detectRunRiskSignals should ignore safe outputs');
  assert.deepEqual(safeSignals.matches, [], 'safe outputs should not report matched keywords');

  const highTarget = await createVerificationTarget('执行 · 高置信度自动吸收');
  const highSource = await createSourceSession('验收 · 高置信度自动吸收', 'run-high', '验收通过，主流程可继续推进。');
  const highOutcome = await handoffSessionResult(highSource.id, {
    targetSessionId: highTarget.id,
    handoffType: 'verification_result',
    summary: '验收通过，主流程可继续推进。',
    payload: {
      summary: '验收通过，主流程可继续推进。',
      recommendation: 'ok',
      confidence: 'high',
      validated: ['主流程冒烟'],
      evidence: ['自动化校验'],
    },
    sourceRunId: 'run-high',
  });
  assert.equal(highOutcome.handoff?.status, 'accepted', 'high-confidence ok conclusions should auto-accept');
  const highTargetDetail = await getSession(highTarget.id);
  assert.equal(findConclusion(highTargetDetail, highSource.id)?.status, 'accepted', 'auto-accepted conclusions should persist as accepted');
  assert.equal(highTargetDetail.workflowDefinition?.currentStageIndex, 2, 'auto-accepted conclusions should advance the workflow stage');
  const highEvents = await loadHistory(highTarget.id, { includeBodies: true });
  assert.equal(
    highEvents.some((event) => event.type === 'workflow_auto_absorb' && /已自动吸收/.test(event.content || '')),
    true,
    'auto-accepted conclusions should leave a workflow_auto_absorb history event',
  );

  const lowTarget = await createVerificationTarget('执行 · 低置信度待处理', 'final_confirm_only');
  const lowSource = await createSourceSession('验收 · 低置信度待处理', 'run-low', '需要更多观察后再确认。');
  const lowOutcome = await handoffSessionResult(lowSource.id, {
    targetSessionId: lowTarget.id,
    handoffType: 'verification_result',
    summary: '需要更多观察后再确认。',
    payload: {
      summary: '需要更多观察后再确认。',
      recommendation: 'ok',
      confidence: 'low',
      validated: ['基础路径'],
      evidence: ['人工检查'],
    },
    sourceRunId: 'run-low',
  });
  assert.equal(lowOutcome.handoff?.status, 'pending', 'low-confidence conclusions should stay pending');
  const lowTargetDetail = await getSession(lowTarget.id);
  assert.equal(findConclusion(lowTargetDetail, lowSource.id)?.status, 'pending', 'low-confidence conclusions should remain pending');
  assert.equal(lowTargetDetail.workflowDefinition?.currentStageIndex, 1, 'pending conclusions should not advance the workflow stage');

  const needsFixTarget = await createVerificationTarget('执行 · needs_fix 待处理', 'final_confirm_only');
  const needsFixSource = await createSourceSession('验收 · needs_fix 待处理', 'run-needs-fix', '发现问题，需要后续修复。');
  const needsFixOutcome = await handoffSessionResult(needsFixSource.id, {
    targetSessionId: needsFixTarget.id,
    handoffType: 'verification_result',
    summary: '发现问题，需要后续修复。',
    payload: {
      summary: '发现问题，需要后续修复。',
      recommendation: 'needs_fix',
      confidence: 'high',
      findings: ['边界条件仍未通过'],
      evidence: ['手动复测'],
    },
    sourceRunId: 'run-needs-fix',
  });
  assert.equal(needsFixOutcome.handoff?.status, 'pending', 'needs_fix conclusions should remain pending when gate policy keeps them pending');
  const needsFixTargetDetail = await getSession(needsFixTarget.id);
  assert.equal(findConclusion(needsFixTargetDetail, needsFixSource.id)?.status, 'pending', 'needs_fix conclusions should not auto-accept');
  assert.equal(needsFixTargetDetail.workflowDefinition?.currentStageIndex, 1, 'needs_fix conclusions should not advance the workflow stage');

  console.log('test-workflow-stage-automation: ok');
} finally {
  await fs.rm(tempHome, { recursive: true, force: true });
}
