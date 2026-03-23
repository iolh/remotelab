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
  const { parseCursorModelsOutput, getModelsForTool } = await import(
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

  const parsedWithAnsi = parseCursorModelsOutput(
    '\x1b[2K\x1b[Gclaude-4.6-opus-high - Opus 4.6 1M  (default)\n',
  );
  assert.equal(parsedWithAnsi.models[0]?.id, 'claude-4.6-opus-high');
  assert.equal(parsedWithAnsi.defaultModel, 'claude-4.6-opus-high');

  const merged = await getModelsForTool('cursor');
  assert.ok(
    merged.models.some((model) => model.id === 'claude-4.6-opus-high-thinking'),
    'cursor models should always include Opus 4.6 thinking',
  );
  assert.ok(
    merged.models.some((model) => model.id === 'claude-4.6-opus-high'),
    'cursor models should always include Opus 4.6',
  );
  assert.ok(
    merged.models.some((model) => model.id === 'claude-4.6-opus-max-thinking'),
    'cursor models should include Opus 4.6 Max Thinking in fallback merge',
  );
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-cursor-models: ok');
