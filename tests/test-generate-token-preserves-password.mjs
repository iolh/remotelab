#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const home = mkdtempSync(join(tmpdir(), 'remotelab-generate-token-'));

try {
  const configDir = join(home, '.config', 'remotelab');
  mkdirSync(configDir, { recursive: true });
  const authPath = join(configDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    username: 'ninglo',
    passwordHash: 'scrypt$16384$8$1$0123456789abcdef0123456789abcdef$abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  }, null, 2));

  const result = spawnSync(process.execPath, ['generate-token.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `generate-token should succeed: ${result.stderr}`);

  const updated = JSON.parse(readFileSync(authPath, 'utf8'));
  assert.equal(updated.username, 'ninglo', 'generate-token should preserve username');
  assert.equal(
    updated.passwordHash,
    'scrypt$16384$8$1$0123456789abcdef0123456789abcdef$abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    'generate-token should preserve password hash',
  );
  assert.match(updated.token, /^[0-9a-f]{64}$/, 'generate-token should write a new 256-bit hex token');
  assert.notEqual(
    updated.token,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'generate-token should replace the previous token',
  );

  console.log('test-generate-token-preserves-password: ok');
} finally {
  rmSync(home, { recursive: true, force: true });
}
