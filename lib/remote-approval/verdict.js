import { isImSessionId as isStrictImSessionId } from '../engine/session-id.js';
/** 审批等待上限（秒），配置项 timeoutSecs 默认 300 秒。 */
export const DEFAULT_TIMEOUT_SECS = 300;
/**
 * 新旧两代前缀都算 IM 会话。委托 fork `session-id.ts` 的前缀判定，
 * 这里只补 `string | undefined` 判空，保持本组件调用处签名不变。
 */
export function isImSessionId(sessionId) {
    if (!sessionId)
        return false;
    return isStrictImSessionId(sessionId);
}
/** 解析审批回复；非审批词返回 undefined。沿用 fork `approvalVerdict` 的词汇。 */
export function approvalVerdict(text) {
    const value = text.trim().toLowerCase();
    if (['批准', '同意', 'yes', 'y', 'allow'].includes(value))
        return 'allow';
    if (['拒绝', '不同意', 'no', 'n', 'reject', 'deny'].includes(value))
        return 'reject';
    return undefined;
}
//# sourceMappingURL=verdict.js.map