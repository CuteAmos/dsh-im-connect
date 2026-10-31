/** 审批等待上限（毫秒），与 fork 的 APPROVAL_WAIT_MS 对齐；配置项 timeoutSecs 默认 300 秒。 */
export const DEFAULT_TIMEOUT_SECS = 300;
/** IM 会话 id 前缀，与 fork `session-id.ts` 一致；用于区分 IM 发起 vs Web 发起的会话。 */
export const IM_SESSION_PREFIX = 'dsh-im-session-';
export const IM_SESSION_PREFIX_LEGACY = 'im:';
/** 新旧两代前缀都算 IM 会话；本插件对 IM 会话直接 next() 交还 im-connect。 */
export function isImSessionId(sessionId) {
    if (!sessionId)
        return false;
    return sessionId.startsWith(IM_SESSION_PREFIX) || sessionId.startsWith(IM_SESSION_PREFIX_LEGACY);
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