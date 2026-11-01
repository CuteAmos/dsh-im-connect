/**
 * remote-approval 组件：把 Web 发起任务的人工审批 / 引导提问推送到 IM 完成。
 *
 * 作为 dsh-im-connect 包内的独立 cordis 子插件（说明符
 * `@michengai/dsh-im-connect/remote-approval`）加载：插件管理的「包含的组件」
 * 会为它单独显示一行开关，开关即控制本插件的 fiber enable/disable，从而控制
 * 移动端审批（answerer）与管理 API 是否注册。`inject:['imConnect','webServer']`
 * 是硬依赖：imConnect 由 fork 主插件 `ctx.provide('imConnect')` 提供，webServer
 * 由 Host 提供（registerApi 里以 `ctx.webServer` 属性访问，必须在 inject 声明）。
 * 因此关闭 im-connect 组件时本组件也会随之停用，不破坏 im-connect 原有功能。
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

/** `setupRemoteApproval` 的入参；全部由 fork apply 显式提供。 */
export interface RemoteApprovalOptions {
  bridge: ImConnectBridge
  enabled: boolean
  timeoutSecs: number
  /** state.json 所在目录（默认 %DSH_HOME%/dsh-remote-approval）。 */
  stateDir: string
  log(line: string): void
}

/**
 * 装配 remote-approval 组件：注册审批 / 提问 answerer（prepend + global）、
 * 入站认领钩子与管理 API。返回一次性注销函数，供 fork 的 dispose 链调用。
 */
export function setupRemoteApproval(ctx: Context, options: RemoteApprovalOptions): () => void {
  if (options.enabled === false) return () => {}

  const state = new StateStore(join(options.stateDir, 'state.json'))
  const pending = new PendingTable()
  const questions = new QuestionPending()
  const readBinding = () => state.read()
  const deps = {
    bridge: options.bridge,
    pending,
    questions,
    timeoutSecs: options.timeoutSecs,
    readBinding,
    log: options.log,
  }

  // fork 对 ctx.on 的自定义事件名同样用 unknown 强转绕过 Cordis 的 Events 类型表
  // （见 fork gateway.ts:214）。prepend + global 与 fork im-connect 对齐，确保排到
  // api-remotes（Web UI 审批卡转发层，push 追加）之前——api-remotes 在 Web 卡有消费者
  // 时不会调用 next()，会短路其后的 answerer；prepend 后本组件在外层先收到，
  // IM 会话再靠 isImSessionId 显式 next() 交还 im-connect。
  // 与 fork gateway.ts:214 的 `if (this.ctx.on)` 一样防御：ctx 无 on（如某些测试
  // 或纯 API 宿主 mock）时跳过 answerer 注册，但仍挂入站钩子与管理 API。
  const on = typeof (ctx as { on?: unknown }).on === 'function'
    ? (ctx as unknown as { on: (name: string, fn: (...args: unknown[]) => unknown, opts?: unknown) => () => void }).on
    : undefined
  const noop = () => {}
  const offApproval = on
    ? on('approval/request', (req: unknown, next: unknown) => {
      return handleApproval(req as ApprovalRequestLike, next as () => Promise<unknown>, deps)
    }, { prepend: true, global: true })
    : noop
  const offQuestion = on
    ? on('user-questions/request', (req: unknown, next: unknown) => {
      return handleUserQuestions(req as UserQuestionRequestLike, next as () => Promise<UserQuestionAnswer>, deps)
    }, { prepend: true, global: true })
    : noop
  const offInbound = installInbound(deps)

  const offApi = registerApi(ctx, { bridge: options.bridge, state, log: options.log })

  if (typeof (ctx as { effect?: unknown }).effect === 'function') {
    ctx.effect(() => () => {
      offApproval()
      offQuestion()
      offInbound()
      offApi()
      pending.dispose()
      questions.dispose()
    }, 'dsh-remote-approval.dispose')
  }

  return () => {
    offApproval()
    offQuestion()
    offInbound()
    offApi()
    pending.dispose()
    questions.dispose()
  }
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

// ---------------------------------------------------------------------------
// 独立 cordis 子插件形态：插件管理「包含的组件」会为它显示一行「远程审批」开关。
// 开关 = 本 fiber 的 enable/disable；`inject:['imConnect']` 是硬依赖，因此
// 关闭 im-connect 组件时本组件也会停用，im-connect 原有审批逻辑不受影响。
// ---------------------------------------------------------------------------

export const name = '@michengai/dsh-im-connect/remote-approval'
// webServer 是硬依赖：registerApi 用 `ctx.webServer` 属性访问（与 fork manager.ts
// 的 registerApi 同款强转取法），Cordis 对未在 inject 声明的 service 属性访问会抛
// `cannot get property "webServer" without inject`，故必须在此声明。
export const inject = ['imConnect', 'webServer']

export interface RemoteApprovalConfig {
  enabled?: boolean
  timeoutSecs?: number
}

export const Config: Schema<RemoteApprovalConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用远程审批：把 Web 发起任务的人工审批 / 引导提问推送到配置的 IM 完成。'),
  timeoutSecs: Schema.number().min(1).default(300).description('审批 / 提问等待回复的超时（秒），超时视为取消。'),
})

export function apply(ctx: Context, config: RemoteApprovalConfig): void {
  // imConnect service 由 fork 在自身 apply 内 `ctx.provide('imConnect', bridge)`
  // 提供；本组件 inject:['imConnect'] 是硬依赖，此刻必然已就绪。
  const bridge = ctx.get('imConnect') as ImConnectBridge | undefined
  if (!bridge) {
    ctx.logger(name).error('未找到 imConnect service；远程审批保持禁用。')
    return
  }
  const stateDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-remote-approval')
  // setupRemoteApproval 内部已通过 ctx.effect 注册 dispose（label
  // 'dsh-remote-approval.dispose'），fiber 关闭时自动清理，无需再包一层。
  setupRemoteApproval(ctx, {
    bridge,
    enabled: config.enabled !== false,
    timeoutSecs: config.timeoutSecs ?? 300,
    stateDir,
    log: (line) => ctx.logger(name).info(line),
  })
}
