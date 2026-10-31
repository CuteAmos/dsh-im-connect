import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'

/** 构造一个能驱动 apply 的最小 Cordis ctx mock。 */
function makeCtx(overrides = {}) {
  const errors = []
  const infos = []
  const listeners = []
  const effects = []
  const ctx = {
    logger: () => ({
      error: (line) => errors.push(line),
      info: (line) => infos.push(line),
    }),
    get: (name) => (overrides.services ?? {})[name],
    on: (name, fn) => {
      listeners.push({ name, fn })
      return () => { listeners.length = 0 }
    },
    effect: (fn, label) => {
      effects.push({ fn, label })
      return () => {}
    },
    webServer: overrides.webServer,
    get errors() { return errors },
    get infos() { return infos },
    get listeners() { return listeners },
    get effects() { return effects },
  }
  return ctx
}

function makeBridge() {
  const inboundHandlers = []
  return {
    listAccounts: () => [],
    listChatTargets: () => [],
    send: async () => {},
    onInbound: (handler) => {
      inboundHandlers.push(handler)
      return () => { inboundHandlers.length = 0 }
    },
    get inboundHandlers() { return inboundHandlers },
  }
}

test('apply：enabled=false 直接返回，不访问任何服务', () => {
  let getCalls = 0
  const ctx = {
    get: () => { getCalls++ },
    logger: () => { throw new Error('不应访问 logger') },
  }
  apply(ctx, { enabled: false, timeoutSecs: 300 })
  assert.equal(getCalls, 0)
})

test('apply：未安装 im-connect 时 logger.error 后优雅禁用，不抛异常', () => {
  const ctx = makeCtx({ services: {} })
  assert.doesNotThrow(() => apply(ctx, { enabled: true, timeoutSecs: 300 }))
  assert.ok(ctx.errors.some((line) => line.includes('未找到 imConnect service')))
  assert.equal(ctx.listeners.length, 0)
  assert.equal(ctx.effects.length, 0)
})

test('apply：imConnect 缺失但 webServer 存在时，仍不注册 answerer（降级路径）', () => {
  const webServer = { register: () => () => {} }
  const ctx = makeCtx({ services: {}, webServer })
  apply(ctx, { enabled: true, timeoutSecs: 300 })
  assert.ok(ctx.errors.some((line) => line.includes('未找到 imConnect service')))
  assert.equal(ctx.listeners.length, 0)
})

test('apply：正常路径注册审批/提问 answerer、入站认领与 API，并正确注销', () => {
  const bridge = makeBridge()
  const webServer = {
    register: (route) => {
      assert.equal(route.kind, 'prefix')
      assert.equal(route.path, '/api/dsh-remote-approval')
      assert.equal(typeof route.handler, 'function')
      return () => {}
    },
  }
  const ctx = makeCtx({ services: { imConnect: bridge }, webServer })

  apply(ctx, { enabled: true, timeoutSecs: 300 })

  // 两个 answerer 监听器都注册了。
  const names = ctx.listeners.map((l) => l.name).sort()
  assert.deepEqual(names, ['approval/request', 'user-questions/request'])

  // 入站认领钩子已挂到 fork 的 onInbound。
  assert.equal(bridge.inboundHandlers.length, 1)

  // 清理 effect 已注册。
  assert.equal(ctx.effects.length, 1)
  assert.equal(ctx.effects[0].label, 'dsh-remote-approval.dispose')

  // 执行注销回调后，监听器被清空。
  ctx.effects[0].fn()()
  assert.equal(ctx.listeners.length, 0)
  assert.equal(bridge.inboundHandlers.length, 0)
})

test('apply：缺少 webServer 时仍能注册 answerer 与入站（管理 API 静默跳过）', () => {
  const bridge = makeBridge()
  const ctx = makeCtx({ services: { imConnect: bridge }, webServer: undefined })

  assert.doesNotThrow(() => apply(ctx, { enabled: true, timeoutSecs: 300 }))
  assert.equal(ctx.listeners.length, 2)
  assert.equal(bridge.inboundHandlers.length, 1)
})
