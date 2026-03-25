> Archived on 2026-03-25.
> This state-machine-era workflow spec has been superseded by `notes/current/workflow-simplified.md` and the event-driven handoff implementation in `chat/workflow-engine.mjs`.
> Keep this file only as historical reference.

# RemoteLab AI 协作工作流 — 正式规格 v2.1

> 状态：**规格草案 v2.1**
>
> 本版是在 v2 草案基础上补齐 5 条实现边界：
> - 同模型入口的硬隔离
> - handoff 覆盖关系与 `superseded`
> - 深度裁决的冷启动输入协议
> - 执行验收 session 的复用策略
> - 最简路径

---

## 1. 设计目标

本工作流的目标不是“多模型都能用”，而是把日常 AI 协作稳定收敛成 3 种能力角色：

- `主交付`：把任务做出来
- `执行验收`：把结果验出来
- `深度裁决`：把高代价判断判出来

用户默认只需要表达：

- 事实
- 观点
- 决策

系统负责：

- 入口职责边界
- 输出合同
- 入口之间的 typed handoff
- 主线的待处理结论与状态汇总

---

## 2. 三个入口

### 2.1 主交付

**角色**

唯一主线，把任务做出来并收口成可验收结果。

**推荐运行时**

- `Codex + GPT-5.4 + medium`

**输入**

- 目标
- 项目路径
- 边界 / 不能动什么
- 当前进展
- 用户已有判断

**输出**

- 执行计划
- 改动摘要
- 为什么这么改
- 当前风险
- 下一步

**明确不负责**

- 完整验证证据
- 最终 go/no-go 裁决

**收口标准**

- 代码已落地
- 改动理由清楚
- 已知风险被点明
- 明确说明：
  - 是否需要 `执行验收`
  - 是否需要 `深度裁决`
  - 或本次不需要辅助线

### 2.2 执行验收

**角色**

独立验证，不接管实现主线。

**推荐运行时**

- `Codex + GPT-5.4 + high`

**输入**

- 改动摘要
- 关键 diff / 关键文件
- 运行方式
- 验证范围
- 用户最担心的点

**输出**

- 已验证项
- 未验证项
- 发现的问题
- 验证证据
- 是否建议继续

**明确不负责**

- 大段方案讨论
- 重写实现路径
- PR 冲突裁决

**收口标准**

- 用户能一眼知道：
  - 哪些真的验过了
  - 哪些没验
  - 哪里有问题
  - 是否建议进入下一步

### 2.3 深度裁决

**角色**

处理高不确定、高代价判断，不负责长链执行。

**推荐运行时**

- `Cursor + Claude Opus 4.6 Thinking`

**输入**

- 当前状态
- 核心问题
- 约束
- 候选方案
- 用户倾向

**输出**

- 关键判断
- 推荐方案
- 放弃的选项
- 风险与代价
- 需要用户拍板的点

**明确不负责**

- 长链执行
- 常规验证
- 日常小修小补

**收口标准**

- 主交付可以直接吸收裁决结果继续推进

---

## 3. 最简路径与升级路径

### 3.1 最简路径

低风险、小改动任务可以只走：

`主交付`

这类任务允许 `主交付` 直接收口，并明确说：

`本次不需要执行验收 / 深度裁决`

### 3.2 常规路径

常规任务默认：

`主交付 -> 执行验收 -> 主交付收口`

### 3.3 高不确定路径

复杂新需求、跨模块重构、重大取舍：

`深度裁决 -> 主交付 -> 深度裁决 -> 主交付 -> 执行验收`

适用节奏：

- 先用第一轮 `深度裁决` 收敛方向与取舍
- 第一轮 `主交付` 先把可落地部分做出来
- 第二轮 `深度裁决` 复盘残余风险、补做项和是否值得继续扩改
- 最后一轮 `主交付` 按复盘结果收口
- 最后进入独立 `执行验收`

---

## 4. 交付物合同之外的关键边界

### 4.1 同模型入口的硬隔离

`主交付` 和 `执行验收` 都使用 `GPT-5.4`，仅靠提示词隔离不够。

**规格要求**

`执行验收` 需要额外运行时约束，至少应满足：

- 默认不写文件
- 默认不执行会产生持久代码改动的操作
- 默认不执行 `git commit`
- 可以：
  - 读代码
  - 跑测试
  - 跑页面
  - 查交互
  - 收集验证证据

**阶段性策略**

如果当前 RemoteLab 还不支持 runtime 权限模板，先把这条作为明确规格保留；后续优先实现。

### 4.2 深度裁决的冷启动协议

`深度裁决` 是低频入口，默认视为冷启动。

首条输入不应依赖 agent 自己探索上下文，而应尽量提供结构化输入包。

**建议最小输入包**

```json
{
  "currentState": "当前做到哪里",
  "decisionQuestion": "这次到底要判断什么",
  "constraints": ["不能动什么", "时间要求", "兼容要求"],
  "options": ["方案A", "方案B"],
  "preferredOption": "用户当前倾向"
}
```

后续产品化时，这个结构直接复用为 `decision_request.payload`。

### 4.3 执行验收的 session 复用规则

`执行验收` 可以复用同一个 session。

原因：

- 验收线保留上下文，知道上一次验了什么
- 避免每轮验证都冷启动

**但回灌结果必须独立**

- session 是有状态的
- 每一轮 `verification_result` 是独立 handoff
- 主线不直接按 session 吸收，而按 handoff 吸收

---

## 5. Typed Handoff v2.1

### 5.1 MVP 范围

v2.1 先只要求产品化两类结果型 handoff：

- `verification_result`
- `decision_result`

不要求先做：

- `verification_request`
- `decision_request`

理由：

- 用户现在已经能手工开辅助线并告诉它要做什么
- 当前最痛的是辅助线结果如何稳定回主线

### 5.2 最小公共字段

```json
{
  "id": "string",
  "handoffType": "verification_result | decision_result",
  "sourceSessionId": "string",
  "sourceSessionName": "string",
  "targetSessionId": "string",
  "label": "string",
  "summary": "string",
  "status": "pending | needs_decision | accepted | ignored | superseded",
  "round": 1,
  "supersedesHandoffId": "string | null",
  "createdAt": "ISO 8601",
  "handledAt": "ISO 8601 | null",
  "payload": {}
}
```

### 5.3 状态说明

- `pending`
  - 主线还没处理
- `needs_decision`
  - 主线判断这条需要用户拍板
- `accepted`
  - 主线已吸收
- `ignored`
  - 主线明确不采纳
- `superseded`
  - 这条结果已被同源更新结果覆盖，不再作为当前有效结论展示

### 5.4 覆盖规则

当同一个 `sourceSessionId + handoffType` 产出新的结果时：

- 旧的未终态结果（`pending` / `needs_decision`）自动标记为 `superseded`
- 新结果成为当前有效结果

终态结果：

- `accepted`
- `ignored`

不自动覆盖，作为历史保留。

### 5.4.1 跨源同类结果

MVP 的自动覆盖规则只针对：

- 同一个 `sourceSessionId`
- 同一个 `handoffType`

这意味着如果用户为同一任务开了两个不同的 `执行验收` session，或者开了两个不同的 `深度裁决` session：

- 两个 session 的结果不会自动互相覆盖
- 主线会同时看到两条同类结果

这是 v2.1 的**刻意保守策略**，原因是当前系统里还没有稳定的 `taskId` 概念，不适合为了覆盖关系提前引入新的任务主键。

**处理原则**

- 默认鼓励复用同一个辅助 session
- 跨源同类结果由用户或主线 agent 明确决定采纳哪一条
- 后续如果引入稳定的任务主键，再升级覆盖规则

### 5.5 verification_result.payload

```json
{
  "validated": ["已验证项"],
  "unverified": ["未验证项"],
  "findings": ["发现的问题"],
  "evidence": ["验证证据"],
  "recommendation": "ok | needs_fix | needs_more_validation"
}
```

### 5.5.1 产品契约

后端在接收 `verification_result` 时强制校验以下字段：

- `summary`：不能为空
- `recommendation`：必须是 `ok` / `needs_fix` / `needs_more_validation` 之一
- `confidence`：必须是 `high` / `medium` / `low` 之一

**缺失时的行为**：

1. 如果验收 run 完成后未产出合格的 `<verification_result>` 块，系统会自动发送一条 follow-up 消息要求模型补充（仅重试一次）
2. 重试后仍不合格：
   - 如果能从 assistant message 中提取 summary，执行回灌但强制设为 `needs_decision`
   - 如果连 summary 都无法提取，不执行回灌，回退到 `waiting_user`
3. 合格的 `<verification_result>` 是自动回灌和自动吸收的前置条件，不是可选的提示词建议

### 5.6 decision_result.payload

```json
{
  "recommendation": "推荐方案",
  "rejectedOptions": ["被放弃的方案"],
  "tradeoffs": ["代价与取舍"],
  "decisionNeeded": ["需要用户拍板的点"],
  "confidence": "high | medium | low"
}
```

### 5.7 生命周期与过期提示

结果型 handoff 不自动删除，但允许进入“过期提示”状态。

**软规则**

- 如果一条 `pending` / `needs_decision` 的 handoff 在主线里连续经过 `3` 轮后续用户回合仍未处理，
  或者已经超过 `72` 小时仍未处理，
  系统应把它标记为“可能已过时”并降级展示。

**v2.1 约束**

- 不自动删除
- 不自动改成 `ignored`
- 仅增加过期提示或折叠展示

这样既保留历史，又能避免主线长期被陈旧结论污染。

---

## 6. 主线如何消费 handoff

### 6.1 主线状态区

主线状态区至少展示：

- `当前任务`
- `待我决策`
- `主线吸收区`

### 6.2 展示规则

`待我决策`

- 只展示 `needs_decision`

`主线吸收区`

- 只展示最新且未被 `superseded` 的 handoff
- 按类型分组：
  - 执行验收结果
  - 深度裁决结果

`最近已处理`

- 展示：
  - `accepted`
  - `ignored`

### 6.3 Prompt 注入规则

主线 prompt 只注入：

- 当前有效且未终态的结果型 handoff
- 不注入 `superseded`

如果当前没有任何待处理 handoff，显式注入：

```text
No open workflow handoffs.
```

这样可以消除歧义，让主线明确知道当前处于干净状态，而不是“系统忘了注入 handoff”。

参考格式：

```text
Open workflow handoffs requiring attention:

1. [verification_result] 执行验收结果
   - 来源：执行验收 · 搜索页改造
   - 状态：待处理
   - 摘要：移动端空态未验证，筛选重置已验证通过。

2. [decision_result] 深度裁决结果
   - 来源：深度裁决 · 搜索页改造
   - 状态：待用户决策
   - 摘要：推荐方案 B，但需要确认是否接受额外 1 天工期。
```

---

## 7. 使用规则

### 小任务

- 只开 `主交付`
- `主交付` 可以直接收口

### 常规任务

- `主交付`
- 如果需要独立验证，开 `执行验收`
- `执行验收` 回 `verification_result`
- `主交付` 收口

### 高不确定任务

- 先开 `深度裁决`
- `深度裁决` 回 `decision_result`
- 再开 `主交付`
- 再开 `执行验收`

### PR 场景

如果核心问题是：

- “到底有没有真的改对 / 验够” → `执行验收`
- “评论冲突时到底听谁的 / 怎么取舍” → `深度裁决`

---

## 8. 最小实现顺序

1. 在现有 `workflowPendingConclusions` 上扩字段：
   - `handoffType`
   - `payload`
   - `round`
   - `supersedesHandoffId`
   - `status = superseded`
2. 让主线只展示最新且未被 `superseded` 的结果
3. 让主线 prompt 只消费当前有效结果
4. 给 `执行验收` 增加运行时隔离能力
5. 再考虑 `verification_request / decision_request`

---

## 9. 当前与未来的映射

### 当前已有

- 辅助线 → 主线 的回灌 MVP
- 主线的待处理结论区
- 当前任务字段
- 吸收状态可视化

### v2.1 要补

- 结果型 handoff 的 typed payload
- `superseded` 覆盖规则
- 执行验收的运行时硬隔离
- 深度裁决的结构化冷启动输入

---

## 10. 文档角色

当前仓库中与工作流相关的文档分工应当明确：

- `workflow.md`
  - 角色：演进摘要 / 历史背景 / 设计回顾
  - 不再作为最新实现规格的唯一来源
- `workflow-v2.1-spec.md`
  - 角色：当前有效的实现规格
  - 后续功能设计与实现应优先对齐本文件

这能避免两个文档同时承担“设计草案”和“实现规格”职责，导致后续不同步。

---

## 11. 一句话版

v2.1 的核心不是再改命名，而是把这 3 件事写成硬规格：

- `主交付` 负责做出来
- `执行验收` 负责验出来
- `深度裁决` 负责判出来

三者之间用 typed handoff 传递结构化工作物，并通过 `superseded`、运行时隔离和冷启动协议，把边界真正立住。
