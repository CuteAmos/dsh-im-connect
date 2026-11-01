/**
 * remote-approval 组件：把 Web 发起任务的人工审批 / 引导提问推送到 IM 完成。
 *
 * 作为 dsh-im-connect 包内的独立 cordis 子插件（说明符
 * `@michengai/dsh-im-connect/remote-approval`）加载：插件管理的「包含的组件」
 * 会为它单独显示一行开关，开关即控制本插件的 fiber enable/disable，从而控制
 * 移动端审批（answerer）与管理 API 是否注册。`inject:['imConnect','webServer']`
 * 是硬依赖：imConnect 由 fork 主插件 `ctx.provide('imConnect')` 提供，webServer
 * 由 Host 提供（registerApi 里以 `ctx.webServer` 属性访问，必须在 inject 声明）。
 * 因此关闭 im-connect 组件时本组件也会随之停用，不破坏 im-connect 原有功能。
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
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
export declare const name = "@michengai/dsh-im-connect/remote-approval";
export declare const inject: string[];
export interface RemoteApprovalConfig {
    enabled?: boolean;
    timeoutSecs?: number;
}
export declare const Config: Schema<RemoteApprovalConfig>;
export declare function apply(ctx: Context, config: RemoteApprovalConfig): void;
//# sourceMappingURL=index.d.ts.map