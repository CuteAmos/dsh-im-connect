import { isImSessionId } from './verdict.js';
/**
 * 审批 answerer。作为 `approval/request` 的普通顺序（非 prepend）监听器，
 * 只在 im-connect `next()` 放行的 Web 会话上被调用。
 *
 * 返回契约镜像 fork `handleApproval`：新契约（req.agent 存在）返回字符串
 * 词汇，旧契约返回 `{behavior}`。
 */
export async function handleApproval(req, next, deps) {
    const currentContract = req.agent !== undefined;
    const refused = currentContract ? 'rejected' : { behavior: 'reject' };
    const cancelled = currentContract ? 'cancelled' : { behavior: 'reject' };
    if (req.signal?.aborted)
        return cancelled;
    // IM 发起的会话由 im-connect 自己处理（它在 prepend 最外层，本插件 prepend 后会排其后），
    // 这里显式放行，避免把 IM 会话的审批重复推给同一聊天。
    const sessionId = req.agent?.session?.id ?? req.agent?.id ?? req.session?.id;
    if (isImSessionId(sessionId)) {
        deps.log(`[approval] IM 会话 ${sessionId}，交还 im-connect`);
        return next();
    }
    const binding = deps.readBinding();
    const accountId = binding.accountId.trim();
    const chatId = binding.chatId.trim();
    if (!accountId || !chatId) {
        deps.log(`[approval] 未绑定 IM 目标，回退宿主默认 answerer`);
        return next();
    }
    const wait = deps.pending.waitApproval(chatId, accountId, deps.timeoutSecs * 1000, req.signal);
    if (!wait) {
        deps.log(`[approval] chatId=${chatId} 已有未完成审批，拒绝并发`);
        return refused;
    }
    try {
        const prompt = buildApprovalPrompt(req, deps.timeoutSecs);
        await deps.bridge.send(accountId, chatId, prompt);
    }
    catch (error) {
        deps.pending.cancel(chatId);
        deps.log(`[approval] 推送失败: ${error instanceof Error ? error.message : String(error)}`);
        return refused;
    }
    deps.pending.activate(chatId);
    const verdict = await wait;
    if (req.signal?.aborted)
        return cancelled;
    if (verdict === 'allow')
        return currentContract ? 'allowed-once' : { behavior: 'allow' };
    if (verdict === 'reject')
        return refused;
    if (verdict === 'timeout') {
        void deps.bridge.send(accountId, chatId, `审批已超时取消（${Math.max(1, Math.round(deps.timeoutSecs / 60))} 分钟未回复），这次不会执行。`).catch(() => undefined);
        deps.log(`[approval] 审批超时取消 chatId=${chatId}`);
    }
    return cancelled;
}
/** 拼审批卡文本，与 fork `approvalPrompt` 的引导语保持一致。 */
export function buildApprovalPrompt(req, timeoutSecs) {
    const toolName = (req.toolName ?? '').trim() || '工具操作';
    const lines = [
        'DeepSeek Harness 需要你的审批：',
        '',
        `工具：${toolName}`,
    ];
    const reason = (req.reason ?? '').trim();
    if (reason)
        lines.push(`原因：${reason}`);
    lines.push('', '请精准回复「批准」或「拒绝」（也支持：同意 / 不同意 / yes / allow / no / reject）。');
    lines.push(`${Math.max(1, Math.round(timeoutSecs / 60))} 分钟内未回复将取消，这次不会执行。`);
    return lines.join('\n');
}
//# sourceMappingURL=approval.js.map