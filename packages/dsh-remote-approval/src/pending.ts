import type { ApprovalWaitResult } from './verdict.js'

interface PendingEntry {
  kind: 'approval'
  accountId: string
  chatId: string
  accepting: boolean
  resolve: (value: ApprovalWaitResult) => void
  timer?: NodeJS.Timeout
  signal?: AbortSignal
  onAbort?: () => void
}

/**
 * 审批等待表（correlation）。单账号路由下以 chatId 为 key；
 * 同一 chatId 同时只有一个等待，重入返回 undefined 表示拒绝并发。
 * 语义镜像 fork 的 ApprovalBroker：wait → activate → answer/cancel。
 */
export class PendingTable {
  private readonly pending = new Map<string, PendingEntry>()

  /** 注册一个审批等待；同一 chatId 已有等待时返回 undefined。 */
  waitApproval(chatId: string, accountId: string, timeoutMs: number, signal?: AbortSignal): Promise<ApprovalWaitResult> | undefined {
    if (this.pending.has(chatId)) return undefined
    if (signal?.aborted) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      const settle = (value: ApprovalWaitResult) => {
        const entry = this.pending.get(chatId)
        if (!entry) return
        if (entry.timer) clearTimeout(entry.timer)
        if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
        this.pending.delete(chatId)
        resolve(value)
      }
      const entry: PendingEntry = { kind: 'approval', accountId, chatId, accepting: false, resolve: settle }
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => settle('timeout'), timeoutMs)
        entry.timer.unref?.()
      }
      if (signal) {
        entry.signal = signal
        entry.onAbort = () => settle(undefined)
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      this.pending.set(chatId, entry)
    })
  }

  /** 该 chatId 的等待所属账号；无等待返回 undefined。 */
  accountIdOf(chatId: string): string | undefined {
    return this.pending.get(chatId)?.accountId
  }

  /** 标记为可应答（提示已投递完成）。 */
  activate(chatId: string): boolean {
    const entry = this.pending.get(chatId)
    if (!entry) return false
    entry.accepting = true
    return true
  }

  /** 是否已可应答。 */
  isReady(chatId: string): boolean {
    return this.pending.get(chatId)?.accepting === true
  }

  /** 应答审批；未激活返回 false。 */
  answer(chatId: string, allow: boolean): boolean {
    const entry = this.pending.get(chatId)
    if (!entry || !entry.accepting) return false
    entry.resolve(allow ? 'allow' : 'reject')
    return true
  }

  /** 取消等待（投递失败等），resolve undefined。 */
  cancel(chatId: string): boolean {
    const entry = this.pending.get(chatId)
    if (!entry) return false
    entry.resolve(undefined)
    return true
  }

  dispose(): void {
    for (const chatId of [...this.pending.keys()]) this.cancel(chatId)
  }
}
