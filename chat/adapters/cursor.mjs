import {
  messageEvent,
  toolUseEvent,
  toolResultEvent,
  fileChangeEvent,
  statusEvent,
} from '../normalizer.mjs';

function normalizeToolName(rawName = '') {
  return String(rawName || '')
    .replace(/ToolCall$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function getToolCallEntry(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const [rawName, payload] = Object.entries(toolCall)[0] || [];
  if (!rawName || !payload || typeof payload !== 'object') return null;
  return {
    rawName,
    toolName: normalizeToolName(rawName),
    payload,
  };
}

function formatToolArgs(args) {
  if (typeof args === 'string') return args;
  return JSON.stringify(args || {}, null, 2);
}

function formatToolResult(result) {
  if (!result || typeof result !== 'object') return '';

  if (result.success && typeof result.success === 'object') {
    const success = result.success;
    if (typeof success.content === 'string' && success.content) {
      return success.content;
    }
    return JSON.stringify(success);
  }

  if (result.error && typeof result.error === 'object') {
    return result.error.message
      ? `Error: ${result.error.message}`
      : JSON.stringify(result.error);
  }

  return JSON.stringify(result);
}

function maybeBuildFileChange(toolName, payload) {
  const success = payload?.result?.success;
  const filePath = typeof success?.path === 'string' ? success.path : '';
  if (!filePath) return null;

  if (toolName === 'delete_file') {
    return fileChangeEvent(filePath, 'deleted');
  }
  if (toolName === 'write') {
    return fileChangeEvent(filePath, 'created');
  }
  if (toolName === 'edit') {
    return fileChangeEvent(filePath, 'modified');
  }
  return null;
}

export function createCursorAdapter() {
  return {
    parseLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return [];

      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return [];
      }

      const events = [];

      switch (obj.type) {
        case 'system':
          events.push(statusEvent(
            obj.subtype === 'init'
              ? `Session started (${obj.session_id || 'unknown'})`
              : `System: ${obj.subtype || 'unknown'}`,
          ));
          break;

        case 'assistant': {
          const content = obj.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                events.push(messageEvent('assistant', block.text));
              }
            }
          }
          break;
        }

        case 'tool_call': {
          const entry = getToolCallEntry(obj.tool_call);
          if (!entry) break;

          if (obj.subtype === 'started') {
            events.push(toolUseEvent(entry.toolName, formatToolArgs(entry.payload.args)));
          } else if (obj.subtype === 'completed') {
            const fileChange = maybeBuildFileChange(entry.toolName, entry.payload);
            if (fileChange) events.push(fileChange);
            events.push(toolResultEvent(
              entry.toolName,
              formatToolResult(entry.payload.result),
              entry.payload.result?.error ? 1 : 0,
            ));
          }
          break;
        }

        case 'result':
          if (obj.is_error === true || (typeof obj.subtype === 'string' && obj.subtype !== 'success')) {
            events.push(statusEvent(`error: ${obj.result || obj.subtype || 'unknown error'}`));
          } else {
            events.push(statusEvent('completed'));
          }
          break;

        default:
          break;
      }

      return events;
    },

    flush() {
      return [];
    },
  };
}

export function buildCursorArgs(prompt, options = {}) {
  const args = ['-p', '--output-format', 'stream-json', '--force', '--trust'];
  args.push('--model', options.model || 'auto');
  if (options.resume) {
    args.push('--resume', options.resume);
  }
  if (prompt) {
    args.push(prompt);
  }

  return args;
}
