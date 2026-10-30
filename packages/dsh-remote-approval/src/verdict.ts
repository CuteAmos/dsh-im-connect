/** 审批回复词汇与超时上限，与 fork `dsh-im-connect` 保持一致。 */
export type ApprovalWaitResult = 'allow' | 'reject' | 'timeout' | undefined

/** 审批等待上限（毫秒），与 fork 的 APPROVAL_WAIT_MS 对齐；配置项 timeoutSecs 默认 300 秒。 */
export const DEFAULT_TIMEOUT_SECS = 300

/** 审批请求的最小契约（waterfall 收到的 request）。 */
export interface ApprovalRequestLike {
  agent?: { id?: string; session?: { id?: string } }
  session?: { id?: string }
  toolName?: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

/** 解析审批回复；非审批词返回 undefined。沿用 fork `approvalVerdict` 的词汇。 */
export function approvalVerdict(text: string): 'allow' | 'reject' | undefined {
  const value = text.trim().toLowerCase()
  if (['批准', '同意', 'yes', 'y', 'allow'].includes(value)) return 'allow'
  if (['拒绝', '不同意', 'no', 'n', 'reject', 'deny'].includes(value)) return 'reject'
  return undefined
}
