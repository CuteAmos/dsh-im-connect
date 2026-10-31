/**
 * dsh-remote-approval Host：把 Web 发起任务的人工审批推送到 IM 完成。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StateStore } from './config.js'
import { PendingTable } from './pending.js'
import { QuestionPending } from './question.js'
import { handleApproval } from './approval.js'
import { handleUserQuestions } from './question-handler.js'
import { installInbound } from './inbound.js'
import { registerApi } from './api.js'
import type { ApprovalRequestLike } from './verdict.js'
import type { UserQuestionAnswer, UserQuestionRequestLike } from './question.js'
import type { ImConnectBridge } from './types.js'

export const name = 'dsh-remote-approval'
// imConnect 不能放进数组 inject：数组是 Cordis 硬依赖，任一 service 未提供时
// 整个 fiber 停在 INACTIVE、apply 根本不会被调用，「未安装 fork 时优雅降级」
// 就变成不可达代码。改为 apply 内 ctx.get('imConnect') 手动获取，配合
// cordis.patch.yml 的加载顺序（排 im-connect 之后，其 apply 内同步 provide）拿到。
export const inject = ['webServer']

export interface PluginConfig {
  enabled: boolean
  timeoutSecs: number
}

export const Config: Schema<PluginConfig> = Schema.object({
  enabled: Schema.boolean().default(true),
  timeoutSecs: Schema.number().min(1).default(300).description('审批等待上限（秒），到期按取消处理。'),
})

export function apply(ctx: Context, config: PluginConfig): void {
  if (config.enabled === false) return
  const bridge = ctx.get('imConnect') as ImConnectBridge | undefined
  if (!bridge) {
    ctx.logger(name).error('未找到 imConnect service；请确认已安装 fork 的 dsh-im-connect。远程审批已禁用。')
    return
  }

  const stateDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-remote-approval')
  const state = new StateStore(join(stateDir, 'state.json'))
  const pending = new PendingTable()
  const questions = new QuestionPending()
  const log = (line: string) => ctx.logger(name).info(line)

  const readBinding = () => state.read()
  const deps = { bridge, pending, questions, timeoutSecs: config.timeoutSecs, readBinding, log }

  // fork 对 ctx.on 的自定义事件名同样用 unknown 强转绕过 Cordis 的 Events 类型表（见 gateway.ts:214）。
  const on = (ctx as unknown as { on: (name: string, fn: (...args: unknown[]) => unknown, opts?: unknown) => () => void }).on
  const offApproval = on('approval/request', (req: unknown, next: unknown) => {
    return handleApproval(req as ApprovalRequestLike, next as () => Promise<unknown>, deps)
  })
  const offQuestion = on('user-questions/request', (req: unknown, next: unknown) => {
    return handleUserQuestions(req as UserQuestionRequestLike, next as () => Promise<UserQuestionAnswer>, deps)
  })
  const offInbound = installInbound(deps)

  registerApi(ctx, { bridge, state, log })

  ctx.effect(() => () => {
    offApproval()
    offQuestion()
    offInbound()
    pending.dispose()
    questions.dispose()
  }, 'dsh-remote-approval.dispose')
}

export { StateStore } from './config.js'
export { PendingTable } from './pending.js'
export { QuestionPending } from './question.js'
export { approvalVerdict } from './verdict.js'
export { buildApprovalPrompt } from './approval.js'
export { registerApi, readApiJsonBody } from './api.js'
export { testConnection, buildTestApprovalText, buildTestQuestionText } from './test.js'
export { validUserQuestion, formatUserQuestion, answerUserQuestion } from './question.js'
export type { ImConnectBridge, ImConnectBridgeAccount, ImConnectBridgeChatTarget, ImMessage, InboundHandler } from './types.js'
export type { UserQuestionOption, UserQuestionItem, UserQuestionAnswerItem, UserQuestionAnswer } from './question.js'
