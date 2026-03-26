# Progressive Trust Runtime — 系统契约

> 状态：方向性设计契约，尚未进入实现。
> 记录于 2026-03-24。
> 当前 shipped 架构请看 `docs/project-architecture.md`。
> 产品愿景上下文请看 `notes/directional/product-vision.md`。

---

## 核心定位

Cue 的核心竞争力不是替用户自动做更多事，而是在用户逐步放权的过程中，稳定地赢得更多托管权。

更精确地说：Cue 是一个**可渐进授权的异步开发任务运行时**。模型是可插拔的计算后端，运行时本身才是产品资产。

这份文档定义六个一等公民对象及其状态转移规则。后续的产品功能、UI 设计、指标体系都应该锚定在这六个对象上。

---

## 设计原则

1. **信任先于使用，使用先于数据，数据先于 policy 复利。** 建设顺序按此排列。
2. **合流要有体面降级。** 并行的真正成本在合流，冲突时降级到人工决策点比全自动失败更可信。
3. **度量要能阶段归因。** 任务级统计不够，每个阶段的 latency、retry、否决原因都要结构化记录。
4. **自动决策必须可审计。** 每个自动决策留结构化摘要，不是 raw output，而是一句可验证的理由。
5. **可逆性写进运行时。** 系统敢自动做决定，不是因为永远对，而是因为错了容易回退。
6. **抽象成 planner / executor / reviewer 角色，底下按成本、质量、速度动态绑定具体模型。** 模型名可以变，角色分工不变。

---

## 一等公民对象

### 1. Task Contract

被治理的主体。其他五个对象都锚定在 Task 上。

**字段：**

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识 |
| `parentId` | 父任务 ID（拆分产生时） |
| `goal` | 自然语言目标描述 |
| `acceptanceCriteria` | 验收条件列表 |
| `scopeBoundary` | 作用域约束（文件/目录/模块白名单） |
| `dependsOn` | 依赖的其他 Task ID 列表 |
| `stage` | 当前阶段（见状态机） |
| `assignedRole` | 当前执行角色（planner / executor / reviewer / reconciler） |
| `boundModel` | 当前绑定的具体模型 |
| `worktreePath` | 隔离工作区路径 |
| `rollbackRef` | 回退锚点（commit SHA / patch ref） |
| `budgetConsumed` | 已消耗资源 |
| `budgetCeiling` | 资源上限 |
| `createdAt` | 创建时间 |
| `updatedAt` | 最后更新时间 |

**状态机：**

```
pending → planning → executing → reviewing → reconciling → completed
                                                         → paused_for_decision
                  ↗ (scope expansion detected)
          → paused_for_decision ──→ (user approve) → 回到对应阶段
                                 → (user reject)  → cancelled / revised
          → failed → rollback → (auto) → pending (retry)
                              → (manual) → paused_for_decision
```

关键规则：
- scope 扩张本身是一个决策点，不能静默扩大
- 任何阶段都可以转入 `paused_for_decision`
- `failed` 默认触发 rollback，rollback 成功后可选自动 retry 或等待人工

---

### 2. Trust Profile

每个 `(userId, repoId)` 维度一份。不是标量分数，是按能力域分维度的向量。

**字段：**

| 字段 | 说明 |
|---|---|
| `userId` | 用户标识 |
| `repoId` | 仓库标识 |
| `dimensions` | 能力域信任向量（见下） |
| `overallTier` | 综合信任层级（derived） |
| `calibrationCount` | 已校准的任务数 |
| `lastPromotionAt` | 上次升权时间 |
| `lastDemotionAt` | 上次降权时间 |

**信任维度（每个维度独立升降）：**

| 维度 | 低信任默认行为 | 高信任默认行为 |
|---|---|---|
| `branch_ops` | 仅在隔离分支操作 | 可操作主要开发分支 |
| `test_execution` | 自动跑测试，结果推给用户 | 自动跑测试，通过则静默继续 |
| `code_modification` | 每次修改暂停确认 | 低风险修改自动推进 |
| `refactoring` | 禁止大范围重构 | 可自动执行受限重构 |
| `merge_reconcile` | 合流一律暂停 | 低冲突合流自动处理 |
| `pr_management` | 草稿 PR 需确认 | 自动开 PR，合并仍需确认 |
| `external_publish` | 禁止 | 需逐次确认 |

**冷启动规则：**
- 新用户 × 新仓库：所有维度初始化为最低信任
- 前 N 个任务（建议 N=3~5）强制保守模式：每个自动决策都附带审计摘要，每个阶段转换都暂停
- 冷启动期间，系统通过用户的确认/否决/修改行为快速标定偏好

**升降权规则：**
- 升权条件：连续 K 个同类决策被用户接受，且无回滚
- 降权条件：单次高风险误判即触发该维度降级（不影响其他已验证维度）
- 升权速率 < 降权速率（不对称设计）
- 降权后恢复路径：需要比初始升权更多的成功次数

---

### 3. Decision Card

运行时与用户之间的正式接口。不是 UI 组件，是协议对象。

**字段：**

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识 |
| `taskId` | 关联任务 |
| `type` | 决策类型（见下） |
| `urgency` | `blocking` / `advisory` / `informational` |
| `layers` | 三层信息结构（见下） |
| `suggestedAction` | 系统建议 |
| `confidence` | 建议置信度 (0–1) |
| `availableActions` | 用户可选操作列表 |
| `deadline` | 超时策略（超时后的默认行为） |
| `createdAt` | 创建时间 |
| `resolvedAt` | 用户响应时间 |
| `resolution` | 用户选择的操作 |

**决策类型枚举：**

| type | 触发场景 |
|---|---|
| `scope_expansion` | 任务作用域需要扩大 |
| `merge_conflict` | 合流冲突超过自动处理阈值 |
| `budget_exceeded` | 资源消耗超过预估 |
| `review_rejection` | reviewer 否决了 executor 产出 |
| `test_failure` | 测试失败且自动修复失败 |
| `ambiguous_requirement` | 目标描述歧义 |
| `risk_escalation` | 操作风险超出当前信任等级 |
| `checkpoint` | 阶段完成，等待确认继续 |

**三层信息语法（Decision Card Grammar）：**

```
Layer 1 — Glance（手机锁屏级）
  一句话结论 + 建议动作 + 置信度 + 风险等级
  用户看完能做 80% 的决策

Layer 2 — Context（展开级）
  关键 diff 摘要 + 冲突面 + 影响范围 + 变更文件列表
  用户需要更多信息时展开

Layer 3 — Evidence（完整级）
  原始 diff + 完整 trace + 相关决策历史 + 回退路径说明
  深入审查时使用
```

---

### 4. Budget Governor

资源消耗的策略层，不是事后统计。

**字段：**

| 字段 | 说明 |
|---|---|
| `taskId` | 关联任务 |
| `estimatedRange` | 任务启动时的成本预估区间 `[low, high]` |
| `consumed` | 当前已消耗（token / 时间 / API 调用次数） |
| `thresholds` | 触发决策点的阈值列表 |
| `degradationPath` | 超预算时的降级路径 |
| `currency` | 度量单位（token-equivalent / wall-time / dollar-equivalent） |

**状态转移：**

```
within_budget → approaching_threshold → threshold_breached → paused_for_decision
                                                          → auto_degraded (if policy allows)
```

**规则：**
- 任务启动时必须给出预估区间
- 消耗达到 `high` 的 80% 时触发 `approaching_threshold`
- 超过 `high` 时生成 Decision Card（type: `budget_exceeded`）
- 降级路径示例：切换到更便宜的模型、减少 reviewer 轮次、合并子任务
- 成本度量跨阶段累计，planner/executor/reviewer/reconciler 的消耗分开记录

---

### 5. Policy Stack

三层分离，冷启动、迁移、个性化不互相打架。

**结构：**

```
┌─────────────────────────────────────────┐
│  Layer 3: User Preferences              │  ← 用户显式设置 + 行为推断
│  风险承受度 / 成本敏感度 / 打断容忍度    │
├─────────────────────────────────────────┤
│  Layer 2: Repo Calibration              │  ← 从本仓库 trace 中学习
│  测试质量 / 模块耦合 / 代码风格 /       │
│  历史冲突模式 / 典型任务拆分粒度         │
├─────────────────────────────────────────┤
│  Layer 1: Global Heuristics             │  ← 跨仓库迁移，全局数据
│  合流冲突阈值 / 默认拆分策略 /          │
│  reviewer 严格度基线 / 暂停频率基线      │
└─────────────────────────────────────────┘
```

**合并规则：**
- 从 Layer 1 到 Layer 3 逐层覆盖
- Layer 3 可以放宽也可以收紧 Layer 1/2 的默认值
- 冲突时 Layer 3 优先（用户意图优先）
- 新仓库冷启动：Layer 2 为空，退回 Layer 1 + Layer 3
- 新用户冷启动：Layer 3 为空，退回 Layer 1 + Layer 2
- 全新冷启动（新用户 × 新仓库）：只有 Layer 1

**Layer 1 典型策略（出厂默认）：**

| 策略 | 默认值 |
|---|---|
| 合流文件冲突阈值 | > 3 个文件冲突则暂停 |
| 单任务最大连续 retry | 3 次 |
| reviewer 否决后最大返工轮次 | 2 轮，超过升级为决策点 |
| 暂停置信度阈值 | 建议置信度 < 0.7 时暂停 |
| 默认拆分粒度 | 单文件或单模块 |

**校准数据来源：**
- Decision Card 的 resolution 记录（用户接受/否决/修改了什么）
- Stage Trace 的 retry 和 latency 模式
- Promotion/Demotion 事件历史

---

### 6. Promotion / Demotion Loop

授权不是单向升级。系统必须能自我收敛。

**事件类型：**

| 事件 | 触发条件 | 效果 |
|---|---|---|
| `promotion` | 连续 K 次同维度自动决策被接受 | 该维度信任等级 +1 |
| `demotion` | 单次高风险误判或严重超预算 | 该维度信任等级 -1（或更多） |
| `hold` | 用户修改了建议但未否决 | 不升不降，记录偏差 |
| `recalibration` | 仓库特征显著变化（如大规模重构后） | 受影响维度重置为待校准 |

**字段：**

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识 |
| `trustProfileId` | 关联的 Trust Profile |
| `dimension` | 受影响的信任维度 |
| `event` | `promotion` / `demotion` / `hold` / `recalibration` |
| `trigger` | 触发原因（关联的 Decision Card ID / Task ID） |
| `previousLevel` | 变更前信任等级 |
| `newLevel` | 变更后信任等级 |
| `evidence` | 判定依据摘要 |
| `timestamp` | 发生时间 |

**不对称规则：**
- 升权需要连续成功（建议 K=5）
- 降权单次触发
- 降权后恢复到原等级需要 K×1.5 次连续成功
- 降权事件附带结构化原因，用户可在 Decision Card 中查看

---

## 结构化记录对象

六个一等公民之外，需要三类结构化记录支撑审计、度量和 policy 校准。

### Decision Record

每个自动决策一条。不是 log，是可查询的结构化对象。

```
{
  taskId, stage, timestamp,
  decision: "continue" | "pause" | "reject" | "split" | "retry" | "degrade" | "rollback",
  reason: "一句结构化理由",
  confidence: 0.0–1.0,
  policySource: "layer1:merge_threshold" | "layer2:repo_pattern" | "layer3:user_pref",
  outcome: null | "accepted" | "overridden" | "reverted"
}
```

### Stage Trace

每个任务阶段一条。

```
{
  taskId, stage, role, boundModel,
  startedAt, completedAt, wallTime,
  inputTokens, outputTokens, cost,
  retryCount,
  reviewerVerdict: null | "approved" | "rejected" | "conditionally_approved",
  rejectionReason: null | "结构化否决理由",
  userInterventionReason: null | "结构化介入理由",
  decisionCardIds: []
}
```

### Reconcile Record

每次合流一条。

```
{
  taskIds: [],
  conflictSurface: { files: [], functions: [], interfaces: [] },
  strategy: "auto_merge" | "sequential" | "user_decision",
  autoMergeConfidence: 0.0–1.0,
  resolution: "merged" | "sequentialized" | "user_resolved" | "rolled_back",
  rollbackPath: "commit SHA / patch ref",
  timestamp
}
```

---

## 核心指标体系

产品 KPI 应围绕托管可信度，而不是单轮回复质量。

| 指标 | 定义 | 意义 |
|---|---|---|
| 任务完成率 | 进入 executing 后最终到达 completed 的比率 | 基线能力 |
| 无谓打断率 | 用户直接接受建议的 Decision Card 占比 | 暂停精准度的反向指标 |
| 自动决策推翻率 | 用户 override 系统自动决策的比率 | 信任校准质量 |
| 返工回路长度 | reviewer reject → 重新 executing → 再次 reviewing 的平均轮次 | policy 严格度是否合理 |
| 用户注意力占用 | 用户在任务全程中同步参与的总时长 | 异步托管的核心效率指标 |
| 状态理解时间 | 用户回来后从 Decision Card Layer 1 到做出决策的中位时间 | 信息压缩质量 |
| 恢复成功率 | 进程重启/断网/中断后任务自动恢复的比率 | 运行时健壮性 |
| 并行冲突率 | 并行任务在 reconcile 阶段产生需人工介入的冲突比率 | 并行能力的实际可用度 |
| 从发起到可用结果的中位时间 | 用户提交任务到拿到可审计结果的墙钟时间 | 端到端效率 |

---

## 与现有架构的对接

本文档描述的是目标状态。与当前 shipped 架构的映射关系：

| 本文档概念 | 当前最近对应 | 差距 |
|---|---|---|
| Task Contract | Run + Session | Run 是单次执行，Task 是多阶段任务；需要在 Run 之上新增 Task 层 |
| Trust Profile | 不存在 | 全新对象 |
| Decision Card | Web Push 通知 + 前端暂停 UI | 当前是非结构化的，需要协议化 |
| Budget Governor | 不存在 | 全新对象 |
| Policy Stack | system-prompt.mjs 中的硬编码策略 | 需要从代码中抽取为可配置、可学习的层 |
| Promotion/Demotion | 不存在 | 全新对象 |
| Decision Record | 部分在 normalized events 中 | 需要独立出来作为结构化可查询对象 |
| Stage Trace | run status/spool | 需要在 run 基础上增加阶段粒度 |
| Reconcile Record | 不存在（无并行合流机制） | 全新能力 |

---

## 建设顺序建议

1. **定义 trace schema**：先把 Decision Record、Stage Trace、Reconcile Record 的结构定好，开始在现有 run 流程中埋点
2. **Trust Profile 冷启动**：在现有 session 流程中引入最保守的分级授权，积累校准数据
3. **Decision Card 协议化**：把当前的 push 通知和前端暂停 UI 统一成 Decision Card 语法
4. **Budget Governor**：在 run 启动时增加预估，运行中增加阈值检查
5. **Reconcile 显式化**：把 session fork 扩展为真正的并行 + 合流机制
6. **Policy Stack 抽取**：从硬编码策略迁移到三层可配置结构
7. **Promotion/Demotion**：基于积累的 Decision Record 数据实现自动升降权

---

## 相关文档

- `docs/project-architecture.md` — 当前 shipped 架构
- `notes/directional/product-vision.md` — 产品愿景
- `notes/directional/autonomous-execution.md` — 自主执行方向
- `notes/directional/app-centric-architecture.md` — App 作为 policy layer
- `notes/directional/super-individual-workbench.md` — 超级个体工作台定位
