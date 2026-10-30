/**
 * 与 fork `@michengai/dsh-im-connect` 导出的 bridge 契约保持结构一致的类型。
 *
 * 这里不 import fork 包，避免在插件包内引入对 fork 的编译期依赖；
 * 运行时拿到的对象就是 fork 的 `ImConnectBridgeService` 实例，结构兼容即可。
 */

/** 精简账号元信息；只含展示与路由所需字段。 */
export interface ImConnectBridgeAccount {
  accountId: string
  platform: string
  name: string
  connected: boolean
}

/** 该账号历史绑定过的聊天目标（私聊 / 群）。 */
export interface ImConnectBridgeChatTarget {
  chatId: string
  kind: 'dm' | 'group'
  title: string
}

/** 入站消息；只保留本插件认领时用到的字段。 */
export interface ImMessage {
  chatId: string
  userId?: string
  username?: string
  text: string
  kind?: 'dm' | 'group'
  addressed?: boolean
  messageId?: string
  media?: unknown[]
}

/** 外部插件注册的入站消息认领钩子：返回 true 表示认领。 */
export type InboundHandler = (accountId: string, msg: ImMessage) => boolean | Promise<boolean>

/** fork 暴露给下游插件的桥接服务。 */
export interface ImConnectBridge {
  listAccounts(): ImConnectBridgeAccount[]
  listChatTargets(accountId: string): ImConnectBridgeChatTarget[]
  send(accountId: string, chatId: string, text: string): Promise<void>
  onInbound(handler: InboundHandler): () => void
}
