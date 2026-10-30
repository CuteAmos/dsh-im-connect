import type { ChannelManager } from './manager.js';
import type { InboundHandler } from './engine/types.js';
/** 精简账号元信息；只含展示与路由所需字段，绝不携带 token / secret。 */
export interface ImConnectBridgeAccount {
    accountId: string;
    platform: string;
    name: string;
    connected: boolean;
}
/** 该账号历史绑定过的聊天目标（私聊 / 群），用于下游插件的目标下拉。 */
export interface ImConnectBridgeChatTarget {
    chatId: string;
    kind: 'dm' | 'group';
    title: string;
}
/**
 * dsh-remote-approval 等下游插件使用的桥接契约。
 *
 * 把 {@link ChannelManager} 已经具备的账号列表、主动发送与入站认领能力
 * 聚合成一个稳定公开面，下游只需 `inject: ['imConnect']` 即可拿到，无需
 * 触碰 manager 的私有字段，也不依赖管理页 HTTP 接口（内部实现、随时可变）。
 */
export interface ImConnectBridge {
    /** 账号列表（精简元信息，绝不吐 token/secret）。 */
    listAccounts(): ImConnectBridgeAccount[];
    /** 该账号历史绑定过的 chat 目标（含私聊/群、标题），用于目标下拉。 */
    listChatTargets(accountId: string): ImConnectBridgeChatTarget[];
    /** 主动推一条纯文本到指定 chatId；账号不存在/未连接/发送失败均抛错。 */
    send(accountId: string, chatId: string, text: string): Promise<void>;
    /**
     * 注册入站消息钩子。handler 返回 true = 认领，im-connect 不再按正常
     * 流程处理（不 decideAccess、不注入新任务）；false = 未认领，继续原流程。
     * 返回 disposer。
     */
    onInbound(handler: InboundHandler): () => void;
}
/** {@link ImConnectBridge} 的默认实现，聚合一个 {@link ChannelManager} 的公开能力。 */
export declare class ImConnectBridgeService implements ImConnectBridge {
    private readonly manager;
    constructor(manager: ChannelManager);
    listAccounts(): ImConnectBridgeAccount[];
    listChatTargets(accountId: string): ImConnectBridgeChatTarget[];
    send(accountId: string, chatId: string, text: string): Promise<void>;
    onInbound(handler: InboundHandler): () => void;
}
//# sourceMappingURL=bridge.d.ts.map