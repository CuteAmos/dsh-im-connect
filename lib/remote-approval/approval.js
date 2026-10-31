import { isImSessionId } from './verdict.js';
/**
 * 审批 answerer。作为 `approval/request` 的 prepend 监听器排在 im-connect 与
 * api-remotes 之前。对 IM 发起的会话直接 next() 交还 im-connect；对 Web 发起
 * 的会话（需求③）实现「PC 与 IM 并存」：先推 IM，再 next() 放行让 PC 端审批
 * 卡也弹出，二者 `Promise.race`，任一方先决即返回其结果，并释放另一方。
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
    // IM 发起的会话由 im-connect 自己处理（它在 prepend 队列里排本组件之后），
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
        deps.log('[approval] 未绑定 IM 目标，回退宿主默认 answerer');
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
    const announceTimeout = () => {
        void deps.bridge.send(accountId, chatId, `审批已超时取消（${Math.max(1, Math.round(deps.timeoutSecs / 60))} 分钟未回复），这次不会执行。`).catch(() => undefined);
        deps.log(`[approval] 审批超时取消 chatId=${chatId}`);
    };
    /** IM 等待结果映射成审批词汇；timeout/undefined/abort 落 cancelled（不额外通知）。 */
    const settleIm = (value) => {
        if (req.signal?.aborted)
            return cancelled;
        if (value === 'allow')
            return currentContract ? 'allowed-once' : { behavior: 'allow' };
        if (value === 'reject')
            return refused;
        if (value === 'timeout')
            announceTimeout();
        return cancelled;
    };
    // PC 分支：next() 经过 im-connect（Web 会话放行）→ api-remotes。有 Web 审批卡
    // 消费者时挂起等 PC 决；无消费者时 settle 'unavailable'（视为 PC 弃权）。
    const pc = Promise.resolve()
        .then(() => next())
        .then((value) => ({ source: 'pc', value }))
        .catch(() => ({ source: 'pc', value: 'unavailable' }));
    // IM 分支：wait 永不 reject，只 resolve 'allow' / 'reject' / 'timeout' / undefined。
    const im = wait.then((value) => ({ source: 'im', value }));
    const winner = await Promise.race([pc, im]);
    if (winner.source === 'pc') {
        if (winner.value === 'unavailable') {
            deps.log('[approval] PC 端无审批卡消费者（弃权），等待 IM 回复');
            return settleIm(await wait);
        }
        // PC 先决：释放 IM 等待并告知无需二次审批，返回 PC 结果。
        deps.pending.cancel(chatId);
        void deps.bridge.send(accountId, chatId, '已在 PC 端完成审批，无需在 IM 二次操作。').catch(() => undefined);
        deps.log('[approval] PC 端先决，释放 IM 等待');
        return winner.value;
    }
    // IM 先决：真实决策直接返回；超时 / 取消不是决策，继续等 PC（PC 卡仍合法弹着）。
    if (winner.value === 'allow' || winner.value === 'reject') {
        return settleIm(winner.value);
    }
    deps.log('[approval] IM 未在超时内决出，继续等待 PC 端');
    const pcResult = await pc;
    if (pcResult.value === 'unavailable') {
        announceTimeout();
        return cancelled;
    }
    return pcResult.value;
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