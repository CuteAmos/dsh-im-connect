import { type ApprovalRequestLike, type ApprovalWaitResult } from './verdict.js';
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
 * 审批 answerer。作为 `approval/request` 的 prepend 监听器排在 im-connect 与
 * api-remotes 之前。对 IM 发起的会话直接 next() 交还 im-connect；对 Web 发起
 * 的会话（需求③）实现「PC 与 IM 并存」：先推 IM，再 next() 放行让 PC 端审批
 * 卡也弹出，二者 `Promise.race`，任一方先决即返回其结果，并释放另一方。
 *
 * 返回契约镜像 fork `handleApproval`：新契约（req.agent 存在）返回字符串
 * 词汇，旧契约返回 `{behavior}`。
 */
export declare function handleApproval(req: ApprovalRequestLike, next: () => Promise<unknown>, deps: ApprovalDeps): Promise<unknown>;
/** 拼审批卡文本，与 fork `approvalPrompt` 的引导语保持一致。 */
export declare function buildApprovalPrompt(req: ApprovalRequestLike, timeoutSecs: number): string;
export type { ApprovalWaitResult };
//# sourceMappingURL=approval.d.ts.map