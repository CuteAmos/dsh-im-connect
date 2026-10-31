/**
 * 与 fork 桥接契约保持结构一致的类型。这里直接 re-export fork 的定义，
 * 避免在本组件内复制一份（保持运行时对象结构兼容，且无编译期重复）。
 */
export type {
  ImConnectBridge,
  ImConnectBridgeAccount,
  ImConnectBridgeChatTarget,
} from '../bridge.js'
export type { ImMessage, InboundHandler } from '../engine/types.js'
