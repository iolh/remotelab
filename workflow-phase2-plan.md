# Phase 2 — 半自动编排计划

> 前置：[`workflow-v2.1-spec.md`](workflow-v2.1-spec.md) 核心能力已落地。
>
> 本文档只关注下一步：怎么把手动的"用户自己开辅助线"升级成半自动的"系统提示 + 用户确认 + 自动创建"。

---

## 1. 当前位置

### 已落地（可直接依赖）

| 能力 | 代码位置 |
|---|---|
| typed handoff（`verification_result` / `decision_result`） | `session-manager.mjs` `normalizeWorkflowHandoffType()` |
| `superseded` 覆盖规则 | `session-manager.mjs` `appendWorkflowPendingConclusion()` |
| 空状态 prompt 注入 `No open workflow handoffs.` | `session-manager.mjs` `buildWorkflowPendingConclusionsPromptBlock()` |
| 执行验收只读运行时 | `session-manager.mjs` `resolveWorkflowExecutionRuntimeOptions()` |
| payload 结构化 + 枚举 recommendation / confidence | `session-manager.mjs` `normalizeWorkflowConclusionPayload()` |
| 状态机 pending / needs_decision / accepted / ignored / superseded | `session-manager.mjs` `normalizeWorkflowConclusionStatus()` |
| 回灌 API（POST `/api/sessions/:id/handoff`） | `router.mjs` |
| 状态更新 API（POST `/api/sessions/:id/conclusions/:conclusionId`） | `router.mjs` |
| 前端三区展示（待处理 / 待决策 / 已处理） | `session-surface-ui.js` |
| run 完成后 workflow state 建议 | `session-manager.mjs` `scheduleSessionWorkflowStateSuggestion()` |
| session 创建支持 appName / systemPrompt / model / effort / group | `session-manager.mjs` `createSession()` |
| session 可记住 handoff 默认目标 | session metadata `handoffTargetSessionId` |

### 未落地（Phase 2 要补）

1. 主线 run 完成后发出 `ready_for_verification` 建议
2. 前端展示建议并等用户确认
3. 用户确认后自动创建辅助线 session
4. 辅助线自动预填 handoff 目标和初始上下文

---

## 2. 核心设计

### 2.1 半自动 = 系统建议 + 用户确认

不跳过用户。不在用户不知情时创建 session。

流程：

```
主线 run 完成
  → 系统判断是否建议开辅助线
  → 如果建议：在前端显示提示卡
  → 用户点"确认"：系统自动创建辅助线 session
  → 用户点"跳过"：不创建，提示消失
  → 辅助线完成后：通过已有 handoff API 自动回主线
```

### 2.2 建议触发条件

不是每次 run 完成都建议。只在以下条件同时满足时触发：

1. session 是主线（`isWorkflowMainlineAppName` 返回 true）
2. run 正常完成（state === `completed`，非 compaction / internal）
3. 当前没有未处理的同类 handoff（避免重复建议）
4. session 不处于 archived 状态

### 2.3 建议类型

Phase 2 先只支持一种建议：

**`suggest_verification`**

含义：主线刚完成一轮实现，建议开启独立验收。

后续可以扩展：
- `suggest_decision`：主线遇到高不确定问题，建议开启深度裁决
- `suggest_revalidation`：修复后建议重新验收

但 Phase 2 先只做 `suggest_verification`，因为"做完后验一轮"是最高频的半自动场景。

---

## 3. 实现方案

### 3.1 后端：建议生成

**插入点**：`finalizeDetachedRun()` — run 完成后的收尾路径。

当前 `finalizeDetachedRun()` 在 run 完成后已经做了：
- 清理 activeRunId
- 持久化 resume IDs
- 触发 completionTargets
- 触发 label suggestion
- 触发 workflow state suggestion
- 触发 auto-compaction
- 发送 push notification

Phase 2 在这条路径上新增一步：**workflow next-step suggestion**。

```javascript
if (!manifest?.internalOperation) {
  maybeEmitWorkflowSuggestion(sessionId, latestSession, finalizedRun);
}
```

`maybeEmitWorkflowSuggestion` 的逻辑：

1. 检查 session 是否是主线（`isWorkflowMainlineAppName`）
2. 检查 run 是否正常完成
3. 检查当前是否已有 pending 的 `verification_result` handoff
4. 如果条件满足，写入一个 suggestion 到 session metadata：

```json
{
  "workflowSuggestion": {
    "type": "suggest_verification",
    "runId": "触发这条建议的 run ID",
    "createdAt": "ISO 8601",
    "status": "pending"
  }
}
```

5. 通过 WS invalidation 通知前端

**为什么写到 session metadata 而不是单独存储**：
- 建议和 session 是 1:1 关系（一个 session 同时只有一条活跃建议）
- 不需要持久历史（建议被处理后可以清除）
- 和 `workflowPendingConclusions`、`workflowCurrentTask` 保持一致的存储模式

### 3.2 后端：建议消费

新增两个 API：

**`POST /api/sessions/:id/workflow-suggestion/accept`**

行为：
1. 读取当前 suggestion
2. 根据 suggestion type 创建辅助线 session：
   - tool：继承主线的 tool
   - appName：`执行验收`
   - model：继承主线或升一档
   - effort：`high`
   - handoffTargetSessionId：当前主线 session ID
   - systemPrompt：验收 App 的默认 prompt
   - group：继承主线的 group
3. 将主线最近一轮的改动摘要注入辅助线的初始上下文
4. 清除主线的 suggestion
5. 返回新创建的辅助线 session

**`POST /api/sessions/:id/workflow-suggestion/dismiss`**

行为：
1. 将 suggestion status 设为 `dismissed`
2. 不创建任何 session
3. 返回更新后的主线 session

### 3.3 前端：建议展示

**展示位置**：主线 session 的状态区（`session-surface-ui.js` 已有的 workflow summary panel）。

当 session 有 `workflowSuggestion` 且 status === `pending` 时，在状态区顶部渲染一张建议卡：

```
┌──────────────────────────────────────┐
│  建议：开启独立验收                    │
│                                      │
│  本轮实现已完成，建议开启独立验收       │
│  确认改动是否符合预期。               │
│                                      │
│  [开启验收]          [跳过]           │
└──────────────────────────────────────┘
```

- "开启验收"：POST accept → 跳转到新创建的验收 session
- "跳过"：POST dismiss → 建议卡消失

**不做**：
- 不弹 modal
- 不打断当前操作
- 不自动跳转
- 建议卡是非阻塞的——用户可以继续在主线操作，忽略建议

### 3.4 辅助线初始上下文

自动创建的验收 session 需要带上足够的上下文，让验收 agent 不需要用户再手动描述"你要验什么"。

**初始上下文来源**：

1. **主线的 `workflowCurrentTask`**：当前任务描述
2. **主线最近一轮 run 的改动摘要**：从 run 的 normalized events 中提取
3. **主线的已知风险**：如果主线 agent 在收口时提到了风险

**注入方式**：

在验收 session 的首条系统消息中注入：

```text
你正在对以下改动做独立验收：

任务：{workflowCurrentTask}
改动摘要：{最近一轮的 assistant 结论摘要}
已知风险：{如有}

请按照验收合同执行：跑测试、查交互、查边界，产出验证证据。
```

这条消息通过 `createSession` 的 `systemPrompt` 或通过创建后立即 append 一条 context message 实现。

---

## 4. 不做什么

Phase 2 明确不做：

| 不做 | 原因 |
|---|---|
| 自动创建（跳过用户确认） | 先验证"建议"模式是否好用 |
| `suggest_decision` 建议 | 判断"何时需要深度裁决"比判断"何时需要验收"难得多，先不做 |
| 推荐引擎 / 模式选择 | 这是 v3 的事 |
| 任务启动卡 | 这是 v3 的事 |
| 并行 worktree 自动编排 | 依赖更多基础能力 |
| 验收 session 自动开始执行 | 创建后由用户手动发第一条消息触发 |

---

## 5. 关键技术决策

### 5.1 主线怎么知道"这轮实现完成了"

**不依赖 agent 产出显式信号。**

原因：如果要求主线 agent 在收口时产出一个特殊 token（比如 `[READY_FOR_VERIFICATION]`），这会增加 prompt 复杂度，而且 agent 不一定每次都记得产出。

**改为：run 正常完成 = 这轮实现完成。**

这是一个合理的默认假设——如果 run 正常完成，说明 agent 认为当前轮次的工作已经做完了。

如果用户不需要验收（比如只是一轮对话），他可以点"跳过"。

### 5.2 建议的生命周期

- 每个 session 同时只有一条活跃建议
- 新的 run 完成时，旧的未处理建议自动覆盖（和 handoff superseded 同理）
- 建议被 accept 或 dismiss 后清除
- 建议不持久化到历史——它是瞬态的操作提示，不是持久的工作记录

### 5.3 验收 session 和主线的关系

- 验收 session 创建时 `handoffTargetSessionId` 指向主线
- 验收 session 的 `appName` 设为 `执行验收`
- 验收 session 完成后，用户通过已有的"回灌"按钮手动发起 handoff
- Phase 2 不自动回灌（先让用户控制回灌时机）

### 5.4 为什么验收 session 不自动开始跑

创建验收 session 后，用户需要手动发第一条消息。

原因：
- 用户可能想在验收开始前调整验证范围
- 用户可能想补充"最担心的点"
- 自动开始跑的验收如果方向不对，浪费的是一次完整的 LLM call

Phase 3 可以考虑"一键创建 + 自动开始"，但 Phase 2 先让用户控制第一步。

---

## 6. 实现顺序

### Step 1：后端建议生成

- 在 `finalizeDetachedRun()` 末尾加入 `maybeEmitWorkflowSuggestion()`
- 写入 `session.workflowSuggestion`
- WS invalidation 通知前端

**验证**：run 完成后，session detail API 能返回 `workflowSuggestion` 字段。

### Step 2：后端建议消费

- 新增 accept / dismiss API
- accept 时调用 `createSession()` 创建验收 session
- 预填 handoffTargetSessionId、appName、group
- 注入初始上下文

**验证**：accept 后能创建出配置正确的验收 session，dismiss 后建议消失。

### Step 3：前端建议卡

- 在 `session-surface-ui.js` 的 workflow summary panel 中渲染建议卡
- 绑定 accept / dismiss 按钮

**验证**：主线 run 完成后出现建议卡，点击后正确创建或跳过。

### Step 4：初始上下文注入

- 从主线最近一轮 run 中提取改动摘要
- 注入到验收 session 的首条消息

**验证**：验收 session 打开后，agent 不需要用户再描述"你要验什么"就能开始。

---

## 7. 成功标准

Phase 2 做完后，用户的体验应该是：

1. 在主线完成一轮实现
2. 状态区出现"建议开启验收"
3. 点击"开启验收"
4. 自动跳转到一个已经知道要验什么的验收 session
5. 用户发一条消息触发验收
6. 验收完成后，一键回灌到主线
7. 主线状态区出现 `verification_result`

整个过程中用户不需要：
- 手动创建 session
- 手动填 session 配置（tool / model / app）
- 手动复制改动摘要到验收 session
- 手动设置 handoff 目标

**用户从"手动开辅助线 + 手动配置 + 手动传上下文"变成"一键确认 + 自动配置 + 自动传上下文"。**

---

## 8. Phase 2 完成后为 v3 积累什么

| 数据 / 经验 | 对 v3 的价值 |
|---|---|
| 多少比例的 run 完成后用户接受了验收建议 | 判断"标准交付"是否应该成为默认模式 |
| 用户跳过建议的场景分布 | 判断哪些任务适合最简路径 |
| 自动创建的验收 session 质量 | 判断初始上下文注入是否够用 |
| 回灌的完成率 | 判断 Phase 3 是否应该自动回灌 |
| 建议卡的交互体验 | 直接复用为 v3 推荐卡的交互模式 |
