/**
 * 提问等待表（correlation），语义镜像 fork `QuestionBroker`，但 key 用 chatId
 * （单账号路由，把 Web 会话的提问推到配置的 IM chatId），并额外加了与审批
 * 一致的超时（timeoutMs）到期按 abort 拒绝。纯函数与契约类型复用 fork。
 */
import { answerUserQuestion, } from '../engine/question.js';
export { validUserQuestion, formatUserQuestion, answerUserQuestion } from '../engine/question.js';
/**
 * 提问等待表（correlation）。单账号路由下以 chatId 为 key，同一目标同时只
 * 有一个提问交互；多问题逐题推进，语义镜像 fork `QuestionBroker`，额外加了
 * 与审批一致的超时（`timeoutMs`）到期按 abort 拒绝。
 */
export class QuestionPending {
    pending = new Map();
    begin(chatId, accountId, questions, timeoutMs, signal) {
        if (this.pending.has(chatId))
            return undefined;
        if (signal?.aborted)
            return undefined;
        return new Promise((resolve, reject) => {
            const entry = {
                accountId,
                chatId,
                questions,
                answers: [],
                index: 0,
                accepting: false,
                resolve,
                reject,
            };
            if (timeoutMs > 0) {
                entry.timer = setTimeout(() => this.finish(chatId, 'reject', new DOMException('Aborted', 'AbortError')), timeoutMs);
                entry.timer.unref?.();
            }
            if (signal) {
                entry.signal = signal;
                entry.onAbort = () => this.finish(chatId, 'reject', signal.reason ?? new DOMException('Aborted', 'AbortError'));
                signal.addEventListener('abort', entry.onAbort, { once: true });
            }
            this.pending.set(chatId, entry);
        });
    }
    accountIdOf(chatId) {
        return this.pending.get(chatId)?.accountId;
    }
    activate(chatId) {
        const entry = this.pending.get(chatId);
        if (!entry)
            return false;
        entry.accepting = true;
        return true;
    }
    isReady(chatId) {
        return this.pending.get(chatId)?.accepting === true;
    }
    current(chatId) {
        const entry = this.pending.get(chatId);
        const question = entry?.questions[entry.index];
        if (!entry || !question)
            return undefined;
        return { question, index: entry.index, total: entry.questions.length };
    }
    answer(chatId, text) {
        const entry = this.pending.get(chatId);
        const question = entry?.questions[entry.index];
        if (!entry || !question)
            return { handled: false };
        if (!entry.accepting)
            return { handled: true, waitingPresentation: true };
        entry.answers.push(answerUserQuestion(question, text));
        entry.index += 1;
        const next = entry.questions[entry.index];
        if (next) {
            entry.accepting = false;
            return { handled: true, next: { question: next, index: entry.index, total: entry.questions.length } };
        }
        const answers = entry.answers;
        this.cleanupEntry(entry);
        this.pending.delete(chatId);
        entry.resolve({ answers });
        return { handled: true, completed: true };
    }
    cancel(chatId, reason = new DOMException('Aborted', 'AbortError')) {
        const entry = this.pending.get(chatId);
        if (!entry)
            return false;
        this.cleanupEntry(entry);
        this.pending.delete(chatId);
        entry.reject(reason);
        return true;
    }
    dispose() {
        for (const chatId of [...this.pending.keys()])
            this.cancel(chatId);
    }
    finish(chatId, action, value) {
        const entry = this.pending.get(chatId);
        if (!entry)
            return;
        this.cleanupEntry(entry);
        this.pending.delete(chatId);
        if (action === 'resolve')
            entry.resolve(value);
        else
            entry.reject(value);
    }
    cleanupEntry(entry) {
        if (entry.timer)
            clearTimeout(entry.timer);
        if (entry.signal && entry.onAbort)
            entry.signal.removeEventListener('abort', entry.onAbort);
    }
}
//# sourceMappingURL=question.js.map