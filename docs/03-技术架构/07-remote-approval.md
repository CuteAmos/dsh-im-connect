# dsh-remote-approval 设计文档

更新时间：2026-11-01（Asia/Shanghai）

> PC 端 DeepSeek Harness 跑任务遇到人工审批 / 引导提问时，把审批卡与问题推送到 IM（微信 / QQ / 飞书等），并在 IM 上完成审批与回答。
> 最终方案：fork `dsh-im-connect` 暴露桥接能力（bridge service），并把「远程审批」作为 `dsh-im-connect` 包内的一个**可开关组件**（子插件 `@michengai/dsh-im-connect/remote-approval`）实现——不是独立安装的瘦客户端插件。

---

## 1. 背景与目标

| 项 | 内容 |
|---|---|
| 触发场景 | PC 端 Web UI 发起的任务，在运行中遇到 ① 工具越权人工审批（`approval/request`）② 引导式提问（`ask_user_question` → `user-questions/request`） |
| 完成方式 | 在 IM 上推送审批卡 / 问题，用户回复，插件把结果回传宿主，任务继续 |
| IM 账号来源 | 复用 `dsh-im-connect` 已配置的机器人账号（飞书 / 微信 / QQ / 钉钉 / 企微 / Telegram / Discord / Slack 等） |
| 范围 | 个人使用、单账号路由、单目标 chatId |
| 回复协议 | 沿用 `dsh-im-connect` 现有词汇（见 §6） |
| 附加需求 | 绑定完成后提供「测试连接」按钮，验证能准确推送审批 / 提问信息（见 §5.6） |
| 交付形态 | 并入 fork `dsh-im-connect` 作为其「包含的组件」第二行「远程审批」，独立开关控制启停 |

---

## 2. 现状结论（已勘察）

1. **DSH 不需要发明远程通道**。`approval/request` 与 `user-questions/request` 都是 `waterfall` 型事件，通过 `ctx.waterfall(...)` 分发，谁先返回谁 resolve；缺 answerer 时 fail-closed（`unavailable` / reject）。
2. **`dsh-im-connect` 已经是完整 answerer**，但它 `prepend` 注册了两条监听器，且首行 `if (!sessionId || !bindingForSession(sessionId)) return next()` —— **只接管「IM 发起的会话」**。
3. **Web 发起的会话没有 IM 绑定** → `bindingForSession` 返回 undefined → im-connect `next()` 放行 → 落在下一个监听器上。
4. **结论**：本组件 = 写一个「新的 answerer 监听器」，对 Web 会话推 IM 并与 PC 端审批卡并存竞争（见 §5.3 / §5.4）。不碰 DSH 核心。
5. im-connect 的账号列表（`store.channels`）、发送能力（`running: Map<accountId, ChannelAdapter>` 的 `adapter.send(chatId, text)`）、历史绑定（`SessionMapStore`）都已存在，但都是**类私有字段**，未对外暴露 —— 这正是 fork 要补的部分。

---

## 3. 总体架构

```
┌─ fork: dsh-im-connect（@michengai/dsh-im-connect）──────────────────┐
│  ImConnectBridge service（ctx.provide('imConnect', ...)）            │
│    listAccounts(): 精简账号列表（不含凭据）                           │
│    listChatTargets(accountId): 该账号历史绑定过的 chatId              │
│    send(accountId, chatId, text): 主动推送                           │
│    onInbound(handler): 入站消息外部认领钩子（授权判定前）              │
│                                                                      │
│  ┌─ 组件 1: im-connect（原 IM 接入，原有审批逻辑不变）                │
│  └─ 组件 2: remote-approval（子插件，inject:['imConnect','webServer']）│
│       · on('approval/request', …)       // prepend + global         │
│       · on('user-questions/request', …) // prepend + global         │
│       · pending 表（correlation）                                    │
│       · Config: enabled / timeoutSecs（组件开关 = enabled）           │
│       · 管理 UI：IM 助理页底部 账号/目标下拉 + 测试连接                │
└──────────────────────────────────────────────────────────────────────┘
```

**监听器顺序（关键）**：im-connect 用 `{global:true, prepend:true}` 注册，本组件同样用 `{global:true, prepend:true}` 注册（后注册者排更前）。效果：
- IM 发起的会话 → 本组件按 `isImSessionId` 判定后 `next()` 交还 im-connect，由 im-connect 走原有审批流程；
- Web 发起的会话 → 本组件接管，先推 IM，再 `next()` 放行让 PC 端审批卡也弹出，二者 `Promise.race`（见 §5.3 / §5.4）。

因此本组件**不需要**自己维护 router/binding，只需用 `isImSessionId` 区分会话归属。

---

## 4. 组件一：fork `dsh-im-connect`

### 4.1 暴露的 bridge API

```ts
export interface ImConnectBridge {
  /** 账号列表（精简元信息，绝不吐 token/secret） */
  listAccounts(): Array<{ accountId: string; platform: string; name: string; connected: boolean }>

  /** 该账号历史绑定过的 chat 目标（含私聊/群、标题），用于目标下拉 */
  listChatTargets(accountId: string): Array<{ chatId: string; kind: 'dm' | 'group'; title: string }>

  /** 主动推一条纯文本到指定 chatId；账号不存在/未连接/发送失败均抛错 */
  send(accountId: string, chatId: string, text: string): Promise<void>

  /**
   * 注册入站消息钩子。handler 返回 true = 本组件认领，im-connect 不再按
   * 正常流程处理（不 decideAccess、不注入新任务）；false = 未认领，继续原流程。
   * 返回 disposer。
   */
  onInbound(handler: (accountId: string, msg: ImMessage) => boolean | Promise<boolean>): () => void
}
```

### 4.2 实现落点（精确到文件 / 函数）

| 改动 | 文件 | 做法 |
|---|---|---|
| 新增 bridge 类 / 接口 | `src/bridge.ts`（新文件） | 持有 `ChannelManager` 引用，聚合其私有字段 |
| `listAccounts()` | `src/bridge.ts` | 遍历 `manager.store.channels` + `manager.running`，映射为精简对象 |
| `listChatTargets(accountId)` | `src/bridge.ts` | 过滤 `manager.sessions.list()`（`SessionMapStore`）中 `record.channel === accountId` 的记录，去重后返回 `{chatId, kind, title}` |
| `send(accountId, chatId, text)` | `src/bridge.ts` | `const adapter = manager.running.get(accountId); if (!adapter) throw ...; await adapter.send(chatId, text)` |
| 入站认领钩子存储 | `src/engine/gateway.ts` | `ImEngine` 加 `private readonly inboundHandlers = new Set<(accountId, msg) => ...>()`，暴露 `addInboundHandler/removeInboundHandler` |
| 钩子触发点 | `src/engine/gateway.ts` 的 `handleInbound` | 在 seen 去重**之后**、`decideAccess` **之前**插入：`for (const h of this.inboundHandlers) if (await h(channelId, msg)) return` |
| 把 bridge 组装进 manager | `src/manager.ts` | `ChannelManager` 加 `get bridge()` 或构造时 `new ImConnectBridge(this)` |
| 注册为 service | `src/index.ts` 的 `apply` | `ctx.provide('imConnect', bridge)` |

> `handleInbound` 里 `channelId` 即 accountId（`register()` 时 `channels.set(channel.id, ...)` 且 factory 中 `adapter.id = accountId`），所以外部 handler 收到的第一个参数就是 accountId，无需额外映射。

### 4.3 钩子放在授权判定之前的原因

纯推送场景下，用户可能是**第一次**回复机器人（从未私聊、不在 allowlist）。若按 im-connect 原逻辑，`decideAccess` 会把它判成 `deny/ignore` 而吞掉。让外部 handler 先跑，本组件就能用自己的判据决定「这条回复是否对应我 pending 的审批/提问」，从而避免漏收。

### 4.4 最小侵入 / 维护策略

- bridge 全部新增在独立文件，`gateway.ts` 只加一个字段 + 3 行钩子循环，`manager.ts`/`index.ts` 各加一两处组装，merge 冲突面最小。
- 建议同时给上游提 PR，争取合回主线后本组件可无 fork 运行；合回前个人用 fork。

---

## 5. 组件二：`remote-approval`（`@michengai/dsh-im-connect/remote-approval`）

组件二不再作为独立插件发布，而是并入 fork `dsh-im-connect`，作为其 `cordis.patch.yml` 里 `insert` 的第二条 entry（`id: remote-approval`），在宿主「插件」页「包含的组件」列表里显示为第二行「远程审批」，该行开关即控制整个组件的 fiber enable/disable（= 移动端审批是否开启，也控制 IM 助理页配置区是否显示）。

### 5.1 注入与监听器

```ts
export const name = '@michengai/dsh-im-connect/remote-approval'
export const inject = ['imConnect', 'webServer']   // 均硬依赖

// apply 内通过 setupRemoteApproval 注册：
ctx.on('approval/request', (req, next) => handleApproval(req, next, deps), { prepend: true, global: true })
ctx.on('user-questions/request', (req, next) => handleUserQuestions(req, next, deps), { prepend: true, global: true })
```

> `webServer` 必须是硬依赖：`registerApi` 里以 `ctx.webServer` 属性访问，Cordis 对未在 inject 声明的 service 属性访问会抛 `cannot get property "webServer" without inject`。

### 5.2 pending 表（correlation 核心）

审批与提问各用一张独立 pending 表，均以 `chatId` 为 key（单账号路由）：

- `PendingTable`（审批）：`waitApproval(chatId, accountId, timeoutMs, signal?)` / `accountIdOf` / `activate` / `isReady` / `answer(chatId, allow)` / `cancel` / `dispose`；超时 settle `'timeout'`、signal abort settle `undefined`。
- `QuestionPending`（提问）：`begin(chatId, accountId, questions, timeoutMs, signal?)` / `accountIdOf` / `activate` / `isReady` / `current` / `answer` / `cancel` / `dispose`；多问题逐题推进，额外带与审批一致的超时。

回复回流：IM 回复 → fork `onInbound` 回调本组件 handler（先判 `approvalVerdict` 命中则归审批、否则归提问）→ 用 `msg.chatId`（单账号直接比对）+ `accountId` 匹配 pending → 解析词汇 → `resolve(...)` → 返回 `true` 认领。

### 5.3 审批流程（PC 与 IM 并存）

1. `handleApproval(req, next, deps)` 被调；`req.signal?.aborted` → `cancelled`。
2. `isImSessionId(sessionId)` 为真（IM 发起会话）→ `return next()` 交还 im-connect（不重复推给同一聊天）。
3. 读绑定；`disabled` 或未配 `accountId/chatId` → `return next()`（回退 Web 卡 / fail-closed）。
4. 拼审批卡文本（工具名、reason 等），`await imConnect.send(accountId, chatId, 卡片)`；发送失败 → cancel + `refused`。
5. 建 pending Promise 并 `activate`（阻塞等待 IM 回复）；同时 `signal.addEventListener('abort', …)`。
6. **PC 与 IM 并存 race**：
   - `pc = next()`（经过 api-remotes → Web 审批卡）：有消费者则挂起等 PC 决，无消费者 settle `'unavailable'`（视为 PC 弃权）；
   - `im = wait`（用户回「批准/拒绝」或超时）；
   - `Promise.race([pc, im])`：
     - PC 先决 → 释放 IM 等待（`pending.cancel`）+ 推送「已在 PC 端完成审批」→ 返回 PC 结果；
     - IM 先决（`allow`/`reject`）→ 直接返回 IM 结果（PC 卡若仍挂着则短暂残留、点击无效但无副作用）；
     - IM 超时 / 取消（非真实决策）→ 继续等 PC；PC 也弃权则按超时 `cancelled`。
7. 超时（`timeoutSecs`，默认 300）→ `announceTimeout` 推超时通知 + `cancelled`。

**返回契约**（镜像 im-connect `handleApproval`，兼容新旧两种 Host）：

```ts
const currentContract = req.agent !== undefined
const refused  = currentContract ? 'rejected'  : { behavior: 'reject' }
const cancelled = currentContract ? 'cancelled' : { behavior: 'reject' }
// verdict==='allow'  → currentContract ? 'allowed-once' : { behavior: 'allow' }
// verdict==='reject' → refused
// 其余（timeout/abort）→ cancelled
```

### 5.4 提问流程（PC 与 IM 并存）

1. `handleUserQuestions(req, next, deps)` 被调；校验 `Array.isArray(req.questions) && req.questions.every(validUserQuestion)`，不合法 `throw`。
2. `signal.aborted` → `throw req.signal.reason`。
3. `isImSessionId(sessionId)` 为真 → `return next()` 交还 im-connect。
4. 未绑定 → `return next()`。
5. 逐题：`formatUserQuestion(q, index, total, ...)` 拼文本 → `send` → `activate` → 等回复 → `answerUserQuestion(q, text)` 得 `UserQuestionAnswerItem`。
6. **PC 与 IM 并存 race**（同审批）：
   - `pc = next()`：PC 无提问卡消费者时 reject `NO_PROVIDER`（视为弃权）；
   - `im = wait`：IM 回复或超时 / abort；
   - PC 先决 → cancel IM + 推「已在 PC 端完成回答」+ 返回 PC 结果；IM 先决 → 直接返回；IM 超时 / abort（非真实答案）→ 继续等 PC，PC 也弃权则抛 AbortError。
7. 多问题推进 `index`，全部答完 `resolve({ answers })`。

> `validUserQuestion` / `formatUserQuestion` / `answerUserQuestion` 三个纯函数直接从 fork 的 `src/engine/question.ts` 复用（同一套解析，保证协议一致）。

### 5.5 配置与状态

| 层 | 项 | 说明 |
|---|---|---|
| 组件自身静态 Config（schemastery） | `enabled: boolean`（默认 true）<br>`timeoutSecs: number`（默认 300） | 稳定、可热更；组件列表里的开关切换的就是同一个 `enabled` |
| 组件自持久化 state | `accountId: string`<br>`chatId: string` | 账号与目标是**动态**数据，走自有 state 文件 `%DSH_HOME%\dsh-remote-approval\state.json` |

**配置入口**：不在 bundle 配置卡（`plugins.bundle.config`）里，而是并入 fork 已有的 **IM 助理设置页**（`settings.section` 槽位，`SettingsPage`）底部——新增「远程审批」区块，含推送账号下拉（带渠道名）、推送目标（chatId）下拉、测试连接按钮。组件关闭时该区块不显示控件，改为提示「远程审批组件未开启」。

**说明**：账号下拉（来自 `listAccounts`）与目标下拉（来自 `listChatTargets`）是运行时动态数据，DSH 的 schemastery 静态 `Config` 无法原生渲染成动态下拉；因此运行时绑定走自持久化 state + 管理 UI。管理 API 复用 fork 的 `webServer` 鉴权前缀（`/api/michengai/dsh-im-connect/remote-approval/*`，认证走 `connection.requestRejection`），由组件自己的 `registerApi` 注册，`setupRemoteApproval` 持有其注销器并在组件关闭时 `dispose()`，避免二次开启时 `duplicate prefix route`。

### 5.6 测试连接（本阶段新增需求）

IM 助理设置页「远程审批」区块的「测试连接」按钮 → 走组件自己的 `webServer` 鉴权 API（前缀 `/api/michengai/dsh-im-connect/remote-approval/test`，认证走 `connection.requestRejection`），执行以下校验并返回结果：

1. **账号连通性**：`imConnect.listAccounts()` 中找 `accountId`；不存在或 `connected !== true` → 报「账号未配置 / 未连接」。
2. **目标有效性**：`chatId` 非空；可选：在 `listChatTargets(accountId)` 中命中以提示「已绑定」。
3. **推送测试**：
   - `send(accountId, chatId, 测试审批卡文本)` —— 一条带「【测试】」前缀的样例审批卡（含工具名、批准/拒绝引导）；
   - `send(accountId, chatId, 测试提问文本)` —— 一条样例提问（含编号选项）。
4. 返回 `{ ok, accountId, chatId, approvalPushed, questionPushed, error?, warnings? }`，UI 显示成功 / 失败与原因。

> 一轮测试对审批、提问两种消息各推一条，直接验证「能准确推送审批或提问信息」。**端到端往返测试**（推送后等真实回复，验证 correlation）作为 v1.1 可选增强，v1 不做。

---

## 6. 回复文本协议（沿用 im-connect）

**审批**（`approvalVerdict`）：
- 批准：`批准` / `同意` / `yes` / `y` / `allow`
- 拒绝：`拒绝` / `不同意` / `no` / `n` / `reject` / `deny`
- 其它 / 超时 → 取消（cancelled）

**提问**（`answerUserQuestion`）：
- 无选项 → 整条文本作为 `custom`
- 单选 → 回复选项序号（`1/2/3…`）或选项 label 命中；否则文本作 `custom`
- 多选 → 按 `, ， 、 ; ；` / 换行切分，label 命中进 `selected`、其余进 `custom`（用 `、` 连接）

---

## 7. 数据流时序（审批为例）

```
PC Web 任务 ──approval/request──▶ remote-approval(prepend, 最前)
                                      │ isImSessionId? ──是──▶ next() 交还 im-connect
                                      │ 否
                                      │ send(accountId, chatId, 审批卡) ──▶ IM 机器人 ──▶ 用户手机
                                      │ next()（放行 PC 卡）
                                      ▼
                              Promise.race([pc, im]) ── 任一方先决 ──▶ 宿主审批 seam ──▶ 任务继续

IM 回复「批准」──▶ fork ImEngine.handleInbound（seen 去重后、decideAccess 前）
                      │ 遍历 inboundHandlers
                      ▼
              本组件 handler：chatId 匹配 pending → 解析「批准」→ resolve('allowed-once') → return true（认领）
```

---

## 8. 目录结构

```
dsh-remote-approval/                  ← 主仓库（本目录，含 fork clone）
├── DESIGN.md                         ← 本设计文档
└── dsh-im-connect/                   ← fork（git remote 指向 MichengAI/dsh-im-connect）
    ├── cordis.patch.yml              ← insert 两个组件：im-connect + remote-approval
    ├── package.json                  ← exports 增加 ./remote-approval 及其 locale
    ├── locale/remote-approval/       ← 子组件 meta（en.json / zh.json）
    ├── client.js                     ← IM 助理设置页底部的「远程审批」配置区块
    ├── src/
    │   ├── bridge.ts                 ← 新增 bridge service（ctx.provide('imConnect')）
    │   ├── engine/gateway.ts         ← 入站认领钩子（decideAccess 之前）
    │   └── remote-approval/          ← 组件二（独立 cordis 子插件）
    │       ├── index.ts              ← name/inject/Config/apply + setupRemoteApproval
    │       ├── approval.ts           ← 审批 answerer（PC/IM 并存 race）+ 卡片文本
    │       ├── question-handler.ts   ← 提问 answerer（PC/IM 并存 race）
    │       ├── question.ts           ← QuestionPending + 复用 fork 纯函数
    │       ├── pending.ts            ← PendingTable（审批 correlation）
    │       ├── inbound.ts            ← 入站回复认领（approval / question 分流）
    │       ├── config.ts             ← 自持久化 state 读写
    │       ├── test.ts               ← 测试连接逻辑
    │       ├── api.ts                ← webServer 管理 API（/remote-approval/*）
    │       ├── types.ts              ← re-export fork bridge 类型
    │       └── verdict.ts            ← approvalVerdict / isImSessionId 包装
    └── tests/remote-approval-*.test.mjs   ← 组件单测（10 个）
```

> `packages/dsh-remote-approval/`（早期独立插件）已删除；功能全部并入 `src/remote-approval/`。

---

## 9. 开发里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 | fork 建仓 + 加 bridge（`listAccounts`/`send`/`onInbound`/`listChatTargets`）+ 单测 | bridge 能在宿主中 `ctx.get('imConnect')` 拿到并 `send` 成功 |
| M1 | 组件骨架：监听器注册 + pending + 审批端到端 | Web 任务触发审批 → 推 IM → 回「批准」→ 任务继续 |
| M2 | 提问端到端（单选 + 纯文本，复用 fork 纯函数） | 提问推 IM → 回复 → 答案回传宿主 |
| M3 | 管理 UI + 测试连接按钮 | IM 助理页能选账号/目标、点测试连接收到两条测试消息 |
| M4 | 超时 / abort / 降级、日志 | 异常路径不挂死 |
| M5 | 并入 fork 作可开关组件（cordis 子插件 + 组件行开关 + 配置入口迁 IM 助理页 + PC/IM 并存 race） | 插件管理「包含的组件」显示第二行「远程审批」，开关控启停；PC 与 IM 并存、任一方先决 |

---

## 10. 风险与待验证点

| 风险 / 待验证 | 说明 | 应对 |
|---|---|---|
| PC 卡残留 | 本组件与内置 `dsh-client-ui-approval` 的 waterfall 顺序需实测 | 实测：IM 先决时 PC 卡会短暂残留（点击无效但无副作用），已接受此瑕疵 |
| inject 依赖环 | `inject:['imConnect','webServer']` 要求 fork 与 webServer 已就绪 | 两者均为硬依赖；未就绪时 fiber 不激活，不破坏 im-connect 原有功能 |
| schemastery 动态下拉 | 账号/目标动态列表能否进原生配置页 | 已定：自持久化 state + 并入 IM 助理设置页的管理 UI |
| 群聊安全 | 推群里时回复需校验 sender | 个人使用先私聊；群聊校验（`msg.userId`）留二期 |
| fork 维护 | 需跟上游 merge | bridge 最小侵入；同时提 PR 争取合回主线 |
| 管理 UI 托管方式 | im-connect 的浏览器页面如何由 webServer 托管 | 已落地：复用 fork `webServer` 前缀 + 组件自己的 registerApi（可注销） |
