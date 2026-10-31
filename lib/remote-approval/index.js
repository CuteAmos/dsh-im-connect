import { join } from 'node:path';
import { StateStore } from './config.js';
import { PendingTable } from './pending.js';
import { QuestionPending } from './question.js';
import { handleApproval } from './approval.js';
import { handleUserQuestions } from './question-handler.js';
import { installInbound } from './inbound.js';
import { registerApi } from './api.js';
/**
 * 装配 remote-approval 组件：注册审批 / 提问 answerer（prepend + global）、
 * 入站认领钩子与管理 API。返回一次性注销函数，供 fork 的 dispose 链调用。
 */
export function setupRemoteApproval(ctx, options) {
    if (options.enabled === false)
        return () => { };
    const state = new StateStore(join(options.stateDir, 'state.json'));
    const pending = new PendingTable();
    const questions = new QuestionPending();
    const readBinding = () => state.read();
    const deps = {
        bridge: options.bridge,
        pending,
        questions,
        timeoutSecs: options.timeoutSecs,
        readBinding,
        log: options.log,
    };
    // fork 对 ctx.on 的自定义事件名同样用 unknown 强转绕过 Cordis 的 Events 类型表
    // （见 fork gateway.ts:214）。prepend + global 与 fork im-connect 对齐，确保排到
    // api-remotes（Web UI 审批卡转发层，push 追加）之前——api-remotes 在 Web 卡有消费者
    // 时不会调用 next()，会短路其后的 answerer；prepend 后本组件在外层先收到，
    // IM 会话再靠 isImSessionId 显式 next() 交还 im-connect。
    // 与 fork gateway.ts:214 的 `if (this.ctx.on)` 一样防御：ctx 无 on（如某些测试
    // 或纯 API 宿主 mock）时跳过 answerer 注册，但仍挂入站钩子与管理 API。
    const on = typeof ctx.on === 'function'
        ? ctx.on
        : undefined;
    const noop = () => { };
    const offApproval = on
        ? on('approval/request', (req, next) => {
            return handleApproval(req, next, deps);
        }, { prepend: true, global: true })
        : noop;
    const offQuestion = on
        ? on('user-questions/request', (req, next) => {
            return handleUserQuestions(req, next, deps);
        }, { prepend: true, global: true })
        : noop;
    const offInbound = installInbound(deps);
    registerApi(ctx, { bridge: options.bridge, state, log: options.log });
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
            offApproval();
            offQuestion();
            offInbound();
            pending.dispose();
            questions.dispose();
        }, 'dsh-remote-approval.dispose');
    }
    return () => {
        offApproval();
        offQuestion();
        offInbound();
        pending.dispose();
        questions.dispose();
    };
}
export { StateStore } from './config.js';
export { PendingTable } from './pending.js';
export { QuestionPending } from './question.js';
export { approvalVerdict } from './verdict.js';
export { buildApprovalPrompt } from './approval.js';
export { registerApi, readApiJsonBody } from './api.js';
export { testConnection, buildTestApprovalText, buildTestQuestionText } from './test.js';
export { validUserQuestion, formatUserQuestion, answerUserQuestion } from './question.js';
//# sourceMappingURL=index.js.map