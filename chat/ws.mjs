import { WebSocketServer } from 'ws';
import { isAuthenticated, getAuthSession } from '../lib/auth.mjs';
import { setWss } from './ws-clients.mjs';
import { getPageBuildInfo } from './router.mjs';
import { openVoiceInputLiveTranscription } from './voice-input.mjs';

function canAccessSession(authSession, sessionId) {
  if (!authSession) return false;
  if (!sessionId) return authSession.role !== 'visitor';
  if (authSession.role !== 'visitor') return true;
  return authSession.sessionId === sessionId;
}

function sendJson(ws, payload) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {}
}

async function sendBuildInfo(ws) {
  try {
    const buildInfo = await getPageBuildInfo();
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'build_info', buildInfo }));
  } catch (error) {
    console.warn(`[build] failed to send websocket build info: ${error.message}`);
  }
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const voiceWss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  setWss(wss);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws' && url.pathname !== '/ws/voice-input') {
      socket.destroy();
      return;
    }

    if (!isAuthenticated(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (url.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws._authSession = getAuthSession(req);
        wss.emit('connection', ws, req);
      });
      return;
    }

    voiceWss.handleUpgrade(req, socket, head, (ws) => {
      ws._authSession = getAuthSession(req);
      ws._voiceSessionId = typeof url.searchParams.get('sessionId') === 'string'
        ? url.searchParams.get('sessionId').trim()
        : '';
      voiceWss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const role = ws._authSession?.role || 'owner';
    console.log(`[ws] Client connected (role=${role})`);
    void sendBuildInfo(ws);

    ws.on('message', () => {
      try {
        ws.close(1008, 'Push-only WebSocket');
      } catch {}
    });

    ws.on('close', () => {
      console.log(`[ws] Client disconnected (role=${role})`);
    });
  });

  voiceWss.on('connection', (ws) => {
    const role = ws._authSession?.role || 'owner';
    const requestedSessionId = typeof ws._voiceSessionId === 'string' ? ws._voiceSessionId.trim() : '';
    if (!canAccessSession(ws._authSession, requestedSessionId)) {
      try {
        ws.close(1008, 'Access denied');
      } catch {}
      return;
    }

    const state = {
      live: null,
      finalSent: false,
    };

    ws.on('message', async (message, isBinary) => {
      if (isBinary) {
        if (!state.live) {
          sendJson(ws, { type: 'error', error: 'Voice stream not started.' });
          return;
        }
        state.live.sendPcmChunk(message);
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(String(message || ''));
      } catch {
        sendJson(ws, { type: 'error', error: 'Invalid voice stream message.' });
        return;
      }

      if (payload?.type === 'start') {
        if (state.live) {
          sendJson(ws, { type: 'error', error: 'Voice stream already started.' });
          return;
        }
        const sessionId = typeof payload.sessionId === 'string' && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : requestedSessionId;
        if (!canAccessSession(ws._authSession, sessionId)) {
          sendJson(ws, { type: 'error', error: 'Access denied.' });
          try { ws.close(1008, 'Access denied'); } catch {}
          return;
        }
        try {
          state.live = await openVoiceInputLiveTranscription({
            language: typeof payload.language === 'string' ? payload.language.trim() : '',
            onPartial(result) {
              sendJson(ws, {
                type: 'partial',
                transcript: result.transcript,
                durationMs: result.durationMs,
                isFinal: result.isFinal === true,
              });
            },
          });
          await state.live.waitForReady();
          sendJson(ws, { type: 'started' });
        } catch (error) {
          sendJson(ws, { type: 'error', error: error?.message || 'Failed to start voice stream.' });
        }
        return;
      }

      if (payload?.type === 'stop') {
        if (!state.live) {
          sendJson(ws, { type: 'error', error: 'Voice stream not started.' });
          return;
        }
        try {
          const result = await state.live.finish();
          state.finalSent = true;
          sendJson(ws, {
            type: 'final',
            transcript: result.text,
            durationMs: result.durationMs,
            logId: result.logId,
          });
        } catch (error) {
          sendJson(ws, { type: 'error', error: error?.message || 'Voice stream failed.' });
        }
        return;
      }

      sendJson(ws, { type: 'error', error: 'Unsupported voice stream message.' });
    });

    ws.on('close', () => {
      if (state.live && !state.finalSent) {
        state.live.close();
      }
      console.log(`[ws] Voice client disconnected (role=${role})`);
    });
  });

  return wss;
}
