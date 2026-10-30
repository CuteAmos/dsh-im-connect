/** 审批等待上限（毫秒），与 fork 的 APPROVAL_WAIT_MS 对齐；配置项 timeoutSecs 默认 300 秒。 */
export const DEFAULT_TIMEOUT_SECS = 300;
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