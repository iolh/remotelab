# 工作流简化演进 Plan

项目路径：~/code/remotelab

## 目标

将当前"用户手动选模式+策略"的工作流系统，演进为"用户只描述任务，系统自动编排"的体验。保留底层多阶段引擎能力不变，改变的是用户侧的交互方式。

## 核心原则

- 底层 workflow-definition.mjs 的四种模式定义保留不动，它们作为内部编排方案继续存在
- 用户不再需要知道模式和策略的存在，系统自动选择
- 已有的 API 参数（workflowMode、gatePolicy）保持向后兼容，只是不再要求用户必须提供
- 策略默认 low_confidence_only，不再暴露为用户选项

---

## Phase 1：自动复杂度路由（auto-routing）

### 1.1 新增复杂度评估函数

文件：`chat/workflow-auto-router.mjs`（新建）

功能：根据任务文本自动判断适合的 workflowMode。

```
export function classifyTaskComplexity(text, context = {})
```

输入：
- text：用户的任务描述文本（已剥离内联声明后的 cleanedText）
- context：可选的上下文信息 { fileCount, hasDesignInput, hasMultipleGoals, sessionFolder }

返回：
```
{
  mode: 'quick_execute' | 'standard_delivery' | 'careful_deliberation' | 'parallel_split',
  confidence: 'high' | 'medium' | 'low',
  reason: string,  // 简短说明选择依据，用于状态提示
}
```

判断规则（按优先级）：
1. 文本包含明确的并行/拆分意图（"同时做 A 和 B"、"并行"、"独立的子任务"）→ parallel_split
2. 文本包含设计稿链接（figma/蓝湖/mastergo URL）或提到"交互稿""视觉稿" → careful_deliberation
3. 文本包含架构级关键词（"重构"、"架构"、"迁移"、"方案对比"、"技术选型"）→ careful_deliberation
4. 文本长度 > 500 字符 或包含多个明确的需求点（通过编号列表或"需求 N"模式检测）→ standard_delivery
5. 文本提到多个文件/模块/组件（> 3 个不同实体名）→ standard_delivery
6. 其余 → quick_execute

注意：这些规则是启发式的初版，后续会根据使用数据调整。规则应该写成可配置的结构，方便增删改。

测试：`tests/test-workflow-auto-router.mjs`（新建），覆盖上述每条规则的正例和边界情况。

### 1.2 修改内联声明解析，支持无模式声明

文件：`chat/session-manager.mjs`

当前行为：`parseInlineWorkflowDeclarations(text)` 要求消息开头有 `模式：xxx` 才会激活工作流。

新增行为：
- 如果用户写了 `模式：xxx`，行为不变（向后兼容）
- 如果用户只写了 `策略：xxx` 没写模式，使用 `classifyTaskComplexity` 自动推断模式
- 新增支持一个极简触发行：`工作流：自动` 或 `workflow: auto`，表示用户希望启用工作流但把模式选择交给系统

修改 `parseInlineWorkflowDeclarations` 返回结构，新增 `autoRouted: boolean` 字段标识是否为自动路由。

### 1.3 修改激活状态提示

文件：`chat/session-manager.mjs`

修改 `formatInlineWorkflowActivationStatus` 函数：
- 手动指定模式时：`已激活工作流 · 审慎模式（策略：有把握自动）`（现有行为）
- 自动路由时：`已自动激活工作流 · 审慎模式（原因：检测到设计稿输入和架构决策需求）`

---

## Phase 2：默认策略 + 智能暂停

### 2.1 移除策略选择的用户暴露面

文件：`ui-island/src/chat-chrome.tsx`

当前 workflow intake modal 里有策略选择器（每步确认 / 有把握自动 / 只看最终）。

改动：
- 移除策略选择 UI 控件
- 硬编码默认策略为 `low_confidence_only`
- 在 intake modal 底部加一行浅灰小字说明："系统会在需要你判断时自动暂停，确定性高的步骤自动推进。"

注意：后端 API 仍接受 gatePolicy 参数（向后兼容），只是前端不再暴露选择。

### 2.2 增强自动暂停判断

文件：`chat/session-manager.mjs`

当前的 `shouldWorkflowVerificationRequireHumanReview` 和 `canWorkflowVerificationAutoAbsorb` 已经有基于 payload 字段的判断逻辑。

增强点：
- 在 `maybeEmitWorkflowSuggestion` 里，如果当前阶段完成且下一阶段是 verify/deliberate，自动检查本次 run 是否有 blocking issues
- 如果 run 输出里包含"不确定"、"需要确认"、"风险"、"冲突"等关键词，即使 confidence 标为 high，也触发暂停（防止 AI 过度自信）
- 将暂停判断逻辑抽出为独立函数 `shouldPauseForHumanReview(session, run, conclusion)` 方便后续统一维护

---

## Phase 3：隐式阶段流转

### 3.1 自动推进执行-验收链路

文件：`chat/session-manager.mjs`

当前的 `maybeAdvanceMainlineNonExecuteStage` 已经支持主线阶段推进。

增强：当 execute 阶段的 run 完成后，如果模式不是 quick_execute 且下一阶段是 verify 或 deliberate：
- 不再弹出 suggestion 等用户点击"接受"
- 而是直接自动创建子阶段 session 并启动（复用现有的 `acceptWorkflowSuggestionInternal` 逻辑）
- 仅在 `shouldPauseForHumanReview` 返回 true 时暂停等待用户

同时在主线消息流中插入一条状态事件，例如："已自动启动验收阶段"或"检测到潜在风险，暂停等待确认"。

### 3.2 阶段完成自动流转

当 verify/deliberate 子阶段的 handoff 结果返回主线时：
- 如果 confidence 为 high 且 recommendation 为 ok（验收场景）或有明确推荐方案（再议场景），自动吸收结论并推进到下一阶段
- 如果需要人工判断，保持当前行为（pending conclusion 等用户处理）

这部分逻辑在 `finalizeWorkflowAutoAbsorb` 和 handoff 处理路径中修改。

---

## Phase 4：简化前端模式选择

### 4.1 Intake Modal 改造

文件：`ui-island/src/chat-chrome.tsx`

当前 modal 要求用户选择工作流模式（快速执行/标准交付/审慎模式/并行推进）。

改为：
- 默认不显示模式选择，只显示任务描述表单（目标、项目路径、约束、进展）
- 底部加一个折叠区域"高级选项"，展开后可以手动指定模式（给需要精确控制的用户保留能力）
- 表单提交时，如果用户未手动选模式，调用 classifyTaskComplexity 自动决定
- 提交后的 toast 提示改为："任务已启动 · 审慎模式（自动选择）"

### 4.2 任务状态时间线

文件：`static/chat/session-surface-ui.js`

当前的 workflow summary panel 显示任务名和结论计数。

增强为简易时间线视图：
- 显示当前 workflowDefinition.stages 列表，每个阶段一行
- 当前阶段高亮，已完成阶段带 ✓，未来阶段灰色
- 格式示例：`✓ 再议 → ● 执行中 → ○ 复盘 → ○ 收口 → ○ 验收`
- 这个时间线嵌入到已有的 workflowSummaryBtn 的 popover 或 tooltip 中

---

## Phase 5：效果度量基础设施

### 5.1 工作流执行日志

文件：`chat/session-manager.mjs`

在工作流的关键节点记录结构化日志事件（appendEvent），用于后续分析：

- 工作流激活时：`{ type: 'workflow_metric', event: 'activated', mode, autoRouted, taskLength, timestamp }`
- 每次阶段切换时：`{ type: 'workflow_metric', event: 'stage_advance', fromStage, toStage, autoAdvanced, timestamp }`
- 人工暂停时：`{ type: 'workflow_metric', event: 'human_pause', reason, stage, timestamp }`
- 工作流完成时：`{ type: 'workflow_metric', event: 'completed', totalStages, totalRuns, humanPauseCount, durationMs, timestamp }`

这些事件类型 `workflow_metric` 在 UI 渲染时跳过（不在消息流里显示），只用于数据分析。

### 5.2 渲染跳过

文件：`static/chat/ui.js`

在 `renderStatusInto` 或事件分发处，对 `type === 'workflow_metric'` 的事件不渲染。

---

## 执行顺序和依赖

1. Phase 1（自动路由）可独立完成，不影响现有功能
2. Phase 2（默认策略）依赖 Phase 1 完成后的自动路由函数
3. Phase 3（隐式流转）是行为变更最大的部分，需要 Phase 2 的暂停判断函数
4. Phase 4（前端改造）依赖 Phase 1 的 classifyTaskComplexity 可从前端调用（或后端暴露一个轻量 API）
5. Phase 5（度量）可与任何 Phase 并行进行

建议先做 Phase 1 + Phase 5，跑通后再做 Phase 2 + Phase 3，最后做 Phase 4。

## 不改的部分

- `chat/workflow-definition.mjs` 的模式定义结构不动
- 后端 API 的 workflowMode / gatePolicy 参数保持向后兼容
- 已有的 handoff、conclusion、worktree 机制不动
- self-check（上游原有功能）不动
- 内联声明的向后兼容：用户仍然可以写 `模式：审慎模式` 来手动指定，只是不再是必须的
