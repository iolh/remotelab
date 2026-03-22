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
  verificationArgs.includes('--ask-for-approval'),
  'verification mode should pin an explicit approval policy',
);
assert.ok(
  verificationArgs.includes('never'),
  'verification mode should use the never approval policy',
);
assert.ok(
  !verificationArgs.includes('--dangerously-bypass-approvals-and-sandbox'),
  'verification mode should not bypass sandboxing or approvals',
);

console.log('test-codex-verification-readonly: ok');
