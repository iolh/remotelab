#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function randomPort() {
  return 47000 + Math.floor(Math.random() * 5000);
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
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-attention-signals-'));
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
  return home;
}

async function startServer(home, port) {
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
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`server exited during startup (${child.exitCode || child.signalCode})`);
    }
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

async function main() {
  const home = setupTempHome();
  const port = randomPort();
  const child = await startServer(home, port);
  const signalsPath = join(home, '.config', 'remotelab', 'attention-signals.jsonl');

  try {
    const created = await request(port, 'POST', '/api/attention-signals', {
      signal: 'acted',
      sessionId: 'session-123',
      sessionName: '验收主线',
      attention: {
        state: 'needs_you_now',
        type: 'needs_decision',
        reason: 'workflow_conclusion_requires_decision',
      },
      details: {
        source: 'action_strip',
      },
    });
    assert.equal(created.status, 202, 'attention signal endpoint should accept valid payloads');
    assert.equal(existsSync(signalsPath), true, 'attention signal endpoint should create the append-only jsonl file');
    const lines = readFileSync(signalsPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'attention signal endpoint should append exactly one line per request');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.signal, 'acted');
    assert.equal(entry.sessionId, 'session-123');
    assert.equal(entry.attention.type, 'needs_decision');
    assert.equal(entry.details.source, 'action_strip');
    assert.ok(entry.recordedAt, 'attention signal endpoint should stamp a recordedAt timestamp');

    const invalid = await request(port, 'POST', '/api/attention-signals', {
      signal: 'unknown',
      sessionId: '',
    });
    assert.equal(invalid.status, 400, 'attention signal endpoint should reject invalid payloads');

    const resurfaced = await request(port, 'POST', '/api/attention-signals', {
      signal: 'completed_resurfaced_without_new_event',
      sessionId: 'session-123',
      sessionName: '验收主线',
      attention: {
        state: 'done',
        type: 'completed',
        reason: 'unread_completion',
      },
      details: {
        source: 'session_update',
      },
    });
    assert.equal(resurfaced.status, 202, 'completed resurfaced signal should be accepted');
  } finally {
    await stopServer(child);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
