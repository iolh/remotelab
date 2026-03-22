#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-cursor-models-'));
process.env.HOME = tempHome;

try {
  const { parseCursorModelsOutput } = await import(
    pathToFileURL(join(repoRoot, 'chat', 'models.mjs')).href
  );

  const parsed = parseCursorModelsOutput(`
Loading models…

Available models

auto - Auto
claude-4.6-opus-high-thinking - Opus 4.6 1M Thinking  (current, default)
claude-4.6-opus-high - Opus 4.6 1M
claude-4.6-sonnet-medium - Sonnet 4.6 1M

Tip: use --model <id> to switch.
`);

  assert.deepEqual(
    parsed.models.map((model) => model.id),
    [
      'auto',
      'claude-4.6-opus-high-thinking',
      'claude-4.6-opus-high',
      'claude-4.6-sonnet-medium',
    ],
  );
  assert.equal(parsed.models[1]?.label, 'Opus 4.6 1M Thinking');
  assert.equal(parsed.defaultModel, 'claude-4.6-opus-high-thinking');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-cursor-models: ok');
