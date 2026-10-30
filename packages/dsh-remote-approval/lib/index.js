import Schema from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from './config.js';
import { PendingTable } from './pending.js';
import { QuestionPending } from './question.js';
import { handleApproval } from './approval.js';
import { handleUserQuestions } from './question-handler.js';
import { installInbound } from './inbound.js';
import { registerApi } from './api.js';
export const name = 'dsh-remote-approval';
export const inject = ['imConnect', 'webServer'];
export const Config = Schema.object({
    enabled: Schema.boolean().default(true),
    timeoutSecs: Schema.number().default(300).description('审批等待上限（秒），到期按取消处理。'),
});
export function apply(ctx, config) {
    if (config.enabled === false)
        return;
    const bridge = ctx.get('imConnect');
    if (!bridge) {
        ctx.logger(name).error('未找到 imConnect service；请确认已安装 fork 的 dsh-im-connect。远程审批已禁用。');
        return;
    }
    const stateDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-remote-approval');
    const state = new StateStore(join(stateDir, 'state.json'));
    const pending = new PendingTable();
    const questions = new QuestionPending();
    const log = (line) => ctx.logger(name).info(line);
    const readBinding = () => state.read();
    const deps = { bridge, pending, questions, timeoutSecs: config.timeoutSecs, readBinding, log };
    // fork 对 ctx.on 的自定义事件名同样用 unknown 强转绕过 Cordis 的 Events 类型表（见 gateway.ts:214）。
    const on = ctx.on;
    const offApproval = on('approval/request', (req, next) => {
        return handleApproval(req, next, deps);
    });
    const offQuestion = on('user-questions/request', (req, next) => {
        return handleUserQuestions(req, next, deps);
    });
    const offInbound = installInbound(deps);
    registerApi(ctx, { bridge, state, log });
    ctx.effect(() => () => {
        offApproval();
        offQuestion();
        offInbound();
        pending.dispose();
        questions.dispose();
    }, 'dsh-remote-approval.dispose');
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