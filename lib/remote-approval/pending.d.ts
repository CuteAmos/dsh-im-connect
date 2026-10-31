import type { ApprovalWaitResult } from './verdict.js';
/**
 * 审批等待表（correlation）。单账号路由下以 chatId 为 key；
 * 同一 chatId 同时只有一个等待，重入返回 undefined 表示拒绝并发。
 * 语义镜像 fork 的 ApprovalBroker：wait → activate → answer/cancel。
 */
export declare class PendingTable {
    private readonly pending;
    /** 注册一个审批等待；同一 chatId 已有等待时返回 undefined。 */
    waitApproval(chatId: string, accountId: string, timeoutMs: number, signal?: AbortSignal): Promise<ApprovalWaitResult> | undefined;
    /** 该 chatId 的等待所属账号；无等待返回 undefined。 */
    accountIdOf(chatId: string): string | undefined;
    /** 标记为可应答（提示已投递完成）。 */
    activate(chatId: string): boolean;
    /** 是否已可应答。 */
    isReady(chatId: string): boolean;
    /** 应答审批；未激活返回 false。 */
    answer(chatId: string, allow: boolean): boolean;
    /** 取消等待（投递失败等），resolve undefined。 */
    cancel(chatId: string): boolean;
    dispose(): void;
}
//# sourceMappingURL=pending.d.ts.map