/** 审批回复词汇与超时上限，与 fork `dsh-im-connect` 保持一致。 */
export type ApprovalWaitResult = 'allow' | 'reject' | 'timeout' | undefined;
/** 审批等待上限（秒），配置项 timeoutSecs 默认 300 秒。 */
export declare const DEFAULT_TIMEOUT_SECS = 300;
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
/**
 * 新旧两代前缀都算 IM 会话。委托 fork `session-id.ts` 的前缀判定，
 * 这里只补 `string | undefined` 判空，保持本组件调用处签名不变。
 */
export declare function isImSessionId(sessionId: string | undefined): boolean;
/** 解析审批回复；非审批词返回 undefined。沿用 fork `approvalVerdict` 的词汇。 */
export declare function approvalVerdict(text: string): 'allow' | 'reject' | undefined;
//# sourceMappingURL=verdict.d.ts.map