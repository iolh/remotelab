#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const ownerCookie = 'session_token=test-owner-session';

function randomPort() {
  return 36000 + Math.floor(Math.random() * 5000);
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

function request(port, method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function resolveEventContent(port, sessionId, event, extraHeaders = {}) {
  if (typeof event?.content === 'string' && event.content) return event.content;
  if (!event?.bodyAvailable || !Number.isInteger(event?.seq)) return '';
  const bodyResponse = await request(port, 'GET', `/api/sessions/${sessionId}/events/${event.seq}/body`, null, extraHeaders);
  assert.equal(bodyResponse.status, 200, 'event body should load when advertised');
  return bodyResponse.json?.body?.value || '';
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-owner-app-bootstrap-'));
  const configDir = join(home, '.config', 'remotelab');
  const localBin = join(home, '.local', 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({
      'test-owner-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' },
    }, null, 2),
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
    ], null, 2),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex'),
    `#!/usr/bin/env node
setTimeout(() => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'boot ok' }
  }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
}, 50);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);
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

  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  await waitFor(async () => {
    try {
      const res = await request(port, 'GET', '/api/auth/me', null, { Cookie: ownerCookie });
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

try {
  const { home } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, port });
  try {
    const appCreate = await request(port, 'POST', '/api/apps', {
      name: 'Video Cut Demo',
      systemPrompt: 'Ask for a video and produce a review-first cut plan.',
      welcomeMessage: 'Upload your video and describe what to keep or cut.',
      tool: 'fake-codex',
      model: 'fake-model',
      effort: 'low',
      skills: [],
    }, {
      Cookie: ownerCookie,
    });
    assert.equal(appCreate.status, 201, 'owner should be able to create a custom app');
    assert.ok(appCreate.json?.app?.id, 'created app should include an id');

    const ownerSessionCreate = await request(port, 'POST', '/api/sessions', {
      folder: repoRoot,
      tool: 'fake-codex',
      name: 'Owner app bootstrapped session',
      appId: appCreate.json.app.id,
      sourceId: 'chat',
      sourceName: 'Chat',
    }, {
      Cookie: ownerCookie,
    });
    assert.equal(ownerSessionCreate.status, 201, 'owner should be able to create a custom-app session');
    assert.equal(ownerSessionCreate.json.session?.appId, appCreate.json.app.id, 'session should inherit the custom app id');
    assert.equal(ownerSessionCreate.json.session?.appName, 'Video Cut Demo', 'session should auto-fill the custom app name');
    assert.equal(ownerSessionCreate.json.session?.sourceId, 'chat', 'session should preserve the explicit chat source');
    assert.equal(ownerSessionCreate.json.session?.sourceName, 'Chat', 'session should preserve the explicit chat source name');
    assert.equal(ownerSessionCreate.json.session?.model, 'fake-model', 'session should inherit the app model');
    assert.equal(ownerSessionCreate.json.session?.effort, 'low', 'session should inherit the app effort');

    const ownerEvents = await request(port, 'GET', `/api/sessions/${ownerSessionCreate.json.session.id}/events`, null, {
      Cookie: ownerCookie,
    });
    assert.equal(ownerEvents.status, 200, 'owner session events should load');
    const welcomeEvent = (ownerEvents.json.events || []).find((event) => event.type === 'message' && event.role === 'assistant');
    assert.ok(welcomeEvent, 'new owner session should get the app welcome message');
    const welcomeContent = await resolveEventContent(
      port,
      ownerSessionCreate.json.session.id,
      welcomeEvent,
      { Cookie: ownerCookie },
    );
    assert.match(welcomeContent, /Upload your video/i);

    const publicVisit = await request(port, 'GET', `/app/${appCreate.json.app.shareToken}`);
    assert.equal(publicVisit.status, 302, 'public app visit should bootstrap a visitor session');
    assert.equal(publicVisit.headers.location, '/?visitor=1');

    const defaultOwnerList = await request(port, 'GET', '/api/sessions', null, {
      Cookie: ownerCookie,
    });
    assert.equal(defaultOwnerList.status, 200, 'default owner session list should load');
    assert.equal(
      (defaultOwnerList.json.sessions || []).some((session) => session.visitorId),
      false,
      'default owner session list should stay owner-only',
    );

    const allUsersList = await request(port, 'GET', '/api/sessions?includeVisitor=1', null, {
      Cookie: ownerCookie,
    });
    assert.equal(allUsersList.status, 200, 'owner should be able to request all users');
    const visitorSession = (allUsersList.json.sessions || []).find((session) => session.visitorId);
    assert.ok(visitorSession, 'all-users owner list should include visitor sessions');
    assert.equal(visitorSession.appId, appCreate.json.app.id, 'visitor session should stay inside the custom app scope');
    assert.equal(visitorSession.sourceId, 'chat', 'visitor session should expose the chat source');
    assert.equal(visitorSession.model, 'fake-model', 'visitor session should inherit the app model');
    assert.equal(visitorSession.effort, 'low', 'visitor session should inherit the app effort');

    console.log('test-http-owner-app-bootstrap-and-visitor-listing: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
