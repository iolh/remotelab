import { spawnSync } from 'child_process';

const DEFAULT_CLOUDFLARE_WORKER_BASE_URL = '';
const CURL_HTTP_STATUS_MARKER = '__REMOTELAB_CURL_STATUS__';
const FETCH_PROXY_RETRY_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkerBaseUrl(value) {
  const trimmed = trimString(value);
  if (!trimmed) return DEFAULT_CLOUDFLARE_WORKER_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}

function resolveSecret(config, directKey, envKey) {
  const directValue = trimString(config?.[directKey]);
  if (directValue) return directValue;
  const envName = trimString(config?.[envKey]);
  if (!envName) return '';
  return trimString(process.env[envName]);
}

function configuredAuthMode(config = {}) {
  const provider = firstNonEmpty(config.provider, 'cloudflare_worker').toLowerCase();
  if (provider === 'apple_mail') {
    return 'mail_app';
  }
  if (provider === 'cloudflare_worker') {
    return resolveSecret(config, 'workerToken', 'workerTokenEnv') ? 'bearer_token' : 'unconfigured';
  }
  return 'unconfigured';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => trimString(entry)).filter(Boolean);
  }
  const single = trimString(value);
  return single ? [single] : [];
}

function parseJsonMaybe(text) {
  if (!trimString(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseMessage(body, fallbackText) {
  if (!body || typeof body !== 'object') return trimString(fallbackText);
  return firstNonEmpty(body.message, body.error, body.detail, fallbackText);
}

function summarizedResponse(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    id: firstNonEmpty(body.id, body.messageId, body.message_id),
    message: firstNonEmpty(body.message, body.status),
  };
}

function configuredProxyUrl(env = process.env) {
  return firstNonEmpty(
    env.https_proxy,
    env.HTTPS_PROXY,
    env.http_proxy,
    env.HTTP_PROXY,
    env.all_proxy,
    env.ALL_PROXY,
  );
}

function parseNoProxyMatchers(env = process.env) {
  return firstNonEmpty(env.no_proxy, env.NO_PROXY)
    .split(',')
    .map((entry) => trimString(entry).toLowerCase())
    .filter(Boolean);
}

function hostMatchesNoProxy(hostname, matchers = []) {
  const normalizedHost = trimString(hostname).toLowerCase();
  if (!normalizedHost) return false;
  for (const matcher of matchers) {
    if (matcher === '*') return true;
    const matcherWithoutPort = matcher.replace(/:\d+$/, '');
    if (!matcherWithoutPort) continue;
    if (matcherWithoutPort.startsWith('.')) {
      const suffix = matcherWithoutPort.slice(1);
      if (normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)) {
        return true;
      }
      continue;
    }
    if (normalizedHost === matcherWithoutPort || normalizedHost.endsWith(`.${matcherWithoutPort}`)) {
      return true;
    }
  }
  return false;
}

function requestShouldBypassProxy(urlValue, env = process.env) {
  try {
    const url = new URL(urlValue);
    const hostname = trimString(url.hostname).toLowerCase();
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }
    return hostMatchesNoProxy(hostname, parseNoProxyMatchers(env));
  } catch {
    return false;
  }
}

function shouldPreferCurlTransport(urlValue, options = {}) {
  if (options.forceFetchTransport) return false;
  if (options.forceCurlTransport) return true;
  if (!configuredProxyUrl()) return false;
  return !requestShouldBypassProxy(urlValue);
}

function shouldRetryViaCurl(error, urlValue, options = {}) {
  if (!shouldPreferCurlTransport(urlValue, options)) return false;
  const code = firstNonEmpty(error?.cause?.code, error?.code);
  if (code && FETCH_PROXY_RETRY_ERROR_CODES.has(code)) {
    return true;
  }
  return trimString(error?.message).toLowerCase() === 'fetch failed';
}

function buildCloudflareWorkerRequest(urlValue, prepared) {
  return {
    url: urlValue,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${prepared.workerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: prepared.to,
      from: prepared.from,
      subject: prepared.subject,
      text: prepared.text,
      inReplyTo: prepared.inReplyTo,
      references: prepared.references,
    }),
  };
}

function parseCurlResponse(stdout = '') {
  const marker = `\n${CURL_HTTP_STATUS_MARKER}:`;
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error('curl response did not include an HTTP status code');
  }
  const rawText = stdout.slice(0, markerIndex);
  const statusText = stdout.slice(markerIndex + marker.length).trim();
  const statusCode = Number.parseInt(statusText, 10);
  if (!Number.isInteger(statusCode)) {
    throw new Error('curl response reported an invalid HTTP status code');
  }
  return {
    rawText,
    statusCode,
    parsedBody: parseJsonMaybe(rawText),
  };
}

function finalizeCloudflareWorkerResponse(prepared, statusCode, rawText) {
  const parsedBody = parseJsonMaybe(rawText);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Outbound email failed (${statusCode}): ${responseMessage(parsedBody, rawText) || 'Unknown error'}`);
  }

  return {
    provider: prepared.provider,
    authMode: 'bearer_token',
    statusCode,
    response: parsedBody || rawText,
    summary: summarizedResponse(parsedBody),
  };
}

function sendCloudflareWorkerMessageViaCurl(request, prepared, options = {}) {
  if (typeof options.sendCloudflareWorkerViaCurlImpl === 'function') {
    return options.sendCloudflareWorkerViaCurlImpl(request, prepared);
  }

  const result = spawnSync('curl', [
    '--silent',
    '--show-error',
    '--location',
    '--connect-timeout',
    '15',
    '--max-time',
    '30',
    '--request',
    'POST',
    request.url,
    '--header',
    `Accept: ${request.headers.Accept}`,
    '--header',
    `Authorization: ${request.headers.Authorization}`,
    '--header',
    `Content-Type: ${request.headers['Content-Type']}`,
    '--data-binary',
    '@-',
    '--write-out',
    `\n${CURL_HTTP_STATUS_MARKER}:%{http_code}`,
  ], {
    input: request.body,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  if (result.status !== 0) {
    throw new Error(trimString(stderr) || `curl transport failed (${result.status})`);
  }

  const parsed = parseCurlResponse(stdout);
  return finalizeCloudflareWorkerResponse(prepared, parsed.statusCode, parsed.rawText);
}

export function summarizeOutboundConfig(config = {}) {
  const provider = firstNonEmpty(config.provider, 'cloudflare_worker');
  const authMode = configuredAuthMode(config);
  return {
    provider,
    workerBaseUrl: normalizeWorkerBaseUrl(config.workerBaseUrl),
    account: trimString(config.account),
    from: trimString(config.from),
    workerTokenEnv: trimString(config.workerTokenEnv),
    authMode,
    configured: authMode !== 'unconfigured',
  };
}

function prepareCloudflareWorkerConfig(config = {}, message = {}) {
  const to = normalizeRecipients(message.to);
  const subject = trimString(message.subject);
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const from = firstNonEmpty(message.from, config.from);
  const workerToken = resolveSecret(config, 'workerToken', 'workerTokenEnv');
  const workerBaseUrl = normalizeWorkerBaseUrl(config.workerBaseUrl);
  const inReplyTo = trimString(message.inReplyTo);
  const references = trimString(message.references);
  const allowEmptySubject = Boolean(inReplyTo || references);

  if (to.length === 0) {
    throw new Error('Outbound email requires at least one recipient');
  }
  if (!subject && !allowEmptySubject) {
    throw new Error('Outbound email requires a subject');
  }
  if (!text) {
    throw new Error('Outbound email requires a text body');
  }
  if (!from) {
    throw new Error('Outbound email requires a sender address');
  }
  if (!workerToken) {
    throw new Error('Cloudflare worker outbound email is not configured. Set a worker token first.');
  }
  if (!workerBaseUrl) {
    throw new Error('Cloudflare worker outbound email requires a worker base URL. Set workerBaseUrl first.');
  }

  return {
    provider: 'cloudflare_worker',
    workerBaseUrl,
    workerToken,
    from,
    to,
    subject,
    text,
    inReplyTo,
    references,
  };
}

function prepareAppleMailConfig(config = {}, message = {}) {
  const to = normalizeRecipients(message.to);
  const subject = trimString(message.subject);
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const allowEmptySubject = Boolean(trimString(message.inReplyTo) || trimString(message.references));

  if (to.length === 0) {
    throw new Error('Outbound email requires at least one recipient');
  }
  if (!subject && !allowEmptySubject) {
    throw new Error('Outbound email requires a subject');
  }
  if (!text) {
    throw new Error('Outbound email requires a text body');
  }

  return {
    provider: 'apple_mail',
    account: trimString(config.account),
    from: '',
    to,
    subject,
    text,
  };
}

function sendAppleMailMessage(prepared, options = {}) {
  if (typeof options.sendAppleMailMessageImpl === 'function') {
    return options.sendAppleMailMessageImpl(prepared);
  }

  const script = [
    'set recipientText to system attribute "REMOTELAB_MAIL_TO"',
    'set subjectText to system attribute "REMOTELAB_MAIL_SUBJECT"',
    'set bodyText to system attribute "REMOTELAB_MAIL_TEXT"',
    'set desiredAccount to system attribute "REMOTELAB_MAIL_ACCOUNT"',
    'set desiredSender to system attribute "REMOTELAB_MAIL_SENDER"',
    'set recipientList to paragraphs of recipientText',
    'tell application "Mail"',
    '  set availableAccounts to every account',
    '  if (count of availableAccounts) is 0 then error "No Mail accounts are configured"',
    '  set selectedAccount to item 1 of availableAccounts',
    '  if desiredAccount is not "" then',
    '    set accountFound to false',
    '    repeat with currentAccount in availableAccounts',
    '      if ((name of currentAccount as text) is desiredAccount) or ((user name of currentAccount as text) is desiredAccount) then',
    '        set selectedAccount to currentAccount',
    '        set accountFound to true',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if accountFound is false then error "Mail account not found: " & desiredAccount',
    '  end if',
    '  set resolvedSender to desiredSender',
    '  if resolvedSender is "" then',
    '    try',
    '      set accountAddresses to email addresses of selectedAccount',
    '      if (count of accountAddresses) > 0 then set resolvedSender to item 1 of accountAddresses',
    '    end try',
    '  end if',
    '  if resolvedSender is "" then set resolvedSender to user name of selectedAccount',
    '  set outgoingMessage to make new outgoing message with properties {subject:subjectText, content:bodyText & return & return, visible:false}',
    '  tell outgoingMessage',
    '    repeat with recipientAddress in recipientList',
    '      if (recipientAddress as text) is not "" then',
    '        make new to recipient at end of to recipients with properties {address:recipientAddress as text}',
    '      end if',
    '    end repeat',
    '    if resolvedSender is not "" then set sender to resolvedSender',
    '    send',
    '  end tell',
    '  return resolvedSender',
    'end tell',
  ].join('\n');

  const result = spawnSync('osascript', ['-'], {
    input: script,
    encoding: 'utf8',
    env: {
      ...process.env,
      REMOTELAB_MAIL_TO: prepared.to.join('\n'),
      REMOTELAB_MAIL_SUBJECT: prepared.subject,
      REMOTELAB_MAIL_TEXT: prepared.text,
      REMOTELAB_MAIL_ACCOUNT: prepared.account,
      REMOTELAB_MAIL_SENDER: prepared.from,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(trimString(result.stderr) || trimString(result.stdout) || `Mail.app send failed (${result.status})`);
  }

  return {
    sender: trimString(result.stdout),
  };
}

export async function sendOutboundEmail(message, config = {}, options = {}) {
  const provider = firstNonEmpty(config.provider, 'cloudflare_worker').toLowerCase();
  if (provider === 'apple_mail') {
    const prepared = prepareAppleMailConfig(config, message);
    const response = await sendAppleMailMessage(prepared, options);
    return {
      provider: 'apple_mail',
      statusCode: 202,
      response: {
        message: 'queued in Mail.app',
        sender: trimString(response?.sender),
      },
      summary: {
        message: trimString(response?.sender)
          ? `queued in Mail.app via ${trimString(response.sender)}`
          : 'queued in Mail.app',
      },
    };
  }

  if (provider === 'cloudflare_worker') {
    const prepared = prepareCloudflareWorkerConfig(config, message);
    const requestUrl = `${prepared.workerBaseUrl}/api/send-email`;
    const request = buildCloudflareWorkerRequest(requestUrl, prepared);
    if (shouldPreferCurlTransport(requestUrl, options)) {
      return sendCloudflareWorkerMessageViaCurl(request, prepared, options);
    }

    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Global fetch is unavailable in this Node runtime');
    }

    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });
    } catch (error) {
      if (!shouldRetryViaCurl(error, requestUrl, options)) {
        throw error;
      }
      return sendCloudflareWorkerMessageViaCurl(request, prepared, options);
    }

    const rawText = await response.text();
    return finalizeCloudflareWorkerResponse(prepared, response.status, rawText);
  }

  throw new Error(`Unsupported outbound email provider: ${provider}`);
}
