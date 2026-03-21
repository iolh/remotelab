# Open Provider / Model Architecture

> 状态：方向性架构草案，不是当前 shipped provider 实现说明。
> 当前已落地的 tool/provider 分层请先看 `docs/project-architecture.md` 第 12 节。
> 本文档保留 provider 重构最核心的结构判断，避免继续把“tool 列表”“model 列表”“runtime adapter”拆成彼此漂移的三套东西。

---

## 1. 问题定义

当前 chat 侧 provider 抽象是分裂的：

- `lib/tools.mjs` 管可用工具列表
- `chat/models.mjs` 管模型列表
- `chat/process-runner.mjs` + `chat/adapters/*.mjs` 管 runtime
- `static/chat.js` 还带着部分 reasoning UI 协议

结果是：

- `tools.json` 只能把命令塞进 picker，不等于完整接入一个 provider
- 新 provider 很容易在 model、reasoning、runtime 三处只接了一半
- 未知 provider 被错误套用 Claude/Codex 语义的风险很高

所以真正要开放的不是“tool list”，而是统一的 **provider contract**。

---

## 2. 设计目标

重构后的 provider 模型至少要满足：

1. **Provider 成为唯一一等抽象**
   - command、availability、model catalog、reasoning schema、runtime、resume metadata、capabilities 都挂在同一个 provider 上。

2. **同时支持 repo 内置与本地扩展**
   - 适合 PR 的 provider 可以内置在 repo 里。
   - 本地实验/私有 provider 不应该强迫用户 fork 仓库。

3. **支持 code mode 与 hardcode mode**
   - 高阶用户可以写 JS provider 做动态探测。
   - 普通用户也应该能通过 JSON/simple mode 完成轻量 provider 配置。

4. **兼容当前会话数据**
   - 现有 session / app 里的 `tool` 字段第一阶段继续保留，并解释为 `providerId`。

5. **拒绝伪兼容**
   - provider 没声明 runtime，就不能执行。
   - 不要再出现“看起来接上了，实际在走错误 runtime”的假抽象。

6. **配置型能力优先动态加载**
   - 只要是 provider 配置，不应把“重启服务”当成默认用户流程。

---

## 3. 核心结构

### 3.1 Provider 是顶层对象

后续与 agent/tool 相关的能力都应收敛到 provider 上，包括：

- availability
- model catalog
- reasoning schema
- runtime family / adapter
- argv/build args mapping
- parser / normalization hints
- resume field
- capability flags（图片、恢复、App 支持等）

一句话：

> 不再是 `tool + models + adapter` 的拼装关系，而是 `provider` 自带这些定义。

### 3.2 Runtime 要分两层

#### A. Runtime family

可复用的运行时模板，例如：

- `claude-stream-json`
- `codex-json`
- 未来可能的 `generic-jsonl` / `plain-stdio` / `openai-compatible`

#### B. Provider instance

具体 provider 绑定具体 command、defaults、models，但可以复用某个 runtime family。

这很重要，因为：

- 本地 JSON provider 不应该自己写 parser
- wrapper/provider variant 也不应该重复造整套 runtime

正确依赖关系应该是：

```text
session.tool(providerId)
  -> provider registry
    -> runtime family / adapter / args mapping
    -> model catalog / reasoning schema / capabilities
```

而不是一堆 `if (toolId === 'claude') ...` 的散落硬编码。

---

## 4. Provider 来源

推荐保留三种来源：

### A. Builtin provider

放在 repo 内，例如：

```text
chat/providers/builtin/*.mjs
```

用途：

- 官方支持
- 可通过 PR 演进
- 允许完整代码能力

### B. Local JSON provider

放在本机配置目录，例如：

```text
~/.config/remotelab/providers/*.json
```

用途：

- 零代码
- 轻量 hardcode 配置
- 覆盖 model label / reasoning levels / 默认值
- 只能绑定已知 runtime family

### C. Local JS provider

放在本机配置目录，例如：

```text
~/.config/remotelab/providers/*.mjs
```

用途：

- 本地 code mode
- 自定义探测逻辑
- 自定义 runtime/args mapping
- PR 之前的实验形态

### 加载顺序

```text
builtin < local json < local js
```

含义：

- builtin 先加载
- local JSON 可以 patch/override builtin
- local JS 最后加载，能力最强

同 `id` 视为 override / patch；`extends` 可用于派生 variant。

---

## 5. 推荐 Contract

JS provider 至少应能表达这些字段：

```js
{
  id,
  name,
  command,
  availability,
  source,

  modelCatalog,
  reasoning,
  defaults,
  capabilities,

  runtime: {
    family,
    resumeField,
    buildArgs,
    parser,
  },

  extends,
}
```

这里最关键的不是字段名本身，而是三个结构判断：

1. model/reasoning/runtime 统一归 provider 管
2. runtime family 可复用，provider instance 可派生
3. resume metadata 也应归 provider/runtime 显式声明，而不是散落在 session manager 里

---

## 6. API 与前端策略

第一阶段不必马上改掉外部 API 形状。

可以先保持：

- `/api/tools`
- `/api/models?tool=...`
- session / app 中的 `tool` 字段

但实现改成统一走 provider registry。

同时应逐步把内部 payload 正规化，例如把 reasoning 统一成一个标准结构，而不是继续让 `thinking: boolean` 和 `effort: string` 长期并存。

---

## 7. Simple Mode 的边界

simple mode 应该低门槛，但不能是假万能。

建议边界：

- simple provider 支持 `name` / `command` / model list / reasoning schema / defaults
- simple provider 必须绑定到一个已知 runtime family
- simple mode 默认动态加载并刷新 picker，不以重启为正常流程
- `id` 默认自动派生，只在 advanced/冲突场景才显式暴露

不要走“任意命令 + 任意解析 + 任意 shell 模板”的幻想路线。

更安全的方向是：

- 只支持 argv 级模板/映射
- 不支持 shell eval 模板
- 复杂情况进入 advanced path（本地 JS provider 或 repo builtin provider）

---

## 8. 迁移顺序

推荐顺序：

1. 先定义 provider contract 与 registry
2. 让 Claude / Codex 先作为 builtin provider 落地
3. 让 `/api/tools`、`/api/models` 改为走 registry，但先保持兼容外形
4. 再引入本地 JSON / 本地 JS loader
5. 最后再做 simple/advanced provider 管理 UX

这样可以先解决结构问题，再解决配置体验问题。

---

## 9. 明确不做的事

当前方向不意味着：

- 让任何命令都自动变成 fully supported provider
- 在 simple mode 暴露过多内部字段
- 让 provider 接入依赖服务重启
- 把 provider 架构和多用户/权限体系绑在一起

---

## 10. 相关文档

- `docs/project-architecture.md` — 当前 shipped provider/tool 分层
- `notes/current/core-domain-contract.md` — 当前 canonical objects
- `notes/directional/app-centric-architecture.md` — App / policy 层方向
