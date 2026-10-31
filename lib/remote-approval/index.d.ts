/**
 * remote-approval 组件：把 Web 发起任务的人工审批 / 引导提问推送到 IM 完成。
 *
 * 并入 dsh-im-connect 后不再作为独立插件，而是纯模块：fork 的 apply 在
 * `ctx.provide('imConnect')` 之后同步调用 `setupRemoteApproval(ctx, options)`，
 * 此时 bridge 已就绪，无需再走 `ctx.inject` 迟到绑定。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImConnectBridge } from './types.js';
/** `setupRemoteApproval` 的入参；全部由 fork apply 显式提供。 */
export interface RemoteApprovalOptions {
    bridge: ImConnectBridge;
    enabled: boolean;
    timeoutSecs: number;
    /** state.json 所在目录（默认 %DSH_HOME%/dsh-remote-approval）。 */
    stateDir: string;
    log(line: string): void;
}
/**
 * 装配 remote-approval 组件：注册审批 / 提问 answerer（prepend + global）、
 * 入站认领钩子与管理 API。返回一次性注销函数，供 fork 的 dispose 链调用。
 */
export declare function setupRemoteApproval(ctx: Context, options: RemoteApprovalOptions): () => void;
export { StateStore } from './config.js';
export { PendingTable } from './pending.js';
export { QuestionPending } from './question.js';
export { approvalVerdict } from './verdict.js';
export { buildApprovalPrompt } from './approval.js';
export { registerApi, readApiJsonBody } from './api.js';
export { testConnection, buildTestApprovalText, buildTestQuestionText } from './test.js';
export { validUserQuestion, formatUserQuestion, answerUserQuestion } from './question.js';
export type { ImConnectBridge, ImConnectBridgeAccount, ImConnectBridgeChatTarget, ImMessage, InboundHandler } from './types.js';
export type { UserQuestionOption, UserQuestionItem, UserQuestionAnswerItem, UserQuestionAnswer } from './question.js';
//# sourceMappingURL=index.d.ts.map