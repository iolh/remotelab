#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const bootstrapSource = readFileSync(join(repoRoot, 'static', 'chat', 'bootstrap.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const applyBuildInfoSource = extractFunctionSource(bootstrapSource, 'applyBuildInfo');

async function main() {
  const state = {
    reloadCalls: 0,
    refreshUiCalls: 0,
  };
  const context = {
    console,
    buildRefreshScheduled: false,
    newerBuildInfo: null,
    buildAssetVersion: 'build-a',
    updateFrontendRefreshUi() {
      state.refreshUiCalls += 1;
    },
    async reloadForFreshBuild() {
      state.reloadCalls += 1;
      return true;
    },
  };
  context.globalThis = context;

  vm.runInNewContext(
    `${applyBuildInfoSource}\nglobalThis.applyBuildInfo = applyBuildInfo;`,
    context,
    { filename: 'static/chat/bootstrap.js' },
  );

  const nextBuildInfo = { assetVersion: 'build-b', title: 'Frontend ui:build-b' };
  const firstResult = await context.applyBuildInfo(nextBuildInfo);
  assert.equal(firstResult, false, 'new frontend builds should not auto reload the page');
  assert.equal(state.reloadCalls, 0, 'build-info updates should stay passive until the user reloads');
  assert.equal(state.refreshUiCalls, 1, 'new frontend builds should refresh the update indicator');
  assert.deepEqual(context.newerBuildInfo, nextBuildInfo, 'new frontend builds should be remembered for manual reload');

  state.refreshUiCalls = 0;
  const secondResult = await context.applyBuildInfo({ assetVersion: 'build-a' });
  assert.equal(secondResult, false, 'same-version build info should stay a no-op');
  assert.equal(state.reloadCalls, 0, 'same-version build info should not trigger reloads either');
  assert.equal(state.refreshUiCalls, 1, 'same-version build info should clear the indicator state');
  assert.equal(context.newerBuildInfo, null, 'same-version build info should clear stale update prompts');

  console.log('test-chat-build-update-indicator: ok');
}

main().catch((error) => {
  console.error('test-chat-build-update-indicator: failed');
  console.error(error);
  process.exitCode = 1;
});
