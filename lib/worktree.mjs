import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { homedir } from 'os';
import { rm } from 'fs/promises';
import { pathExists, ensureDir } from '../chat/fs-utils.mjs';

const execFileAsync = promisify(execFile);

const WORKTREES_BASE = join(homedir(), '.remotelab', 'worktrees');
const TAG = '[worktree]';

function sanitizeBranchSegment(name) {
  return name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task';
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trimEnd();
}

function splitGitLines(output) {
  return String(output || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getMergeConflictFiles(repoRoot) {
  try {
    return splitGitLines(await git(['diff', '--name-only', '--diff-filter=U'], repoRoot));
  } catch {
    return [];
  }
}

export async function isGitRepo(folder) {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], folder);
    return true;
  } catch {
    return false;
  }
}

export async function getRepoRoot(folder) {
  return git(['rev-parse', '--show-toplevel'], folder);
}

export async function getCurrentBranch(repoRoot) {
  try {
    return await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  } catch {
    return null;
  }
}

export async function getCurrentCommit(repoRoot) {
  return git(['rev-parse', 'HEAD'], repoRoot);
}

export function buildWorktreePath(sessionId) {
  return join(WORKTREES_BASE, sessionId);
}

export function buildBranchName(sessionName, sessionId) {
  const segment = sanitizeBranchSegment(sessionName || '');
  const shortId = sessionId.slice(0, 8);
  return `remotelab/${segment}-${shortId}`;
}

/**
 * Create a git worktree for a session.
 * Returns { worktreePath, branch, baseRef, baseCommit, repoRoot } on success, null on failure.
 */
export async function createWorktree(repoRoot, sessionId, sessionName) {
  const worktreePath = buildWorktreePath(sessionId);
  const branch = buildBranchName(sessionName, sessionId);

  if (await pathExists(worktreePath)) {
    console.log(`${TAG} Worktree path already exists: ${worktreePath}`);
    return null;
  }

  const baseRef = await getCurrentBranch(repoRoot) || 'HEAD';
  const baseCommit = await getCurrentCommit(repoRoot);

  await ensureDir(WORKTREES_BASE);

  try {
    await git(['worktree', 'add', '-b', branch, worktreePath], repoRoot);
  } catch (err) {
    console.error(`${TAG} Failed to create worktree: ${err.message}`);
    return null;
  }

  console.log(`${TAG} Created worktree at ${worktreePath} on branch ${branch} (base: ${baseRef})`);

  return {
    worktreePath,
    branch,
    baseRef,
    baseCommit,
    repoRoot,
  };
}

/**
 * Merge a worktree branch back to its base branch.
 * Returns { success: true } or { success: false, error }.
 */
export async function mergeWorktreeBranch(repoRoot, branch, baseRef) {
  try {
    const currentBranch = await getCurrentBranch(repoRoot);
    if (currentBranch !== baseRef) {
      const status = await git(['status', '--porcelain'], repoRoot);
      if (status.trim()) {
        return {
          success: false,
          error: `主仓库有未提交的更改，无法切换到 ${baseRef} 进行合并。请先处理未提交的更改。`,
        };
      }
      await git(['checkout', baseRef], repoRoot);
    }

    await git(['merge', branch, '--no-edit'], repoRoot);

    console.log(`${TAG} Merged ${branch} into ${baseRef}`);
    return { success: true };
  } catch (err) {
    const conflictFiles = await getMergeConflictFiles(repoRoot);
    try {
      await git(['merge', '--abort'], repoRoot);
    } catch { /* may not be in a merge state */ }

    const message = err.stderr || err.message || String(err);
    console.error(`${TAG} Merge failed: ${message}`);
    return {
      success: false,
      error: conflictFiles.length > 0
        ? `合并失败，冲突文件：${conflictFiles.join('、')}`
        : `合并失败：${message}`,
      rawError: message,
      conflictFiles,
    };
  }
}

/**
 * Remove a worktree and optionally delete its branch.
 */
export async function cleanupWorktree(repoRoot, worktreePath, branch) {
  try {
    if (await pathExists(worktreePath)) {
      try {
        await git(['worktree', 'remove', worktreePath, '--force'], repoRoot);
      } catch {
        await rm(worktreePath, { recursive: true, force: true });
        await git(['worktree', 'prune'], repoRoot);
      }
      console.log(`${TAG} Removed worktree at ${worktreePath}`);
    }
  } catch (err) {
    console.error(`${TAG} Failed to remove worktree: ${err.message}`);
  }

  if (branch) {
    try {
      await git(['branch', '-d', branch], repoRoot);
      console.log(`${TAG} Deleted branch ${branch}`);
    } catch (err) {
      try {
        await git(['branch', '-D', branch], repoRoot);
        console.log(`${TAG} Force-deleted branch ${branch}`);
      } catch {
        console.error(`${TAG} Failed to delete branch ${branch}: ${err.message}`);
      }
    }
  }
}

/**
 * Get a compact diff summary for a worktree branch vs its base.
 */
export async function getWorktreeDiffSummary(repoRoot, branch, baseRef) {
  try {
    const stat = await git(['diff', '--stat', `${baseRef}...${branch}`], repoRoot);
    return stat || '(no changes)';
  } catch {
    return '(unable to compute diff)';
  }
}

export async function getWorktreeChangedFiles(repoRoot, branch, baseRef) {
  try {
    return splitGitLines(await git(['diff', '--name-only', `${baseRef}...${branch}`], repoRoot));
  } catch {
    return [];
  }
}
