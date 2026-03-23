#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const shareSource = readFileSync(join(repoRoot, 'static', 'share.js'), 'utf8');

function createClassList(node) {
  function getTokens() {
    return String(node.className || '')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function setTokens(tokens) {
    node.className = [...new Set(tokens)].join(' ');
  }

  return {
    add(...tokens) {
      setTokens([...getTokens(), ...tokens]);
    },
    remove(...tokens) {
      const deny = new Set(tokens);
      setTokens(getTokens().filter((token) => !deny.has(token)));
    },
    toggle(token) {
      const tokens = getTokens();
      if (tokens.includes(token)) {
        setTokens(tokens.filter((value) => value !== token));
        return false;
      }
      tokens.push(token);
      setTokens(tokens);
      return true;
    },
    contains(token) {
      return getTokens().includes(token);
    },
  };
}

function createElement(tagName = 'div') {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    dataset: {},
    style: {},
    attributes: {},
    children: [],
    parentNode: null,
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    addEventListener(type, handler) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(handler);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    querySelectorAll(selector) {
      const results = [];
      if (!selector.startsWith('.')) return results;
      const className = selector.slice(1);
      const stack = [...this.children];
      while (stack.length > 0) {
        const node = stack.shift();
        if (String(node.className || '').split(/\s+/).includes(className)) {
          results.push(node);
        }
        stack.unshift(...(node.children || []));
      }
      return results;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
  };
  element.classList = createClassList(element);
  Object.defineProperty(element, 'childNodes', {
    get() {
      return this.children;
    },
  });
  let innerHTML = '';
  let textContent = '';
  Object.defineProperty(element, 'textContent', {
    get() {
      return textContent;
    },
    set(value) {
      textContent = String(value);
      innerHTML = '';
    },
  });
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return innerHTML || escapeHtml(textContent);
    },
    set(value) {
      innerHTML = String(value);
      textContent = '';
      if (innerHTML === '') {
        this.children = [];
      }
    },
  });
  return element;
}

const nodes = {
  messagesInner: createElement('div'),
  snapshotTitle: createElement('h1'),
  snapshotMeta: createElement('div'),
  heroBadge: createElement('div'),
  heroNote: createElement('div'),
};

const context = {
  console,
  navigator: {},
  marked: {
    use() {},
    parse(markdown) {
      return `<p>${markdown}</p>`;
    },
  },
  window: {
    __REMOTELAB_SHARE__: {
      id: 'snap_test',
      createdAt: '2026-03-23T10:00:00.000Z',
      session: {
        name: 'Snapshot rendering',
        tool: 'codex',
      },
      view: {},
      eventCount: 5,
      displayEvents: [
        {
          seq: 1,
          type: 'message',
          role: 'user',
          content: '请帮我检查分享快照。',
        },
        {
          seq: 2,
          type: 'thinking_block',
          blockStartSeq: 2,
          blockEndSeq: 4,
          label: 'Thought · used shell',
          toolNames: ['shell'],
          state: 'completed',
        },
        {
          seq: 5,
          type: 'message',
          role: 'assistant',
          content: '现在已经可以看到快照内容。',
        },
      ],
      eventBlocks: {
        '2-4': [
          {
            seq: 2,
            type: 'reasoning',
            role: 'assistant',
            content: '先检查分享 payload。',
          },
          {
            seq: 3,
            type: 'tool_use',
            role: 'assistant',
            id: 'tool_1',
            toolName: 'shell',
            toolInput: 'rg -n "share" static chat',
          },
          {
            seq: 4,
            type: 'tool_result',
            role: 'system',
            toolName: 'shell',
            output: 'static/share.js',
            exitCode: 0,
          },
        ],
      },
    },
    RemoteLabIcons: {
      render() {
        return '';
      },
    },
    isSecureContext: true,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    open() {},
  },
  document: {
    body: createElement('body'),
    getElementById(id) {
      return nodes[id] || null;
    },
    createElement(tagName) {
      return createElement(tagName);
    },
  },
};
context.globalThis = context;
context.self = context.window;

vm.runInNewContext(shareSource, context, { filename: 'static/share.js' });

assert.equal(nodes.snapshotTitle.textContent, 'Snapshot rendering', 'share title should come from snapshot metadata');
assert.match(nodes.snapshotMeta.innerHTML, /事件数/, 'share meta should render the event count');
assert.equal(nodes.messagesInner.children.length, 3, 'displayEvents should render the transcript instead of the empty state');
assert.equal(nodes.messagesInner.innerHTML, '', 'rendered snapshot should clear the empty-state markup');

const thinkingBlock = nodes.messagesInner.children[1];
assert.ok(thinkingBlock.classList.contains('thinking-block'), 'thinking blocks should render from display events');
assert.ok(thinkingBlock.classList.contains('collapsed'), 'thinking block should start collapsed');

const thinkingHeader = thinkingBlock.children[0];
assert.equal(typeof thinkingHeader.listeners.click?.[0], 'function', 'thinking block header should be expandable');
thinkingHeader.listeners.click[0]();

assert.equal(thinkingBlock.classList.contains('collapsed'), false, 'clicking the thinking header should expand the block');
const thinkingBody = thinkingBlock.children[1];
assert.equal(thinkingBody.children.length, 2, 'expanding the block should render nested reasoning and tool content');
assert.ok(thinkingBody.querySelector('.tool-card'), 'tool activity inside the thought block should remain visible');

console.log('test-share-snapshot-rendering: ok');
