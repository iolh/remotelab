import {
  buildSessionUrl,
  createRemoteLabHttpClient,
  DEFAULT_CHAT_BASE_URL,
  DEFAULT_RUN_POLL_TIMEOUT_MS,
  loadAssistantReply,
  normalizeBaseUrl,
  parsePositiveInteger,
  trimString,
} from './remotelab-http-client.mjs';

function printHelp(stdout = process.stdout) {
  stdout.write(`Usage:\n  remotelab session-spawn --task "<focused task>" [options]\n\nOptions:\n  --task <text>             Required delegated task / handoff goal\n  --source-session <id>     Source session id (default: $REMOTELAB_SESSION_ID)\n  --name <text>             Optional initial session name\n  --wait                    Wait for the spawned run and return its reply\n  --json                    Print machine-readable JSON\n  --base-url <url>          RemoteLab base URL (default: $REMOTELAB_CHAT_BASE_URL or local 7690)\n  --timeout-ms <ms>         Wait timeout for --wait (default: 600000)\n  --help                    Show this help\n`);
}

function parseArgs(argv = []) {
  const options = {
    task: '',
    sourceSessionId: trimString(process.env.REMOTELAB_SESSION_ID),
    name: '',
    wait: false,
    json: false,
    baseUrl: trimString(process.env.REMOTELAB_CHAT_BASE_URL || DEFAULT_CHAT_BASE_URL),
    timeoutMs: DEFAULT_RUN_POLL_TIMEOUT_MS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--task':
        options.task = argv[index + 1] || '';
        index += 1;
        break;
      case '--source-session':
        options.sourceSessionId = argv[index + 1] || '';
        index += 1;
        break;
      case '--name':
        options.name = argv[index + 1] || '';
        index += 1;
        break;
      case '--wait':
        options.wait = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--base-url':
        options.baseUrl = argv[index + 1] || '';
        index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInteger(argv[index + 1], DEFAULT_RUN_POLL_TIMEOUT_MS);
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.task = trimString(options.task);
  options.sourceSessionId = trimString(options.sourceSessionId);
  options.name = trimString(options.name);
  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  return options;
}

function writeResult(result, options = {}, stdout = process.stdout) {
  if (options.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [
    `sessionId: ${result.sessionId || ''}`,
    `runId: ${result.runId || ''}`,
    `sessionUrl: ${result.sessionUrl || ''}`,
  ];
  if (result.reply) {
    lines.push('', result.reply);
  }
  stdout.write(`${lines.join('\n')}\n`);
}

export async function runSessionSpawnCommand(argv = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(stdout);
    return 0;
  }
  if (!options.task) {
    throw new Error('--task is required');
  }
  if (!options.sourceSessionId) {
    throw new Error('No source session id provided. Pass --source-session or set REMOTELAB_SESSION_ID.');
  }

  const client = createRemoteLabHttpClient({ baseUrl: options.baseUrl });

  const result = await client.request(`/api/sessions/${encodeURIComponent(options.sourceSessionId)}/delegate`, {
    method: 'POST',
    body: {
      task: options.task,
      ...(options.name ? { name: options.name } : {}),
    },
  });
  if (!result.response.ok || !result.json?.session?.id || !result.json?.run?.id) {
    throw new Error(result.json?.error || result.text || `Failed to spawn session (${result.response.status})`);
  }

  const output = {
    sourceSessionId: options.sourceSessionId,
    task: options.task,
    sessionId: result.json.session.id,
    sessionName: trimString(result.json.session.name || ''),
    runId: result.json.run.id,
    sessionUrl: buildSessionUrl(result.json.session.id),
  };

  if (options.wait) {
    const run = await client.waitForRun(result.json.run.id, { timeoutMs: options.timeoutMs });
    output.state = run.state;
    output.reply = await loadAssistantReply(client, result.json.session.id, result.json.run.id);
    if (run.state !== 'completed') {
      writeResult(output, options, stdout);
      stderr.write(`Child session run finished in state ${run.state}.\n`);
      return 1;
    }
  }

  writeResult(output, options, stdout);
  return 0;
}
