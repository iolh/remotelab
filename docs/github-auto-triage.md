# GitHub Auto Triage（Prompt-First 配置契约）

这份文档默认不是给人类逐条敲命令的，而是给你自己的 AI agent 一份 rollout 契约。人类主要做两件事：把 prompt 发给 agent；在最开始尽量一次性把需要的上下文交给它，然后只在明确的 `[HUMAN]` 节点完成登录、授权或发布确认。

## 复制给 AI 的 prompt

```text
我想在这台机器上配置 RemoteLab 的 GitHub Auto Triage，用来自动接住仓库里的 issue / PR / 跟进评论更新。

请把 `docs/github-auto-triage.md` 当作 rollout 契约。
后续流程都留在这个对话里。
开始执行前，请先用一条消息把缺少的上下文一次性问全，让我集中回复一次。
能自动完成的步骤请直接做。
我回复后，请持续自主执行；只在真的遇到 `[HUMAN]` 步骤、授权确认或最终完成时停下来。
停下来时，请明确告诉我具体要做什么，以及你做完后会怎么验证。
```

## 一次性交接输入

AI 应该尽量在最开始一轮把这些信息问全：

- 要监听的仓库
- 维护者账号列表
- 是否只做 `dry-run`，还是允许进入 `--post`
- 是否需要传入 `--model`、`--effort`、`--thinking`
- 是否需要常驻调度，以及本机应该如何调度

## 目标结果

这套配置当前解决两件事：`GitHub 仓库出现新 issue / PR / 跟进评论时，先稳定接住，并自动回一条带“初步判断 + 排查建议 / 产品方向判断”的回复`。

主流程应该跑通：

- GitHub 有新内容
- 本机定时轮询抓到它
- 生成本地 intake snapshot，方便后续分析
- 如果维护者还没回复过，就自动回一条带初步判断的评论

当前刻意不做：

- 实时通知到手机
- 依赖外部模型 API 才能工作
- 自动打 label、自动 merge、自动 review code diff

## [HUMAN] 步骤

1. 如果 `gh auth status` 显示未登录，完成人工 GitHub 登录或授权。
2. 明确要监听的仓库、维护者账号，以及是否允许自动发评论。
3. 从 `dry-run` 切到 `--post` 之前，由人类做一次最终确认。

## AI 负责的流程

- 使用 `gh api` 轮询仓库的 `issues` 列表，并按 `updated_at` 抓最近变化的条目。
- 使用 `scripts/github-auto-triage.mjs` 跑完整链路。
- 开始前先把 repo、maintainers、发布策略、模型参数这些上下文一次性收齐，避免频繁打断人。
- 默认先 `dry-run`，确认回复草稿质量再进入真正发布。
- 如需常驻 rollout，创建本地 wrapper + scheduler；先不要为了这条链路直接改服务端接 webhook。
- 如需更强回复质量，可选传入 `--model`、`--effort`、`--thinking`，但第一层先把 intake + first reply 主链路跑稳。

## 默认产物

- State 文件：`~/.config/remotelab/github-triage/<owner>__<repo>.json`
- Snapshot 目录：`~/.config/remotelab/github-triage/inbox/<owner>__<repo>/`

每个 snapshot 会保存：

- 标题、正文、评论、PR review
- 最近一次外部活动
- 最近一次维护者活动
- 当前是否需要回复
- 当前拟发送的自动回复草稿
- 命中的相关仓库上下文

## 常用执行路径

先 `dry-run`：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --bootstrap-hours 72
```

这一步不会真的发评论，只会：

- 打印拟发送的自动回复
- 写入本地 state
- 生成 intake snapshot

确认 `dry-run` 没问题后，才进入真正自动回复：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --post
```

如果要手动验证维护者线程，可显式打开测试开关：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --only 4 --reply-to-maintainers --post
```

如果只想安全预览某个线程“按现在规则会怎么回”，但不真的发评论：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --only 2 --force-draft
```

## 成功标准

- state 文件和 snapshot 持续更新
- `dry-run` 草稿质量可用
- 开启 `--post` 后，只对需要回复的外部线程发一次带标记的回复
- 默认不会自动回复维护者自己发起的线程

## 当前策略

当前自动回复依然偏保守，但已经不是纯“收到”了：

- 会先给一个初步判断
- 会给出第一轮排查建议，或者产品方向 / 设计取舍判断
- 会结合仓库里命中的设计记录、README、notes/docs 等上下文
- 中英文自动选一个更像当前线程的语言
- 不依赖外部模型 API，因此定时任务成本和稳定性都更可控

主流程验证通过后，再考虑：

- 只在复杂线程上叠加模型增强
- 先保存草稿，再决定是否自动发出
- 之后才考虑通知、标签、优先级、真正 webhook 化
