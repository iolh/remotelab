#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-reply-self-check-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'remotelab');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const prompt = process.argv[process.argv.length - 1] || '';
const isWorkflowPrompt = prompt.includes('You are updating RemoteLab workflow state for a developer session');
const isReplyReviewPrompt = prompt.includes("You are RemoteLab's hidden end-of-turn completion reviewer.");
const isRepairPrompt = prompt.includes('You are continuing the same user-facing reply after a hidden self-check found an avoidable early stop.');

let threadId = 'main-thread';
let items = [{ type: 'agent_message', text: '我已经分析了机制问题。下一条我可以直接给你那份极短执行守则。' }];

if (isWorkflowPrompt) {
  threadId = 'workflow-thread';
  items = [{
    type: 'agent_message',
    text: JSON.stringify({ workflowState: 'done', workflowPriority: 'low', reason: 'done' }),
  }];
} else if (isReplyReviewPrompt) {
  threadId = 'review-thread';
  const isChecklistScenario = prompt.includes('todo checklist');
  const hasVisibleAnswer = prompt.includes('真正有效答复：把缺的结论直接补齐。');
  const hasDisplayedChecklist = prompt.includes('[ ] todo checklist');
  items = [{
    type: 'agent_message',
    text: '<hide>' + JSON.stringify(isChecklistScenario
      ? {
        action: hasVisibleAnswer && hasDisplayedChecklist ? 'continue' : 'accept',
        reason: hasVisibleAnswer && hasDisplayedChecklist
          ? '最后展示给用户的 turn 里既有真正答复也有 checklist，需要按整个展示 turn 判断。'
          : 'review prompt missed part of the visible turn',
        continuationPrompt: hasVisibleAnswer && hasDisplayedChecklist
          ? '直接补上最后缺的结论，不要重复前面的真正有效答复，也不要重复 checklist。'
          : '',
      }
      : {
        action: 'continue',
        reason: '上一条回复把本轮该直接交付的内容留到了后面。',
        continuationPrompt: '直接给出那份极短执行守则，不要再征求许可，也不要重复前面的机制分析。',
      }) + '</hide>',
  }];
} else if (isRepairPrompt) {
  threadId = 'repair-thread';
  const isChecklistScenario = prompt.includes('todo checklist');
  const hasVisibleAnswer = prompt.includes('真正有效答复：把缺的结论直接补齐。');
  const hasDisplayedChecklist = prompt.includes('[ ] todo checklist');
  items = [{
    type: 'agent_message',
    text: isChecklistScenario
      ? (hasVisibleAnswer && hasDisplayedChecklist
        ? '补上的最终结论。'
        : 'repair prompt missed part of the visible turn')
      : '极短执行守则：默认先做完再汇报；除非高风险、真歧义、缺关键信息，否则不要停；不要用“如果你愿意我下一条再做”作为结尾。',
  }];
} else if (prompt.includes('先给真正答复，再在最后发一份 todo checklist，然后停住。')) {
  items = [
    { type: 'agent_message', text: '真正有效答复：把缺的结论直接补齐。' },
    { type: 'todo_list', items: [{ completed: false, text: 'todo checklist' }] },
  ];
}

console.log(JSON.stringify({ type: 'thread.started', thread_id: threadId }));
console.log(JSON.stringify({ type: 'turn.started' }));
for (const item of items) {
  console.log(JSON.stringify({
    type: 'item.completed',
    item,
  }));
}
console.log(JSON.stringify({
  type: 'turn.completed',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
setTimeout(() => process.exit(0), 20);
`,
  'utf8',
);
chmodSync(fakeCodexPath, 0o755);

writeFileSync(
  join(configDir, 'tools.json'),
  JSON.stringify(
    [
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model' }],
        reasoning: {
          kind: 'enum',
          label: 'Reasoning',
          levels: ['low'],
          default: 'low',
        },
      },
    ],
    null,
    2,
  ),
  'utf8',
);

process.env.HOME = tempHome;
process.env.PATH = `${tempBin}:${process.env.PATH}`;

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'chat', 'session-manager.mjs')).href
);

const {
  createSession,
  getHistory,
  getSession,
  killAll,
  sendMessage,
} = sessionManager;

async function waitFor(predicate, description, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  const session = await createSession(tempHome, 'fake-codex', 'Reply Self Check', {
    group: 'RemoteLab',
    description: 'Verify end-of-turn self-check can auto-continue an avoidably unfinished reply.',
  });

  await sendMessage(session.id, '先分析问题，再把极短执行守则真的给出来。', [], {
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });

  await waitFor(
    async () => {
      const history = await getHistory(session.id);
      return history.some((event) => event.type === 'message' && event.role === 'assistant' && (event.content || '').includes('极短执行守则：'));
    },
    'self-check should trigger an automatic follow-up reply',
  );

  await waitFor(
    async () => (await getSession(session.id))?.activity?.run?.state === 'idle',
    'session should become idle after the automatic follow-up reply',
  );

  const history = await getHistory(session.id);
  const statusTexts = history
    .filter((event) => event.type === 'status')
    .map((event) => event.content || '');
  const assistantTexts = history
    .filter((event) => event.type === 'message' && event.role === 'assistant')
    .map((event) => event.content || '');

  assert.ok(
    statusTexts.includes('Assistant self-check: reviewing the latest reply for early stop…'),
    'history should show that the self-check reviewer ran',
  );
  assert.ok(
    statusTexts.some((text) => text.startsWith('Assistant self-check: continuing automatically — ')),
    'history should show that the self-check requested an automatic continuation',
  );
  assert.ok(
    assistantTexts.some((text) => text.includes('下一条我可以直接给你那份极短执行守则')),
    'history should keep the original avoidably unfinished reply',
  );
  assert.ok(
    assistantTexts.some((text) => text.includes('极短执行守则：默认先做完再汇报')),
    'history should include the automatically continued reply',
  );

  const checklistSession = await createSession(tempHome, 'fake-codex', 'Reply Self Check Visible Turn', {
    group: 'RemoteLab',
    description: 'Verify self-check reuses the visible turn display when a checklist is the final assistant item.',
  });

  await sendMessage(checklistSession.id, '先给真正答复，再在最后发一份 todo checklist，然后停住。', [], {
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });

  await waitFor(
    async () => {
      const visibleTurnHistory = await getHistory(checklistSession.id);
      return visibleTurnHistory.some((event) => event.type === 'message' && event.role === 'assistant' && (event.content || '').includes('补上的最终结论。'));
    },
    'self-check should inspect the whole displayed assistant turn instead of only the last checklist item',
  );

  await waitFor(
    async () => (await getSession(checklistSession.id))?.activity?.run?.state === 'idle',
    'checklist session should become idle after the automatic follow-up reply',
  );

  const checklistHistory = await getHistory(checklistSession.id);
  const checklistAssistantTexts = checklistHistory
    .filter((event) => event.type === 'message' && event.role === 'assistant')
    .map((event) => event.content || '');

  assert.ok(
    checklistAssistantTexts.some((text) => text.includes('真正有效答复：把缺的结论直接补齐。')),
    'history should keep the visible substantive assistant reply that appeared before the checklist',
  );
  assert.ok(
    checklistAssistantTexts.some((text) => text.includes('[ ] todo checklist')),
    'history should keep the trailing checklist that ended the original assistant turn',
  );
  assert.ok(
    checklistAssistantTexts.some((text) => text.includes('补上的最终结论。')),
    'repair continuation should still see the whole displayed assistant turn context',
  );
  assert.equal(
    checklistAssistantTexts.some((text) => text.includes('repair prompt missed part of the visible turn')),
    false,
    'repair prompt should not fall back to a missing-context placeholder',
  );
} finally {
  killAll();
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-reply-self-check: ok');
