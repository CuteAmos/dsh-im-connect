/** {@link ImConnectBridge} 的默认实现，聚合一个 {@link ChannelManager} 的公开能力。 */
export class ImConnectBridgeService {
    manager;
    constructor(manager) {
        this.manager = manager;
    }
    listAccounts() {
        const accounts = [];
        for (const view of this.manager.list()) {
            for (const account of view.accounts) {
                accounts.push({
                    accountId: account.id,
                    platform: account.platform,
                    name: account.name,
                    connected: account.connected,
                });
            }
        }
        return accounts;
    }
    listChatTargets(accountId) {
        const targets = [];
        const seen = new Set();
        for (const group of this.manager.channelSessions()) {
            for (const record of group.sessions) {
                if (record.channel !== accountId)
                    continue;
                const key = `${record.kind}:${record.chatId}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                targets.push({ chatId: record.chatId, kind: record.kind, title: record.title });
            }
        }
        return targets;
    }
    async send(accountId, chatId, text) {
        await this.manager.sendMessage(accountId, chatId, text);
    }
    onInbound(handler) {
        return this.manager.addInboundHandler(handler);
    }
}
//# sourceMappingURL=bridge.js.map