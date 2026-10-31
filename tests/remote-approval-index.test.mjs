import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupRemoteApproval } from '../lib/remote-approval/index.js'

const BASE = '/api/michengai/dsh-im-connect/remote-approval'

/** 构造一个能驱动 setupRemoteApproval 的最小 Cordis ctx mock。 */
function makeCtx(overrides = {}) {
  const listeners = []
  const effects = []
  const ctx = {
    get: (name) => (overrides.services ?? {})[name],
    on: (name, fn, opts) => {
      listeners.push({ name, fn, opts })
      return () => { listeners.length = 0 }
    },
    effect: (fn, label) => {
      effects.push({ fn, label })
      return () => {}
    },
    webServer: overrides.webServer,
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

function makeOptions(bridge, overrides = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'ra-setup-'))
  return {
    bridge,
    enabled: overrides.enabled !== false,
    timeoutSecs: 300,
    stateDir,
    log: () => {},
  }
}

test('setupRemoteApproval enabled=false 返回空注销，不访问任何服务', () => {
  const bridge = makeBridge()
  const ctx = makeCtx({ services: {}, webServer: { register: () => { throw new Error('不应注册 API') } } })
  const dispose = setupRemoteApproval(ctx, makeOptions(bridge, { enabled: false }))
  assert.doesNotThrow(() => dispose())
  assert.equal(ctx.listeners.length, 0)
  assert.equal(bridge.inboundHandlers.length, 0)
  assert.equal(ctx.effects.length, 0)
})

test('setupRemoteApproval 正常路径注册审批/提问 answerer、入站认领与 API，并正确注销', () => {
  const bridge = makeBridge()
  const webServer = {
    register: (route) => {
      assert.equal(route.kind, 'prefix')
      assert.equal(route.path, BASE)
      assert.equal(typeof route.handler, 'function')
      return () => {}
    },
  }
  const ctx = makeCtx({ services: {}, webServer })

  const dispose = setupRemoteApproval(ctx, makeOptions(bridge))

  // 两个 answerer 监听器都注册了，且带 prepend+global。
  const names = ctx.listeners.map((l) => l.name).sort()
  assert.deepEqual(names, ['approval/request', 'user-questions/request'])
  for (const l of ctx.listeners) {
    assert.deepEqual(l.opts, { prepend: true, global: true })
  }

  // 入站认领钩子已挂到 fork 的 onInbound。
  assert.equal(bridge.inboundHandlers.length, 1)

  // 清理 effect 已注册。
  assert.equal(ctx.effects.length, 1)
  assert.equal(ctx.effects[0].label, 'dsh-remote-approval.dispose')

  // 执行返回的注销函数后，监听器与入站钩子被清空。
  dispose()
  assert.equal(ctx.listeners.length, 0)
  assert.equal(bridge.inboundHandlers.length, 0)
})

test('setupRemoteApproval 缺少 webServer 时仍能注册 answerer 与入站（管理 API 静默跳过）', () => {
  const bridge = makeBridge()
  const ctx = makeCtx({ services: {}, webServer: undefined })

  assert.doesNotThrow(() => setupRemoteApproval(ctx, makeOptions(bridge)))
  assert.equal(ctx.listeners.length, 2)
  assert.equal(bridge.inboundHandlers.length, 1)
})
