import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { promisify } from 'util';
import { join } from 'path';
import {
  getToolDefinitionAsync,
  resolveToolCommandPathAsync,
} from '../lib/tools.mjs';

// Claude Code has no model cache file — hardcode the known aliases.
// These alias names are stable; the full model IDs behind them update automatically.
const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus',   label: 'Opus 4.6'   },
  { id: 'haiku',  label: 'Haiku 4.5'  },
];
const CURSOR_FALLBACK_MODELS = [
  { id: 'auto', label: 'Auto' },
  { id: 'claude-4.6-opus-high-thinking', label: 'Opus 4.6 1M Thinking' },
  { id: 'claude-4.6-opus-high', label: 'Opus 4.6 1M' },
  { id: 'claude-4.6-opus-max-thinking', label: 'Opus 4.6 1M Max Thinking' },
  { id: 'claude-4.6-opus-max', label: 'Opus 4.6 1M Max' },
  { id: 'claude-4.6-sonnet-medium-thinking', label: 'Sonnet 4.6 1M Thinking' },
  { id: 'claude-4.6-sonnet-medium', label: 'Sonnet 4.6 1M' },
];
let codexModelsCache = null;
let cursorModelsCache = null;
const execFileAsync = promisify(execFile);

function buildCursorModelsResult(models, defaultModel = null) {
  const normalizedModels = Array.isArray(models) ? models.filter(Boolean) : [];
  const fallbackDefault = normalizedModels.find((model) => model.id === 'auto')?.id
    || defaultModel
    || normalizedModels[0]?.id
    || null;
  return {
    models: normalizedModels,
    effortLevels: null,
    defaultModel: fallbackDefault,
    reasoning: { kind: 'none', label: 'Thinking' },
  };
}

function mergeCursorModels(primaryModels = [], supplementalModels = []) {
  const merged = [];
  const seen = new Set();

  for (const entry of [...primaryModels, ...supplementalModels]) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push({
      id,
      label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
    });
  }

  return merged;
}

function summarizeCursorModelIds(models = []) {
  return models
    .map((model) => (typeof model?.id === 'string' ? model.id.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

/** Strip CSI/OSC so cursor-agent TTY output still parses in non-interactive runs. */
function stripAnsi(text) {
  return String(text || '')
    .replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

export function parseCursorModelsOutput(raw) {
  const lines = stripAnsi(String(raw || ''))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const models = [];
  let defaultModel = null;

  for (const line of lines) {
    const match = /^(.+?)\s+-\s+(.+?)(?:\s+\(([^)]*)\))?$/.exec(line);
    if (!match) continue;

    const id = String(match[1] || '').trim();
    const label = String(match[2] || '').trim() || id;
    const suffix = String(match[3] || '').trim().toLowerCase();
    if (!id || id.toLowerCase() === 'available models') continue;

    models.push({ id, label });
    if (!defaultModel && suffix.includes('default')) {
      defaultModel = id;
    }
  }

  return {
    models,
    defaultModel: defaultModel || models[0]?.id || null,
  };
}

/**
 * Returns { models, effortLevels } for a given tool.
 * - models: [{ id, label, defaultEffort?, effortLevels? }]
 * - effortLevels: string[] | null (null means tool uses a binary thinking toggle)
 */
export async function getModelsForTool(toolId) {
  if (toolId === 'claude') {
    return {
      models: CLAUDE_MODELS,
      effortLevels: null,
      defaultModel: null,
      reasoning: { kind: 'toggle', label: 'Thinking' },
    };
  }
  if (toolId === 'codex') {
    return getCodexModels();
  }
  if (toolId === 'cursor') {
    return getCursorModels();
  }

  const tool = await getToolDefinitionAsync(toolId);
  if (tool?.runtimeFamily) {
    const reasoning = tool.reasoning || { kind: 'none', label: 'Thinking' };
    const models = (tool.models || []).map(model => ({
      id: model.id,
      label: model.label,
      ...(reasoning.kind === 'enum'
        ? { defaultEffort: model.defaultReasoning || reasoning.default || null }
        : {}),
    }));

    return {
      models,
      effortLevels: reasoning.kind === 'enum' ? reasoning.levels || [] : null,
      defaultModel: models[0]?.id || null,
      reasoning,
    };
  }

  return {
    models: [],
    effortLevels: null,
    defaultModel: null,
    reasoning: { kind: 'none', label: 'Thinking' },
  };
}

async function getCodexModels() {
  if (codexModelsCache) {
    return codexModelsCache;
  }
  try {
    const raw = await readFile(join(homedir(), '.codex', 'models_cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    const models = (data.models || [])
      .filter(m => m.visibility === 'list')
      .map(m => ({
        id: m.slug,
        label: m.display_name,
        defaultEffort: m.default_reasoning_level || 'medium',
        effortLevels: (m.supported_reasoning_levels || []).map(r => r.effort),
      }));
    // Union of all effort levels across all visible models
    const effortLevels = [...new Set(models.flatMap(m => m.effortLevels))];
    codexModelsCache = {
      models,
      effortLevels,
      defaultModel: null,
      reasoning: {
        kind: 'enum',
        label: 'Thinking',
        levels: effortLevels,
        default: models[0]?.defaultEffort || effortLevels[0] || 'medium',
      },
    };
    return codexModelsCache;
  } catch {
    codexModelsCache = {
      models: [],
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultModel: null,
      reasoning: {
        kind: 'enum',
        label: 'Thinking',
        levels: ['low', 'medium', 'high', 'xhigh'],
        default: 'medium',
      },
    };
    return codexModelsCache;
  }
}

async function getCursorModels() {
  if (cursorModelsCache) {
    return cursorModelsCache;
  }

  try {
    const resolvedCmd = await resolveToolCommandPathAsync('cursor-agent');
    if (!resolvedCmd) {
      throw new Error('cursor-agent not found');
    }

    const { stdout, stderr } = await execFileAsync(resolvedCmd, ['models'], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = parseCursorModelsOutput(`${stdout || ''}\n${stderr || ''}`);
    if (!parsed.models.length) {
      throw new Error('no cursor models parsed');
    }

    const mergedModels = mergeCursorModels(parsed.models, CURSOR_FALLBACK_MODELS);
    console.log(
      `[cursor-models] cursor-agent returned ${parsed.models.length} models: ${summarizeCursorModelIds(parsed.models)}; `
      + `RemoteLab merged ${mergedModels.length} models: ${summarizeCursorModelIds(mergedModels)}`
    );
    cursorModelsCache = buildCursorModelsResult(
      mergedModels,
      parsed.defaultModel,
    );
    return cursorModelsCache;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[cursor-models] Falling back to built-in cursor model list because cursor-agent model discovery failed: ${message}`
    );
    cursorModelsCache = buildCursorModelsResult(CURSOR_FALLBACK_MODELS, 'auto');
    return cursorModelsCache;
  }
}

const CURSOR_TIER_PATTERNS = {
  strong: [/opus.*thinking/i, /opus/i],
  balanced: [/sonnet.*thinking/i, /sonnet/i],
  efficient: [/haiku/i, /sonnet(?!.*thinking)/i, /sonnet/i],
};

function pickCursorModelForTier(tier) {
  const patterns = CURSOR_TIER_PATTERNS[tier];
  if (!patterns) return null;
  const candidates = (cursorModelsCache?.models || CURSOR_FALLBACK_MODELS)
    .map((m) => m.id)
    .filter((id) => id !== 'auto');
  for (const pattern of patterns) {
    const match = candidates.find((id) => pattern.test(id));
    if (match) return match;
  }
  return null;
}

/**
 * Given a runtime tier ('strong' | 'balanced' | 'efficient') and a tool ID,
 * returns an override object { model?, effort?, thinking? } to apply on top of
 * the parent session defaults. Returns null if no override can be determined.
 */
export function resolveRuntimeOverrideForTier(tier, toolId) {
  const normalizedTier = typeof tier === 'string' ? tier.trim().toLowerCase() : '';
  const normalizedTool = typeof toolId === 'string' ? toolId.trim().toLowerCase() : '';
  if (!normalizedTier || !normalizedTool) return null;

  if (normalizedTool === 'claude') {
    if (normalizedTier === 'strong') return { model: 'opus', thinking: true };
    if (normalizedTier === 'balanced') return { model: 'sonnet', thinking: true };
    if (normalizedTier === 'efficient') return { model: 'haiku' };
    return null;
  }

  if (normalizedTool === 'cursor') {
    const model = pickCursorModelForTier(normalizedTier);
    return model ? { model } : null;
  }

  if (normalizedTool === 'codex') {
    if (normalizedTier === 'strong') return { effort: 'high' };
    if (normalizedTier === 'balanced') return { effort: 'medium' };
    if (normalizedTier === 'efficient') return { effort: 'low' };
    return null;
  }

  if (normalizedTier === 'strong') return { effort: 'high' };
  if (normalizedTier === 'efficient') return { effort: 'low' };
  return null;
}
