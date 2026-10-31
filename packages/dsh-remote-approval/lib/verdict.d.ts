/** 审批回复词汇与超时上限，与 fork `dsh-im-connect` 保持一致。 */
export type ApprovalWaitResult = 'allow' | 'reject' | 'timeout' | undefined;
/** 审批等待上限（毫秒），与 fork 的 APPROVAL_WAIT_MS 对齐；配置项 timeoutSecs 默认 300 秒。 */
export declare const DEFAULT_TIMEOUT_SECS = 300;
/** IM 会话 id 前缀，与 fork `session-id.ts` 一致；用于区分 IM 发起 vs Web 发起的会话。 */
export declare const IM_SESSION_PREFIX = "dsh-im-session-";
export declare const IM_SESSION_PREFIX_LEGACY = "im:";
/** 新旧两代前缀都算 IM 会话；本插件对 IM 会话直接 next() 交还 im-connect。 */
export declare function isImSessionId(sessionId: string | undefined): boolean;
/** 审批请求的最小契约（waterfall 收到的 request）。 */
export interface ApprovalRequestLike {
    agent?: {
        id?: string;
        session?: {
            id?: string;
        };
    };
    session?: {
        id?: string;
    };
    toolName?: string;
    callId?: string;
    reason?: string;
    signal?: AbortSignal;
}
/** 解析审批回复；非审批词返回 undefined。沿用 fork `approvalVerdict` 的词汇。 */
export declare function approvalVerdict(text: string): 'allow' | 'reject' | undefined;
//# sourceMappingURL=verdict.d.ts.map