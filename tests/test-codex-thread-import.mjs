#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const home = mkdtempSync(join(tmpdir(), 'remotelab-codex-import-'));
process.env.HOME = home;

const workspace = join(home, 'workspace');
mkdirSync(workspace, { recursive: true });

const threadId = '019d1194-31c3-7271-bda6-6f78311b198d';
const codexSessionsDir = join(home, '.codex', 'sessions', '2026', '03', '22');
mkdirSync(codexSessionsDir, { recursive: true });
writeFileSync(join(codexSessionsDir, `rollout-2026-03-22T02-06-57-${threadId}.jsonl`), [
  JSON.stringify({
    timestamp: '2026-03-21T18:07:13.026Z',
    type: 'session_meta',
    payload: {
      id: threadId,
      timestamp: '2026-03-21T18:06:57.988Z',
      cwd: workspace,
    },
  }),
  JSON.stringify({
    timestamp: '2026-03-21T18:07:14.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '继续这个 RemoteLab 任务' }],
    },
  }),
  JSON.stringify({
    timestamp: '2026-03-21T18:07:20.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '我先检查仓库和当前状态。' }],
    },
  }),
].join('\n'));

const {
  getHistory,
  importCodexThreadSession,
  killAll,
} = await import('./chat/session-manager.mjs');

try {
  const session = await importCodexThreadSession({ threadId });
  assert.ok(session?.id, 'import should create a RemoteLab session');
  assert.equal(session.tool, 'codex');
  assert.equal(session.folder, workspace);
  assert.equal(session.importedCodexThreadId, threadId);
  assert.equal(session.codexResumeMode, 'transcript_only');
  assert.equal(session.codexThreadId, undefined);
  assert.equal(session.providerResumeId, undefined);
  assert.equal(session.codexHomeMode, 'personal');
  assert.equal(session.name, '继续这个 RemoteLab 任务');

  const history = await getHistory(session.id);
  assert.equal(history.length, 3, 'import should add one status event and the imported messages');
  assert.equal(history[0]?.type, 'status');
  assert.match(history[0]?.content || '', /Imported existing Codex thread/);
  assert.equal(history[1]?.type, 'message');
  assert.equal(history[1]?.role, 'user');
  assert.equal(history[1]?.content, '继续这个 RemoteLab 任务');
  assert.equal(history[2]?.type, 'message');
  assert.equal(history[2]?.role, 'assistant');
  assert.equal(history[2]?.content, '我先检查仓库和当前状态。');

  console.log('test-codex-thread-import: ok');
} finally {
  killAll();
  rmSync(home, { recursive: true, force: true });
}
