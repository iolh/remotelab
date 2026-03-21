#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function randomPort() {
  return 33000 + Math.floor(Math.random() * 10000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-session-patch-grouping-'));
  const configDir = join(home, '.config', 'remotelab');
  mkdirSync(configDir, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({
      'test-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' },
    }, null, 2),
    'utf8',
  );

  return { home };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitFor(async () => {
    try {
      const res = await request(port, 'GET', '/api/auth/me');
      return res.status === 200;
    } catch {
      return false;
    }
  }, 'server startup');

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitFor(() => child.exitCode !== null, 'server shutdown');
}

const { home } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, port });

try {
  const created = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name: 'Patch grouping session',
  });
  assert.equal(created.status, 201, 'session creation should succeed');
  const sessionId = created.json.session.id;

  const invalidGroup = await request(port, 'PATCH', `/api/sessions/${sessionId}`, {
    group: 123,
  });
  assert.equal(invalidGroup.status, 400, 'invalid group type should be rejected');

  const patched = await request(port, 'PATCH', `/api/sessions/${sessionId}`, {
    group: '  RemoteLab  ',
    description: '  Board-driven orchestration work.  ',
  });
  assert.equal(patched.status, 200, 'session patch should accept group and description');
  assert.equal(patched.json.session.group, 'RemoteLab', 'patch should trim and persist group');
  assert.equal(
    patched.json.session.description,
    'Board-driven orchestration work.',
    'patch should trim and persist description',
  );

  const detail = await request(port, 'GET', `/api/sessions/${sessionId}`);
  assert.equal(detail.status, 200, 'detail route should succeed after patch');
  assert.equal(detail.json.session.group, 'RemoteLab', 'detail route should expose patched group');
  assert.equal(
    detail.json.session.description,
    'Board-driven orchestration work.',
    'detail route should expose patched description',
  );

  const listed = await request(port, 'GET', '/api/sessions');
  assert.equal(listed.status, 200, 'session list should succeed');
  const listedSession = (listed.json.sessions || []).find((entry) => entry.id === sessionId);
  assert.ok(listedSession, 'session list should include the patched session');
  assert.equal(listedSession.group, 'RemoteLab', 'session list should expose patched group');
  assert.equal(
    listedSession.description,
    'Board-driven orchestration work.',
    'session list should expose patched description',
  );

  const cleared = await request(port, 'PATCH', `/api/sessions/${sessionId}`, {
    group: null,
    description: '',
  });
  assert.equal(cleared.status, 200, 'patch should accept clearing group and description');
  assert.equal(cleared.json.session.group, undefined, 'patch should clear group');
  assert.equal(cleared.json.session.description, undefined, 'patch should clear description');

  console.log('test-http-session-patch-grouping: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
