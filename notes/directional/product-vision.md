# RemoteLab Product Vision

_Last updated: 2026-03-10_

> 状态：产品判断与开放问题记录。
> 当前 shipped 架构请看 `docs/project-architecture.md`。
> 当前 domain/refactor 基线请看 `notes/current/core-domain-contract.md`。

---

## 核心判断

RemoteLab 不是“远程和模型聊天”的工具。

它更像：

- 一个管理 AI 工人的控制台
- 一个把长期机器上下文交给 AI 的协作系统
- 一个让用户从“亲自操作的人”变成“发目标、做判断的人”的产品

它的真正价值，不只是远程访问，而是：

- AI 有一台真实、长期存在的机器
- 任务、经验和中间产物可以沉淀
- 后续工作会越来越依赖这份持续存在的上下文

---

## 当前最值得解决的问题

### 1. 并发 Session 的认知负担

用户当前最大的成本，不是发消息，而是记住：

- 每个 session 在做什么
- 哪些 session 卡住了
- 哪些 session 需要自己决策
- 各 session 之间有没有依赖

所以产品重点不是“把单轮对话做得更花”，而是**让用户能管理更多并发工作，同时脑子里装更少状态**。

### 2. 明确移动端角色

移动端应该优先承担：

- 查看全局状态
- 快速确认/审批
- 发短指令
- 跳到需要自己介入的 session

它不一定要变成完整工作台，更不应该先按“手机版 IDE”设计。

### 3. 输出要优先服务决策，而不是堆细节

长输出不是问题本身。

真正的问题是：用户经常只想先知道：

- 现在需不需要我决定什么？
- 这轮到底做成了什么？
- 有没有 blocker？

所以后续 UI/后处理应该优先突出：

- decision
- summary
- blocker / next action
- details on demand

### 4. App 的价值是“已验证 workflow 的包装”

App 不只是 prompt 分享。

更准确地说，它是：

- 一套已经在真实机器上验证过的 workflow
- 一套可复用、可分享的 agent SOP
- RemoteLab 作为“能力分发工具”的自然载体

### 5. 增长关键是反馈密度，不是先做商业包装

当前阶段更重要的是：

- 更多真实案例
- 更多可分享 workflow
- 更高密度的外部反馈
- 更快的产品学习速度

这比过早堆商业包装、团队抽象或复杂云架构更重要。

---

## 当前产品下注

目前最值得继续加注的方向是：

- `Session` 继续作为核心产品单位
- sidebar / progress 继续承担“卸载用户记忆”的职责
- App 继续向 reusable policy / workflow package 发展
- 不把“多 bot 团队”当默认产品抽象
- 不把移动端强行做成重交互工作台

---

## 仍然开放的问题

这些问题值得继续观察，但不必现在提前定死：

- 移动端真实使用分布到底是什么？
- 分层输出何时值得进入主线？
- session metadata 里哪些字段值得长期暴露给 agent 写？
- App 的 share / onboarding / guided UI 应该做到什么程度？
- 哪些反馈机制最能提高外部案例密度？

---

## 相关方向文档

- `notes/directional/app-centric-architecture.md` — App 作为通用 policy layer 的方向
- `notes/directional/super-individual-workbench.md` — 对“AI 超级个体工作台”表述的 sharpened 版本，明确 control plane、优先级和反目标
- `notes/directional/ai-driven-interaction.md` — AI 主动发起与 deferred triggers
- `notes/directional/provider-architecture.md` — provider/model 开放化
