# Autonomous Execution — 设计备忘

> 状态：P2（长期演进），已确认方向，尚未启动实现。
> 记录于 2026-03-06。
> 当前 shipped chat/runtime 基线请先看 `docs/project-architecture.md`。
> `notes/message-transport-architecture.md` 保留 transport/runtime 背景，这份文档继续只描述 autonomy 的更高层产品方向。

---

## 核心愿景

当前的交互模型是 **Request-Response**：用户发消息 → 模型回复 → 进程退出 → 等待下一条消息。

目标模型是 **Autonomous Agent**：模型回复后可以选择继续在后台执行，主动推送更新，等待事件触发后恢复行动。

## 关键能力

1. **后台持续执行**：一轮对话结束后，Agent 不退出，而是继续监控/执行
2. **主动推消息**：Agent 在后台发现结果后，向前端推送通知或消息
3. **事件驱动恢复**：Agent 可以"挂起"等待特定事件（文件变更、定时、webhook），事件触发后自动继续
4. **多 Session 并发**：多个 Session 各自独立地在后台运行

## 这与 App 的关系

**完全正交**。自主执行是会话级能力，不是 App 特有能力。普通对话和 App Session 都可以使用。

## 实现方向（草案）

- 需要一个 **Scheduler / Watcher 层**：管理后台运行的 Session
- 需要 **Event System**：定义什么触发 Session 恢复
- 需要 **Resource Management**：控制并发数、资源消耗
- 需要重新设计 **Process Lifecycle**：现在是 one-shot（spawn → exit），需要变成 long-lived 或 re-triggerable

## 不急的原因

- 当前的 request-response 模型已经能满足大部分场景
- 自主执行的技术复杂度高，需要仔细设计
- 先把 Identity + App 做扎实，再叠加自主执行能力

---

*本文档待 P2 阶段启动时展开细化。*
