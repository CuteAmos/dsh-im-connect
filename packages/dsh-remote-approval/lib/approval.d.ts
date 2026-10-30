import type { ApprovalRequestLike, ApprovalWaitResult } from './verdict.js';
import type { PendingTable } from './pending.js';
import type { RemoteApprovalState } from './config.js';
import type { ImConnectBridge } from './types.js';
/** 审批 answerer 的依赖：注入的 bridge、待回答的等待表、静态配置与运行时绑定。 */
export interface ApprovalDeps {
    bridge: ImConnectBridge;
    pending: PendingTable;
    timeoutSecs: number;
    readBinding(): RemoteApprovalState;
    log(line: string): void;
}
/**
 * 审批 answerer。作为 `approval/request` 的普通顺序（非 prepend）监听器，
 * 只在 im-connect `next()` 放行的 Web 会话上被调用。
 *
 * 返回契约镜像 fork `handleApproval`：新契约（req.agent 存在）返回字符串
 * 词汇，旧契约返回 `{behavior}`。
 */
export declare function handleApproval(req: ApprovalRequestLike, next: () => Promise<unknown>, deps: ApprovalDeps): Promise<unknown>;
/** 拼审批卡文本，与 fork `approvalPrompt` 的引导语保持一致。 */
export declare function buildApprovalPrompt(req: ApprovalRequestLike, timeoutSecs: number): string;
export type { ApprovalWaitResult };
//# sourceMappingURL=approval.d.ts.map