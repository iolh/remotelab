# RemoteLab Core Philosophy & Design Principles

> 形成于 2026-03-05。
> 本文档只保留稳定的产品哲学，不再重复实现细节、阶段性 TODO 或当前状态表。
> 当前 shipped 架构请看 `docs/project-architecture.md`。
> 当前 domain/refactor 基线请看 `notes/current/core-domain-contract.md`。

---

## 核心定位

RemoteLab 不是：

- 终端模拟器
- 手机版 IDE
- 普通聊天机器人

RemoteLab 是：

- 一个让人类远程指挥 AI worker 的控制台
- 一个把“AI 在真实电脑上工作”变成长期协作关系的产品
- 一个默认以单 Owner 为中心、通过 App 暴露能力的系统

---

## 稳定原则

### 1. Agent 默认拥有整台机器

Agent 不是被文件夹圈住的工具，而更像一个真正使用整台机器的人。

含义：

- 默认从 `~` 或真实 cwd 工作
- prompt / skills 是引导，不是伪沙箱
- 不把“选文件夹”当作产品核心抽象

### 2. Skills 是可复用的晶体智力

Skills 可以是：

- 可执行能力：脚本、命令、API 封装
- 知识能力：SOP、领域知识、经验规则

目标不是把所有能力硬编码进前端，而是让 agent 能按需发现和复用这些外部能力。

### 3. 隔离靠 metadata，不靠目录 UI

多会话的边界首先来自：

- session identity
- app context
- principal scope
- server-enforced permissions

`folder` / cwd 可以存在，但它是运行时细节，不是最深产品模型。

### 4. 前端要薄，工作流优先由 agent 驱动

浏览器首先是：

- 控制面
- 状态面
- 审批与快速输入面

能用对话、Skills、轻量结构化输出解决的，不先做成重 UI。

### 5. 单 Owner 是默认前提

RemoteLab 不是多租户 SaaS。

- Owner 是默认中心
- 非 Owner 访问通过 App scope 暴露
- 权限边界由 server 决定，不由模型决定

### 6. App 是 workflow packaging，而不是另一套产品物种

默认 owner chat 和被分享的 App，本质上都在表达“同一个 agent 在不同 policy 下工作”。

---

## 命名与边界

- 产品和路径命名优先使用 `remotelab`
- 终端 fallback plane 继续视为冻结安全网
- 无外部框架、Vanilla JS、三服务心智继续保持

---

## 什么时候看别的文档

- 想知道现在系统怎么实现：`docs/project-architecture.md`
- 想知道当前对象边界：`notes/current/core-domain-contract.md`
- 想知道长期产品方向：`notes/directional/product-vision.md`
- 想知道 App / provider / autonomy 的后续演进：看对应 directional notes
