#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address()?.port || 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 15000, intervalMs = 100) {
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
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-managed-passthrough-'));
  const configDir = join(home, '.config', 'remotelab');
  const localBin = join(home, '.local', 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({ 'test-session': { expiry: Date.now() + 3600000, role: 'owner' } }),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'tools.json'),
    JSON.stringify([
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
    ]),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'done' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 30);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  return { home, configDir };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, CHAT_PORT: String(port), SECURE_COOKIES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  await waitFor(async () => {
    try {
      return (await request(port, 'GET', '/api/auth/me')).status === 200;
    } catch {
      return false;
    }
  }, 'server startup');
  return { child, getStderr: () => stderr };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function createSession(port, name) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name,
  });
  assert.equal(res.status, 201);
  return res.json.session;
}

async function patchSession(port, sessionId, patch) {
  const res = await request(port, 'PATCH', `/api/sessions/${sessionId}`, patch);
  assert.equal(res.status, 200);
  return res.json.session;
}

async function submitMessage(port, sessionId, requestId, text) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId,
    text,
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });
  assert.ok(res.status === 200 || res.status === 202);
  return res;
}

async function waitForRunTerminal(port, runId) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return null;
    const state = res.json?.run?.state || '';
    return ['completed', 'failed', 'cancelled'].includes(state) ? res.json.run : null;
  }, `run ${runId} terminal`);
}

async function getEvents(port, sessionId) {
  const res = await request(port, 'GET', `/api/sessions/${sessionId}/events?filter=all`);
  assert.equal(res.status, 200);
  return res.json?.events || [];
}

function readRunManifest(configDir, runId) {
  const manifestPath = join(configDir, 'chat-runs', runId, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

async function main() {
  const { home, configDir } = setupTempHome();
  const port = await getAvailablePort();
  const server = await startServer({ home, port });

  try {
    const session = await createSession(port, 'Managed prompt');

    const managedRes = await submitMessage(port, session.id, 'req-managed', 'hello managed');
    const managedRun = await waitForRunTerminal(port, managedRes.json?.run?.id);
    assert.ok(managedRun, 'managed run should complete');

    const managedManifest = readRunManifest(configDir, managedRun.id);
    assert.ok(
      managedManifest.prompt.includes('RemoteLab'),
      'managed prompt should contain RemoteLab system context',
    );
    assert.ok(
      managedManifest.prompt.includes('Turn activation'),
      'managed prompt should contain turn activation card',
    );
    assert.ok(
      managedManifest.prompt.includes('hello managed'),
      'managed prompt should still contain the user text',
    );

    const managedEvents = await getEvents(port, session.id);
    const managedManagerCtx = managedEvents.filter((event) => event.type === 'manager_context');
    assert.ok(managedManagerCtx.length > 0, 'managed mode should record manager_context events');

    const ignoredPatch = await patchSession(port, session.id, { workflowAutoTriggerDisabled: true });
    assert.equal(
      Object.prototype.hasOwnProperty.call(ignoredPatch, 'workflowAutoTriggerDisabled'),
      false,
      'workflowAutoTriggerDisabled should no longer persist on session detail',
    );

    const stillManagedRes = await submitMessage(port, session.id, 'req-still-managed', 'hello still managed');
    const stillManagedRun = await waitForRunTerminal(port, stillManagedRes.json?.run?.id);
    assert.ok(stillManagedRun, 'follow-up run should complete');

    const stillManagedManifest = readRunManifest(configDir, stillManagedRun.id);
    assert.ok(
      stillManagedManifest.prompt.includes('Turn activation'),
      'ignored workflowAutoTriggerDisabled patches must not disable managed prompt wrapping',
    );
    assert.ok(
      stillManagedManifest.prompt.includes('hello still managed'),
      'managed prompt should still include the user text after ignored patches',
    );

    const stillManagedEvents = await getEvents(port, session.id);
    const stillManagedManagerCtx = stillManagedEvents.filter(
      (event) => event.type === 'manager_context' && event.requestId === 'req-still-managed',
    );
    assert.equal(
      stillManagedManagerCtx.length,
      1,
      'manager_context events should continue to be emitted after ignored opt-out patches',
    );

    const inlineText = '模式：标准交付\n修个 typo';
    const inlineRes = await submitMessage(port, session.id, 'req-inline', inlineText);
    const inlineRun = await waitForRunTerminal(port, inlineRes.json?.run?.id);
    assert.ok(inlineRun, 'inline declaration run should complete');

    const inlineManifest = readRunManifest(configDir, inlineRun.id);
    assert.ok(
      inlineManifest.prompt.includes(inlineText),
      'inline workflow declarations should now pass through as plain user text',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(inlineRes.json?.session || {}, 'workflowDefinition'),
      false,
      'inline declarations should not materialize legacy workflowDefinition metadata',
    );

    console.log('test-managed-mode-prompt-passthrough: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('test-managed-mode-prompt-passthrough: failed');
  console.error(error);
  process.exitCode = 1;
});
