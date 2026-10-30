import { approvalVerdict } from './verdict.js';
import { formatUserQuestion } from './question.js';
/**
 * 把入站消息认领钩子挂到 fork 的 `onInbound`，返回注销函数。
 * 命中本插件 pending 的审批回复 / 提问答案时返回 true（短路 im-connect 正常
 * 流程），否则返回 false（继续原流程）。单账号路由下用 chatId 匹配。
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
        // 优先认领提问答案（文字应答），其次审批回复。
        if (await handleQuestionReply(deps, accountId, msg))
            return true;
        if (await handleApprovalReply(deps, accountId, msg))
            return true;
        return false;
    });
}
async function handleApprovalReply(deps, accountId, msg) {
    const verdict = approvalVerdict(msg.text);
    if (verdict === undefined)
        return false;
    if (deps.pending.accountIdOf(msg.chatId) !== accountId)
        return false;
    if (!deps.pending.isReady(msg.chatId))
        return false;
    if (deps.pending.answer(msg.chatId, verdict === 'allow')) {
        deps.log(`[inbound] 认领审批回复 ${verdict}（chatId=${msg.chatId}）`);
        return true;
    }
    return false;
}
async function handleQuestionReply(deps, accountId, msg) {
    if (!msg.text)
        return false;
    if (deps.questions.accountIdOf(msg.chatId) !== accountId)
        return false;
    if (!deps.questions.isReady(msg.chatId))
        return false;
    const result = deps.questions.answer(msg.chatId, msg.text);
    if (!result.handled)
        return false;
    if (result.waitingPresentation)
        return true; // 详情仍在发送，认领但不推进
    if (result.completed) {
        deps.log(`[inbound] 认领提问最终答案（chatId=${msg.chatId}）`);
        return true;
    }
    if (result.next) {
        const next = result.next;
        deps.log(`[inbound] 认领提问答案，推进到第 ${next.index + 1}/${next.total} 题（chatId=${msg.chatId}）`);
        const kind = resolveKind(deps, accountId, msg.chatId);
        try {
            const prompt = formatUserQuestion(next.question, next.index, next.total, { requiresMention: kind === 'group' });
            await deps.bridge.send(accountId, msg.chatId, prompt);
            deps.questions.activate(msg.chatId);
        }
        catch (error) {
            deps.questions.cancel(msg.chatId, new Error('下一个交互问题发送失败'));
            deps.log(`[inbound] 下一题推送失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        return true;
    }
    return false;
}
function resolveKind(deps, accountId, chatId) {
    try {
        return deps.bridge.listChatTargets(accountId).find((target) => target.chatId === chatId)?.kind;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=inbound.js.map