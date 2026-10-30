/**
 * 提问契约与纯函数，与 fork `src/engine/question.ts` 逐字一致（fork 未通过
 * `exports` 暴露这些函数，故在本插件内复制以保持解析协议一致；中文文案内联，
 * 不做 locale 切换）。
 */
function nonEmptyText(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    return text || undefined;
}
export function validUserQuestion(question) {
    if (!question || typeof question !== 'object')
        return false;
    const item = question;
    if (typeof item.id !== 'string' || typeof item.question !== 'string')
        return false;
    if (item.header !== undefined && typeof item.header !== 'string')
        return false;
    if (item.detail !== undefined && typeof item.detail !== 'string')
        return false;
    if (item.multiSelect !== undefined && typeof item.multiSelect !== 'boolean')
        return false;
    if (item.intent !== undefined) {
        if (!item.intent || typeof item.intent !== 'object')
            return false;
        const intent = item.intent;
        if (typeof intent.kind !== 'string')
            return false;
        if (intent.approve !== undefined && typeof intent.approve !== 'string')
            return false;
    }
    if (item.options !== undefined) {
        if (!Array.isArray(item.options))
            return false;
        for (const option of item.options) {
            if (!option || typeof option !== 'object')
                return false;
            const value = option;
            if (typeof value.label !== 'string')
                return false;
            if (value.description !== undefined && typeof value.description !== 'string')
                return false;
        }
    }
    return true;
}
export function formatUserQuestion(question, index, total, options = {}) {
    const progress = total > 1 ? `（${index + 1}/${total}）` : '';
    const lines = [`DeepSeek Harness 需要你补充信息${progress}：`];
    const header = nonEmptyText(question.header);
    const prompt = nonEmptyText(question.question) ?? '请输入你的回答。';
    const detail = nonEmptyText(question.detail);
    if (header)
        lines.push('', header);
    lines.push('', prompt);
    if (detail)
        lines.push('', detail);
    const choices = question.options ?? [];
    if (choices.length > 0) {
        lines.push('');
        choices.forEach((choice, choiceIndex) => {
            const description = nonEmptyText(choice.description);
            const checked = question.multiSelect && options.selected?.has(choiceIndex) ? '✓ ' : '';
            lines.push(`${choiceIndex + 1}. ${checked}${choice.label}${description ? ` — ${description}` : ''}`);
        });
        if (question.multiSelect === true && options.selected?.size)
            lines.push(`${choices.length + 1}. 提交所选`);
        lines.push('', question.multiSelect === true
            ? '请回复选项序号或文字；多选用逗号分隔，也可补充其他内容。'
            : '请回复一个选项序号或文字，也可直接输入其他答案。');
    }
    else {
        lines.push('', '请直接回复你的答案。');
    }
    if (options.requiresMention)
        lines.push('', '群聊中请 @机器人 后发送答案。');
    return lines.join('\n');
}
function optionLabel(token, options) {
    const value = token.trim();
    if (!value)
        return undefined;
    if (/^\d+$/.test(value))
        return options[Number(value) - 1]?.label;
    return options.find((option) => option.label === value)?.label;
}
export function answerUserQuestion(question, input) {
    const text = input.trim();
    const options = question.options ?? [];
    if (options.length === 0)
        return { id: question.id, selected: [], custom: text };
    const whole = optionLabel(text, options);
    if (question.multiSelect !== true) {
        return whole
            ? { id: question.id, selected: [whole] }
            : { id: question.id, selected: [], custom: text };
    }
    if (whole)
        return { id: question.id, selected: [whole] };
    const selected = [];
    const custom = [];
    for (const raw of text.split(/[,，、;；\n]+/)) {
        const value = raw.trim();
        if (!value)
            continue;
        const label = optionLabel(value, options);
        if (label) {
            if (!selected.includes(label))
                selected.push(label);
        }
        else {
            custom.push(value);
        }
    }
    return {
        id: question.id,
        selected,
        ...(custom.length > 0 ? { custom: custom.join('、') } : {}),
    };
}
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