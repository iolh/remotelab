#!/usr/bin/env node
import assert from 'assert/strict';
import { buildCodexArgs } from '../chat/adapters/codex.mjs';

const defaultArgs = buildCodexArgs('Verify the change');
assert.ok(
  defaultArgs.includes('--dangerously-bypass-approvals-and-sandbox'),
  'default codex args should keep the current bypass behavior',
);

const verificationArgs = buildCodexArgs('Verify the change', {
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  developerInstructions: 'verification only',
});

assert.ok(
  verificationArgs.includes('--sandbox'),
  'verification mode should pin an explicit sandbox policy',
);
assert.ok(
  verificationArgs.includes('read-only'),
  'verification mode should use the read-only sandbox',
);
assert.ok(
  verificationArgs.includes('--dangerously-bypass-approvals-and-sandbox'),
  'verification mode with approvalPolicy=never should use bypass flag',
);
assert.ok(
  !verificationArgs.includes('--ask-for-approval'),
  'verification mode should not use unsupported --ask-for-approval flag',
);

const deliberationArgs = buildCodexArgs('Evaluate the approach', {
  approvalPolicy: 'never',
  developerInstructions: 'deliberation only',
});
assert.ok(
  deliberationArgs.includes('--dangerously-bypass-approvals-and-sandbox'),
  'deliberation mode (no sandbox) should use bypass flag',
);
assert.ok(
  !deliberationArgs.includes('--ask-for-approval'),
  'deliberation mode should not use unsupported --ask-for-approval flag',
);
assert.ok(
  !deliberationArgs.includes('--sandbox'),
  'deliberation mode without sandboxMode should not include --sandbox',
);

console.log('test-codex-verification-readonly: ok');
