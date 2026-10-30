# imConnect bridge 服务

更新时间：2026-10-30（Asia/Shanghai）

## 1. 模块职责

`imConnect` 是 `dsh-im-connect` 对外暴露的桥接服务（Cordis service）。它把本插件已经具备、但此前只有类私有字段 / 管理页 HTTP 接口才能触达的三类能力，聚合成一个稳定的进程内契约，供下游插件（如 `dsh-remote-approval`）通过 `inject: ['imConnect']` 直接复用：

- 账号列表（不含凭据）
- 该账号历史绑定过的聊天目标（chatId）
- 主动向指定 chatId 推送纯文本
- 入站消息的外部认领钩子（在授权判定之前执行）

**不做的事**：不解析 IM 会话归属、不自己维护 pending / correlation、不渲染配置 UI。这些是下游插件（answerer）的职责。

## 2. 关键接口契约

服务名：`imConnect`（`ctx.provide('imConnect', bridge)` 注册，见 `src/index.ts`）。

```ts
export interface ImConnectBridge {
  listAccounts(): ImConnectBridgeAccount[]
  listChatTargets(accountId: string): ImConnectBridgeChatTarget[]
  send(accountId: string, chatId: string, text: string): Promise<void>
  onInbound(handler: InboundHandler): () => void
}

export interface ImConnectBridgeAccount {
  accountId: string
  platform: string
  name: string
  connected: boolean
}

export interface ImConnectBridgeChatTarget {
  chatId: string
  kind: 'dm' | 'group'
  title: string
}

export type InboundHandler = (accountId: string, msg: ImMessage) => boolean | Promise<boolean>
```

### 2.1 `listAccounts()`

返回精简账号元信息。数据源是 `ChannelManager.list()`（已聚合 `store.channels` 与 `running` 中的适配器状态），`connected` 只在该账号适配器 `status()` 归一化为 `connected` 时为 `true`。**绝不包含 token / secret**。

### 2.2 `listChatTargets(accountId)`

返回该账号历史绑定过的 chatId（含私聊 / 群，附带标题），按 `kind:chatId` 去重。数据源是 `SessionMapStore`（`sessions.json`）。用于下游的目标下拉。无历史绑定时返回空数组。

### 2.3 `send(accountId, chatId, text)`

主动推一条纯文本。委托 `ChannelManager.sendMessage` → `running.get(accountId).send(chatId, text)`。账号未连接或不存在、或渠道 `send` 失败时抛错，由调用方决定如何提示。**不做分片**：调用方如需超长文本应自行切分（渠道 `maxMessageLength` 未在本契约暴露，后续需要时再补）。

### 2.4 `onInbound(handler)`

注册入站消息认领钩子，返回注销函数。钩子在 `ImEngine.handleInbound` 的 **seen 去重之后、`decideAccess`（授权判定）之前** 按注册顺序执行，任一返回 `true` 即短路，本引擎不再处理该消息（不 decideAccess、不注入新任务）；返回 `false` 则继续原流程。

> 放在授权判定之前是刻意为之：纯推送场景下用户可能是第一次回复机器人（未私聊、不在 allowlist），若按原逻辑会被 `decideAccess` 判成 deny/ignore 而吞掉。让外部 handler 先跑，下游才能用自己的判据决定「这条回复是否对应我 pending 的审批 / 提问」。

## 3. 实现落点

| 文件 | 改动 |
|---|---|
| `src/bridge.ts` | 新增 `ImConnectBridge` / `ImConnectBridgeAccount` / `ImConnectBridgeChatTarget` 类型与 `ImConnectBridgeService` 实现 |
| `src/engine/types.ts` | 新增 `InboundHandler` 类型 |
| `src/engine/gateway.ts` | `ImEngine` 新增 `inboundHandlers: Set<InboundHandler>` 字段、`addInboundHandler()` 方法；`handleInbound` 在去重后插入钩子循环；`dispose()` 清空钩子 |
| `src/manager.ts` | 新增公开方法 `sendMessage(accountId, chatId, text)` 与 `addInboundHandler(handler)`，聚合私有字段 `running` / `engine` |
| `src/index.ts` | `apply` 中 `ctx.provide('imConnect', new ImConnectBridgeService(manager))`；导出 bridge 类型 |

与设计文档 §4.2 的两处实现偏差（以项目代码事实为准）：

1. `listAccounts()` 未直接遍历 `store.channels` + `running`，而是复用 `manager.list()`——它已经在 `accountView()` 里完成同样的聚合与 `connected` 判定，比另起一遍更少侵入、语义一致。
2. bridge 不在 `ChannelManager` 构造时组装，而在 `index.ts` 的 `apply` 里 `new ImConnectBridgeService(manager)` 组装——bridge 属于插件级装配而非 manager 职责，且避免 `manager.ts` 反向依赖 `bridge.ts`。

## 4. 接入说明

下游插件（独立 DSH 插件）：

```ts
export const name = 'dsh-remote-approval'
export const inject = ['imConnect']

export function apply(ctx: Context) {
  const imConnect = ctx.get('imConnect') as ImConnectBridge
  // 监听器注册（普通顺序，不 prepend）见设计文档 §5.1
}
```

- 未安装本 fork（`imConnect` service 未提供）时，`inject: ['imConnect']` 会导致插件无法激活；下游应做降级提示（见设计文档 §10）。
- `inject` 声明与 `ctx.get('imConnect')` 取用是 Cordis 标准机制，类型从 `@michengai/dsh-im-connect` 的导出 `ImConnectBridge` 引入。

## 5. 测试 / 验收

- 单测：`tests/bridge.test.mjs`（5 项），覆盖 `listAccounts`（含凭据不泄露、connected 判定）、`listChatTargets`（按账号过滤 + chatId 去重）、`send`（未连接抛错 / 委托 adapter）、`onInbound`（授权判定前执行、返回 true 短路、注销）。
- 全量：`npm test`（1281 通过，0 失败；另 `npm run build` 先行）。
- 手动验收（M0）：在宿主中确认 `ctx.get('imConnect')` 可拿到实例，`listAccounts()` 返回已配账号，`send(accountId, chatId, '测试')` 在对应 IM 上收到消息。

## 6. 变更历史

- 2026-10-30：新增 bridge 服务（`listAccounts` / `listChatTargets` / `send` / `onInbound`），随 `dsh-remote-approval` 项目 M0 落地。
