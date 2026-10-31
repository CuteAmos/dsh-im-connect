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

/** PC/IM 任一方决出后统一的结果形状；value=null 表示该侧「弃权 / 放弃」。 */
type QuestionWinner =
  | { source: 'pc'; value: UserQuestionAnswer | null }
  | { source: 'im'; value: UserQuestionAnswer | null }

/**
 * 提问 answerer。作为 `user-questions/request` 的 prepend 监听器，排在
 * im-connect 与 api-remotes 之前。对 IM 会话直接 next() 交还 im-connect；
 * 对 Web 会话（需求③）实现「PC 与 IM 并存」：先推 IM，再 next() 放行让
 * PC 端提问卡也弹出，二者 `Promise.race`，任一方先答完即返回，释放另一方。
 *
 * 返回 `UserQuestionAnswer`；校验失败 / abort / 发送失败时 throw（镜像 fork
 * `onUserQuestions`）。PC 无消费者时 next() 会 reject（NO_PROVIDER），视为
 * 弃权继续等 IM；IM 超时 / abort 不是「答完」，继续等 PC。
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

  // IM 发起的会话由 im-connect 自己处理；本组件只接管 Web 会话，避免重复推送。
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
  // 发送失败会在下方 cancel 掉 wait；提前接住，避免 unhandled rejection。
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

  // PC 分支：next() resolve 表示 Web 卡答完，reject 表示无消费者（弃权）。
  const pc = Promise.resolve()
    .then(() => next())
    .then((value): QuestionWinner => ({ source: 'pc', value }))
    .catch((): QuestionWinner => ({ source: 'pc', value: null }))

  // IM 分支：wait resolve 表示 IM 答完全部题目，reject 表示超时 / abort（放弃）。
  const im = wait.then(
    (value): QuestionWinner => ({ source: 'im', value }),
    (): QuestionWinner => ({ source: 'im', value: null }),
  )

  const winner = await Promise.race([pc, im])

  if (winner.source === 'pc') {
    if (winner.value === null) {
      deps.log('[question] PC 端无提问卡消费者（弃权），等待 IM 回答')
      return await wait
    }
    // PC 先决：释放 IM 等待并告知无需二次回答，返回 PC 答案。
    deps.questions.cancel(chatId)
    void deps.bridge.send(accountId, chatId, '已在 PC 端完成回答，无需在 IM 二次操作。').catch(() => undefined)
    deps.log('[question] PC 端先决，释放 IM 等待')
    return winner.value
  }

  // IM 先决：答完全部直接返回；超时 / abort 不是「答完」，继续等 PC。
  if (winner.value !== null) {
    return winner.value
  }
  deps.log('[question] IM 未在超时内答完，继续等待 PC 端')
  const pcResult = await pc
  if (pcResult.value === null) {
    // 两边都没人答完：按超时 / abort 抛错，交给上层。
    throw new DOMException('Aborted', 'AbortError')
  }
  return pcResult.value
}
