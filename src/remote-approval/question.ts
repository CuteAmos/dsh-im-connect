/**
 * 提问等待表（correlation），语义镜像 fork `QuestionBroker`，但 key 用 chatId
 * （单账号路由，把 Web 会话的提问推到配置的 IM chatId），并额外加了与审批
 * 一致的超时（timeoutMs）到期按 abort 拒绝。纯函数与契约类型复用 fork。
 */
import {
  answerUserQuestion,
  type UserQuestionAnswer,
  type UserQuestionAnswerItem,
  type UserQuestionItem,
} from '../engine/question.js'

export type {
  UserQuestionOption,
  UserQuestionItem,
  UserQuestionAnswerItem,
  UserQuestionAnswer,
} from '../engine/question.js'

export { validUserQuestion, formatUserQuestion, answerUserQuestion } from '../engine/question.js'

/** `user-questions/request` waterfall 收到的请求最小契约。 */
export interface UserQuestionRequestLike {
  agent?: { id?: string; session?: { id?: string } }
  questions?: unknown[]
  signal?: AbortSignal
}

export interface QuestionReplyResult {
  handled: boolean
  waitingPresentation?: boolean
  completed?: boolean
  next?: { question: UserQuestionItem; index: number; total: number }
}

interface QuestionPendingEntry {
  accountId: string
  chatId: string
  questions: UserQuestionItem[]
  answers: UserQuestionAnswerItem[]
  index: number
  accepting: boolean
  resolve: (answer: UserQuestionAnswer) => void
  reject: (error: unknown) => void
  timer?: NodeJS.Timeout
  signal?: AbortSignal
  onAbort?: () => void
}

/**
 * 提问等待表（correlation）。单账号路由下以 chatId 为 key，同一目标同时只
 * 有一个提问交互；多问题逐题推进，语义镜像 fork `QuestionBroker`，额外加了
 * 与审批一致的超时（`timeoutMs`）到期按 abort 拒绝。
 */
export class QuestionPending {
  private readonly pending = new Map<string, QuestionPendingEntry>()

  begin(chatId: string, accountId: string, questions: UserQuestionItem[], timeoutMs: number, signal?: AbortSignal): Promise<UserQuestionAnswer> | undefined {
    if (this.pending.has(chatId)) return undefined
    if (signal?.aborted) return undefined
    return new Promise<UserQuestionAnswer>((resolve, reject) => {
      const entry: QuestionPendingEntry = {
        accountId,
        chatId,
        questions,
        answers: [],
        index: 0,
        accepting: false,
        resolve,
        reject,
      }
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => this.finish(chatId, 'reject', new DOMException('Aborted', 'AbortError')), timeoutMs)
        entry.timer.unref?.()
      }
      if (signal) {
        entry.signal = signal
        entry.onAbort = () => this.finish(chatId, 'reject', signal.reason ?? new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      this.pending.set(chatId, entry)
    })
  }

  accountIdOf(chatId: string): string | undefined {
    return this.pending.get(chatId)?.accountId
  }

  activate(chatId: string): boolean {
    const entry = this.pending.get(chatId)
    if (!entry) return false
    entry.accepting = true
    return true
  }

  isReady(chatId: string): boolean {
    return this.pending.get(chatId)?.accepting === true
  }

  current(chatId: string): { question: UserQuestionItem; index: number; total: number } | undefined {
    const entry = this.pending.get(chatId)
    const question = entry?.questions[entry.index]
    if (!entry || !question) return undefined
    return { question, index: entry.index, total: entry.questions.length }
  }

  answer(chatId: string, text: string): QuestionReplyResult {
    const entry = this.pending.get(chatId)
    const question = entry?.questions[entry.index]
    if (!entry || !question) return { handled: false }
    if (!entry.accepting) return { handled: true, waitingPresentation: true }
    entry.answers.push(answerUserQuestion(question, text))
    entry.index += 1
    const next = entry.questions[entry.index]
    if (next) {
      entry.accepting = false
      return { handled: true, next: { question: next, index: entry.index, total: entry.questions.length } }
    }
    const answers = entry.answers
    this.cleanupEntry(entry)
    this.pending.delete(chatId)
    entry.resolve({ answers })
    return { handled: true, completed: true }
  }

  cancel(chatId: string, reason: unknown = new DOMException('Aborted', 'AbortError')): boolean {
    const entry = this.pending.get(chatId)
    if (!entry) return false
    this.cleanupEntry(entry)
    this.pending.delete(chatId)
    entry.reject(reason)
    return true
  }

  dispose(): void {
    for (const chatId of [...this.pending.keys()]) this.cancel(chatId)
  }

  private finish(chatId: string, action: 'resolve' | 'reject', value: UserQuestionAnswer | unknown): void {
    const entry = this.pending.get(chatId)
    if (!entry) return
    this.cleanupEntry(entry)
    this.pending.delete(chatId)
    if (action === 'resolve') entry.resolve(value as UserQuestionAnswer)
    else entry.reject(value)
  }

  private cleanupEntry(entry: QuestionPendingEntry): void {
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
  }
}
