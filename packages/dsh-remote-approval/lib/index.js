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
// imConnect 不能放进数组 inject：数组是 Cordis 硬依赖，任一 service 未提供时
// 整个 fiber 停在 INACTIVE、apply 根本不会被调用，「未安装 fork 时优雅降级」
// 就变成不可达代码。改为 apply 内 ctx.get('imConnect') 手动获取，配合
// cordis.patch.yml 的加载顺序（排 im-connect 之后，其 apply 内同步 provide）拿到。
export const inject = ['webServer'];
export const Config = Schema.object({
    enabled: Schema.boolean().default(true),
    timeoutSecs: Schema.number().min(1).default(300).description('审批等待上限（秒），到期按取消处理。'),
});
export function apply(ctx, config) {
    if (config.enabled === false)
        return;
    // StateStore 只记录文件路径、构造时不写盘，故不依赖 bridge，提前创建可被迟到 setup 复用。
    const stateDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-remote-approval');
    const state = new StateStore(join(stateDir, 'state.json'));
    // 全部依赖 bridge 的装配（answerer / 入站认领 / 管理 API）收进 setup，按执行它的 ctx 挂生命周期。
    const setup = (runCtx, bridge) => {
        const pending = new PendingTable();
        const questions = new QuestionPending();
        const log = (line) => runCtx.logger(name).info(line);
        const readBinding = () => state.read();
        const deps = { bridge, pending, questions, timeoutSecs: config.timeoutSecs, readBinding, log };
        // fork 对 ctx.on 的自定义事件名同样用 unknown 强转绕过 Cordis 的 Events 类型表（见 gateway.ts:214）。
        const on = runCtx.on;
        const offApproval = on('approval/request', (req, next) => {
            return handleApproval(req, next, deps);
        });
        const offQuestion = on('user-questions/request', (req, next) => {
            return handleUserQuestions(req, next, deps);
        });
        const offInbound = installInbound(deps);
        registerApi(runCtx, { bridge, state, log });
        runCtx.effect(() => () => {
            offApproval();
            offQuestion();
            offInbound();
            pending.dispose();
            questions.dispose();
        }, 'dsh-remote-approval.dispose');
    };
    // im-connect 的 ctx.provide('imConnect') 在它自己的 apply 里同步执行，但 loader 用
    // Promise.all 并行启动各 bundle 的 fiber（cordis-plugin-loader EntryGroup.update:87），
    // 顺序不保证：本插件 apply 可能先跑，此刻 ctx.get('imConnect') 尚为 undefined。
    // 因此优先同步获取；拿不到则用 ctx.inject（Cordis 标准「服务就绪再执行」，靠 provide
    // 的 notify 触发激活）挂起等待，无论 im-connect 先后都能正确装配。
    const bridge = ctx.get('imConnect');
    if (bridge) {
        setup(ctx, bridge);
        return;
    }
    ctx.logger(name).error('未找到 imConnect service；若已安装 fork 的 dsh-im-connect 将在其就绪后自动接管，否则远程审批保持禁用。');
    ctx.inject(['imConnect'], (injectCtx) => {
        const lateBridge = injectCtx.get('imConnect');
        if (lateBridge)
            setup(injectCtx, lateBridge);
    });
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