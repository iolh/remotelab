import { copyFile, lstat, readFile, readlink, symlink, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { CODEX_MANAGED_HOME_DIR } from '../lib/config.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  pathExists,
  writeTextAtomic,
} from './fs-utils.mjs';

export const MANAGER_RUNTIME_BOUNDARY_SECTION = [
  '## Manager Policy Boundary',
  '',
  'RemoteLab owns memory activation, workflow policy, and default reply style.',
  'Treat provider runtimes such as Codex or Claude as execution engines under manager control, not as the top-level manager.',
  'Use the prompt stack to synchronize principles, boundaries, and default assembly rules, not to script every action as a hidden SOP.',
  'Treat RemoteLab\'s startup guidance as an editable seed layer: a default constitution and capability scaffold that users may later refine, replace, or prune as their own workflow matures.',
  'Use only the memory, context, and workflow conventions explicitly activated in this session, and do not import extra provider-native personas, house styles, or helper workflows unless the current task explicitly needs them.',
  'For normal conversation and conceptual discussion, default to natural connected prose. Use headings, bullet lists, JSON, or checklists only when the user explicitly asks for them or when clarity truly requires them.',
  'For summaries and handoffs, default to state-first reorientation: current execution state, whether the user is needed now, or whether the work can stay parked for later.',
].join('\n');

export const MANAGER_TURN_POLICY_REMINDER = [
  'RemoteLab remains the manager for this turn.',
  'Keep the hidden prompt light: reinforce invariants and current state, not verbose step-by-step scripts.',
  'Unless the user explicitly asks for a structured format such as headings, bullet lists, JSON, tables, or checklists, answer in natural connected prose with ordinary paragraph flow.',
  'Do not mirror the manager prompt structure or provider-native report formatting back to the user by default.',
  'In summaries or handoffs, lead with the current execution state, then whether the user is needed now or the work can stay parked for later.',
].join(' ');

export const DEFAULT_CODEX_DEVELOPER_INSTRUCTIONS = [
  'You are running inside RemoteLab.',
  'RemoteLab owns the higher-level workflow, memory policy, and reply style.',
  'Treat Codex as a runtime under manager control, not as the top-level product persona.',
  'Do not impose a strong built-in persona, house style, or product-specific workflow beyond the context explicitly provided for this task.',
  'Treat the startup prompt as an editable seed layer rather than rigid law; users may refine or replace it over time.',
  'Use prompt guidance to preserve principles and boundaries, not to offload judgment that should come from the current task context.',
  'Use only the memory, context, and workflow conventions explicitly activated in this session.',
  'For normal user-facing replies, default to plain connected prose rather than report formatting.',
  'Do not use headings, bullet lists, or checklist formatting unless the user explicitly asks for them or the task truly cannot be answered clearly without them.',
  'Do not mirror the manager prompt structure, section headers, or provider-native handoff template back to the user by default.',
  'For short explanations, conceptual discussion, and back-and-forth conversation, answer in natural paragraphs instead of list form.',
  'For summaries and handoffs, lead with current execution state, then whether the user is needed now or the work can stay parked for later.',
  'If the task explicitly asks for structured output, code, JSON, tables, checklists, or another format, follow that format exactly.',
  'Treat unstated preferences as open and adaptable; let the user and session context shape tone and working style over time.',
].join(' ');

export const CODEX_VERIFICATION_READ_ONLY_DEVELOPER_INSTRUCTIONS = [
  'This run is in execution verification mode.',
  'Treat the workspace as read-only.',
  'Do not create, edit, rename, or delete files.',
  'Do not run git commit, git rebase, git reset, or any command whose purpose is to mutate the repository state.',
  'Focus on inspection, test execution, reading code, and collecting verification evidence.',
  'If a useful verification step would require mutating files or repository state, say it is unverified instead of working around the restriction.',
].join(' ');

const DEFAULT_CODEX_HOME_MODE = 'managed';
const MANAGED_CODEX_HOME_NOTES = [
  '# RemoteLab-managed Codex runtime home.',
  '# Keep this intentionally minimal.',
  '# RemoteLab injects workflow, memory policy, and reply-style steering per run.',
  '',
].join('\n');

const PERSONAL_CODEX_HOME = join(homedir(), '.codex');
const PERSONAL_CODEX_AUTH_FILE = join(PERSONAL_CODEX_HOME, 'auth.json');
const managedCodexHomeQueue = createSerialTaskQueue();

function normalizeCodexHomeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'personal' || normalized === 'inherit') {
    return 'personal';
  }
  return DEFAULT_CODEX_HOME_MODE;
}

function extractManagedCodexMcpSections(configText = '') {
  const normalized = String(configText || '');
  if (!normalized.trim()) {
    return '';
  }

  const preservedSections = [];
  const lines = normalized.split(/\r?\n/);
  let currentSectionName = '';
  let currentSectionLines = [];

  const flushSection = () => {
    if (!currentSectionName || !currentSectionLines.length) {
      currentSectionName = '';
      currentSectionLines = [];
      return;
    }

    preservedSections.push(currentSectionLines.join('\n').trimEnd());
    currentSectionName = '';
    currentSectionLines = [];
  };

  for (const line of lines) {
    const match = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (match) {
      flushSection();
      const sectionName = match[1].trim();
      if (sectionName === 'mcp_servers' || sectionName.startsWith('mcp_servers.')) {
        currentSectionName = sectionName;
        currentSectionLines = [line];
      }
      continue;
    }

    if (currentSectionName) {
      currentSectionLines.push(line);
    }
  }

  flushSection();
  return preservedSections.join('\n\n');
}

function buildManagedCodexConfig(existingConfigText = '') {
  const preservedMcpSections = extractManagedCodexMcpSections(existingConfigText);
  if (!preservedMcpSections) {
    return MANAGED_CODEX_HOME_NOTES;
  }
  return `${MANAGED_CODEX_HOME_NOTES}${preservedMcpSections}\n`;
}

async function ensureSymlinkOrCopy(sourcePath, targetPath) {
  if (!await pathExists(sourcePath)) {
    return false;
  }

  try {
    const existing = await lstat(targetPath);
    if (existing.isSymbolicLink()) {
      const currentTarget = await readlink(targetPath);
      if (currentTarget === sourcePath) {
        return true;
      }
    }
    await unlink(targetPath);
  } catch {
  }

  try {
    await symlink(sourcePath, targetPath);
    return true;
  } catch {
  }

  try {
    await copyFile(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureManagedCodexHome(options = {}) {
  return managedCodexHomeQueue(async () => {
    const homeDir = typeof options.homeDir === 'string' && options.homeDir.trim()
      ? options.homeDir.trim()
      : CODEX_MANAGED_HOME_DIR;
    const authSource = typeof options.authSource === 'string' && options.authSource.trim()
      ? options.authSource.trim()
      : PERSONAL_CODEX_AUTH_FILE;

    await ensureDir(homeDir);
    const configPath = join(homeDir, 'config.toml');
    let existingConfigText = '';
    try {
      existingConfigText = await readFile(configPath, 'utf8');
    } catch {
    }
    await writeTextAtomic(configPath, buildManagedCodexConfig(existingConfigText));
    await writeTextAtomic(join(homeDir, 'AGENTS.md'), '');
    await ensureSymlinkOrCopy(authSource, join(homeDir, 'auth.json'));
    return homeDir;
  });
}

export async function applyManagedRuntimeEnv(toolId, baseEnv = {}, options = {}) {
  const env = { ...baseEnv };
  const runtimeFamily = typeof options.runtimeFamily === 'string'
    ? options.runtimeFamily.trim()
    : '';
  const isCodexRuntime = toolId === 'codex' || runtimeFamily === 'codex-json';
  if (!isCodexRuntime) {
    return env;
  }

  const mode = normalizeCodexHomeMode(options.codexHomeMode || process.env.REMOTELAB_CODEX_HOME_MODE);
  if (mode === 'personal') {
    return env;
  }

  const managedHome = await ensureManagedCodexHome({
    homeDir: options.codexHomeDir,
    authSource: options.codexAuthSource,
  });
  delete env.CODEX_HOME;
  env.CODEX_HOME = managedHome;
  return env;
}
