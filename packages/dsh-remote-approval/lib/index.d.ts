/**
 * dsh-remote-approval Host：把 Web 发起任务的人工审批推送到 IM 完成。
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-remote-approval";
export declare const inject: string[];
export interface PluginConfig {
    enabled: boolean;
    timeoutSecs: number;
}
export declare const Config: Schema<PluginConfig>;
export declare function apply(ctx: Context, config: PluginConfig): void;
export { StateStore } from './config.js';
export { PendingTable } from './pending.js';
export { approvalVerdict } from './verdict.js';
export { buildApprovalPrompt } from './approval.js';
export type { ImConnectBridge, ImConnectBridgeAccount, ImConnectBridgeChatTarget, ImMessage, InboundHandler } from './types.js';
//# sourceMappingURL=index.d.ts.map