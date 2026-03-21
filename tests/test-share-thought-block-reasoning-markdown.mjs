#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const shareSource = readFileSync(join(repoRoot, 'static', 'share.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist in share.js`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function makeElement(tagName = 'div') {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    innerHTML: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

const renderReasoningSource = extractFunctionSource(shareSource, 'renderReasoning');
const container = makeElement('div');
const parseCalls = [];
const context = {
  console,
  document: {
    createElement(tagName) {
      return makeElement(tagName);
    },
  },
  getThinkingBody() {
    return container;
  },
  marked: {
    parse(markdown) {
      parseCalls.push(markdown);
      return `<p>${markdown}</p>`;
    },
  },
  sanitizeRenderedContent(node) {
    node.sanitized = true;
  },
  enhanceCodeBlocks(node) {
    node.enhanced = true;
  },
};
context.globalThis = context;

vm.runInNewContext(
  [
    renderReasoningSource,
    'globalThis.renderReasoning = renderReasoning;',
  ].join('\n\n'),
  context,
  { filename: 'static/share.js' },
);

context.renderReasoning({ content: '**Inspecting**\n\n- item one' });

assert.equal(parseCalls.length, 1, 'share thought reasoning should render through markdown');
assert.equal(container.children.length, 1, 'share thought reasoning should append one node');
assert.equal(container.children[0].className, 'reasoning msg-assistant', 'share thought reasoning should reuse markdown-capable assistant styles');
assert.equal(container.children[0].sanitized, true, 'share reasoning should sanitize rendered markdown');
assert.equal(container.children[0].enhanced, true, 'share reasoning should still enhance markdown code blocks');

console.log('test-share-thought-block-reasoning-markdown: ok');
