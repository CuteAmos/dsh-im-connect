import { formatUserQuestion, validUserQuestion, type UserQuestionAnswer, type UserQuestionItem, type UserQuestionRequestLike } from './question.js'
import { isImSessionId } from './verdict.js'
import type { QuestionPending } from './question.js'
import type { RemoteApprovalState } from './config.js'
import type { ImConnectBridge } from './types.js'

/** 提问 answerer 的依赖。 */
export interface QuestionDeps {
  bridge: ImConnectBridge
  questions: QuestionPending
  timeoutSecs: number
  readBinding(): RemoteApprovalState
  log(line: string): void
}

/** 从 bridge 的历史绑定里解析 chatId 的聊天类型；纯推送场景可能查不到。 */
export function resolveKind(bridge: ImConnectBridge, accountId: string, chatId: string): 'dm' | 'group' | undefined {
  try {
    return bridge.listChatTargets(accountId).find((target) => target.chatId === chatId)?.kind
  } catch {
    return undefined
  }
}

/**
 * 提问 answerer。作为 `user-questions/request` 的普通顺序监听器，排在
 * im-connect 之后，只接管其 `next()` 放行的 Web 会话。
 *
 * 返回 `UserQuestionAnswer`；校验失败 / abort / 发送失败时 throw（镜像 fork
 * `onUserQuestions`）。
 */
export async function handleUserQuestions(req: UserQuestionRequestLike, next: () => Promise<UserQuestionAnswer>, deps: QuestionDeps): Promise<UserQuestionAnswer> {
  const questions = req.questions
  if (!Array.isArray(questions)
    || questions.length === 0
    || questions.some((question) => !validUserQuestion(question))) {
    throw new Error('无法在当前聊天展示这个问题')
  }
  if (req.signal?.aborted) {
    throw req.signal.reason ?? new DOMException('Aborted', 'AbortError')
  }

  // IM 发起的会话由 im-connect 自己处理；本插件只接管 Web 会话，避免重复推送。
  const sessionId = req.agent?.session?.id ?? req.agent?.id
  if (isImSessionId(sessionId)) {
    deps.log(`[question] IM 会话 ${sessionId}，交还 im-connect`)
    return next()
  }

  const binding = deps.readBinding()
  const accountId = binding.accountId.trim()
  const chatId = binding.chatId.trim()
  if (!accountId || !chatId) {
    deps.log('[question] 未绑定 IM 目标，回退宿主默认 answerer')
    return next()
  }

  const typedQuestions = questions as UserQuestionItem[]
  const wait = deps.questions.begin(chatId, accountId, typedQuestions, deps.timeoutSecs * 1000, req.signal)
  if (!wait) throw new Error('当前聊天已有未完成的问题')
  // 发送期间 abort 会让 wait reject，先接住避免 unhandled rejection。
  void wait.catch(() => undefined)

  const kind = resolveKind(deps.bridge, accountId, chatId)
  try {
    const prompt = formatUserQuestion(typedQuestions[0]!, 0, typedQuestions.length, { requiresMention: kind === 'group' })
    await deps.bridge.send(accountId, chatId, prompt)
  } catch (error) {
    deps.questions.cancel(chatId, new Error('交互问题未能发送到原聊天'))
    deps.log(`[question] 推送失败: ${error instanceof Error ? error.message : String(error)}`)
    throw new Error('交互问题未能发送到原聊天')
  }

  deps.questions.activate(chatId)
  return await wait
}
