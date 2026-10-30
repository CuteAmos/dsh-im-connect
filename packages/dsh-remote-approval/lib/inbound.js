import { approvalVerdict } from './verdict.js';
/**
 * 把入站消息认领钩子挂到 fork 的 `onInbound`，返回注销函数。
 * 命中本插件 pending 的审批回复时返回 true（短路 im-connect 正常流程），
 * 否则返回 false（继续原流程）。单账号路由下用 chatId 匹配即可。
 */
export function installInbound(deps) {
    return deps.bridge.onInbound(async (accountId, msg) => {
        const binding = deps.readBinding();
        if (!binding.chatId || msg.chatId !== binding.chatId)
            return false;
        if (accountId !== binding.accountId)
            return false;
        if (msg.media && msg.media.length > 0)
            return false;
        const verdict = approvalVerdict(msg.text);
        if (verdict === undefined)
            return false;
        if (deps.pending.accountIdOf(msg.chatId) !== binding.accountId)
            return false;
        if (!deps.pending.isReady(msg.chatId))
            return false;
        if (deps.pending.answer(msg.chatId, verdict === 'allow')) {
            deps.log(`[inbound] 认领审批回复 ${verdict}（chatId=${msg.chatId}）`);
            return true;
        }
        return false;
    });
}
//# sourceMappingURL=inbound.js.map