#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-legacy-video-cut-app-'));
process.env.HOME = tempHome;

const appsModule = await import(pathToFileURL(join(repoRoot, 'chat', 'apps.mjs')).href);

const {
  getApp,
  getAppByShareToken,
  listApps,
} = appsModule;

try {
  const initialApps = await listApps();
  assert.equal(initialApps.some((app) => app.id === 'app_video_cut'), false, 'clean installs should not list Video Cut as a shipped app');
  assert.equal(await getApp('app_video_cut'), null, 'clean installs should not resolve Video Cut by id');

  const migrated = await getAppByShareToken('share_builtin_video_cut_84f1b7fa9de446c59994a1d4a57f1316');
  assert.equal(migrated?.id, 'app_video_cut', 'legacy public share links should materialize a regular Video Cut app');
  assert.notEqual(migrated?.builtin, true, 'legacy materialization should not revive Video Cut as a built-in app');
  assert.match(migrated?.systemPrompt || '', /video-cut workflow|Video Cut Review|~\/code\/video-cut/i);

  const appsAfterMigration = await listApps();
  assert.equal(appsAfterMigration.some((app) => app.id === 'app_video_cut'), true, 'materialized legacy app should appear in the normal app list');
  assert.equal((await getApp('app_video_cut'))?.shareToken, 'share_builtin_video_cut_84f1b7fa9de446c59994a1d4a57f1316');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-legacy-video-cut-app-migration: ok');
