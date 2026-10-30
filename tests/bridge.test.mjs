import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChannelManager } from '../lib/manager.js'
import { ImConnectBridgeService } from '../lib/bridge.js'

/** 构造一个 ChannelManager 与 ImConnectBridgeService；返回可直接操作底层私有字段的句柄。 */
function setup(t) {
  const stateDir = mkdtempSync(join(tmpdir(), 'im-bridge-'))
  const manager = new ChannelManager({
    ctx: { permissionPresets: { names: ['review'], defaultPreset: 'review', optionOf: name => ({ value: name, name }) } },
    stateDir, log() {}, engineConfig: { cwd: stateDir, provider: 'p', model: 'm', agentPreset: 'standard', mergeTimeoutSecs: 1, permissionPreset: 'review' },
  })
  const bridge = new ImConnectBridgeService(manager)
  t.after(() => { manager.disposeApi(); rmSync(stateDir, { recursive: true, force: true }) })
  return { manager, bridge, stateDir }
}

test('bridge.listAccounts 不含凭据且只在已连接时 connected=true', async t => {
  const { manager, bridge } = setup(t)
  // 账号列表来自 store.channels，connected 来自 running 中的适配器状态。
  manager.store.channels['telegram_test'] = {
    id: 'telegram_test', platform: 'telegram', enabled: true, receiveEnabled: true, config: {},
  }
  manager.running.set('telegram_test', {
    id: 'telegram_test', label: 'Telegram', maxMessageLength: 4000,
    start() {}, stop() {},
    async send() {},
    setMessageHandler() {},
    status() { return '已连接' },
  })
  const accounts = bridge.listAccounts()
  assert.deepEqual(accounts, [
    { accountId: 'telegram_test', platform: 'telegram', name: 'Telegram账号 1', connected: true },
  ])
  // 任何返回字段都不应包含敏感键。
  for (const account of accounts) {
    const keys = Object.keys(account)
    for (const key of keys) assert.ok(!/secret|token/i.test(key))
  }
})

test('bridge.listChatTargets 只返回该账号的会话并按 chatId 去重', async t => {
  const { manager, bridge } = setup(t)
  const rec = (channel, kind, chatId, title) => ({
    channel, kind, chatId, title,
    sessionId: `${channel}:${kind}:${chatId}`,
    updatedAt: '2026-09-07T00:00:00.000Z',
  })
  manager.sessions.upsert('telegram_test:dm:user-1', rec('telegram_test', 'dm', 'user-1', '与用户一'))
  manager.sessions.upsert('telegram_test:dm:user-1-dup', rec('telegram_test', 'dm', 'user-1', '与用户一（重复）'))
  manager.sessions.upsert('telegram_test:group:chat-9', rec('telegram_test', 'group', 'chat-9', '群'))
  manager.sessions.upsert('weixin_other:dm:other', rec('weixin_other', 'dm', 'other', '别的账号'))

  const targets = bridge.listChatTargets('telegram_test')
  assert.deepEqual(targets, [
    { chatId: 'user-1', kind: 'dm', title: '与用户一' },
    { chatId: 'chat-9', kind: 'group', title: '群' },
  ])
})

test('bridge.send 账号未连接时抛错', async t => {
  const { bridge } = setup(t)
  await assert.rejects(bridge.send('missing', 'chat', 'hello'), /未连接或不存在/)
})

test('bridge.send 委托到该账号的 adapter.send', async t => {
  const { manager, bridge } = setup(t)
  const sent = []
  manager.running.set('telegram_test', {
    id: 'telegram_test', label: 'Telegram', maxMessageLength: 4000,
    start() {}, stop() {},
    async send(chatId, text) { sent.push({ chatId, text }) },
    setMessageHandler() {},
    status() { return '已连接' },
  })
  await bridge.send('telegram_test', 'user-1', '你好')
  assert.deepEqual(sent, [{ chatId: 'user-1', text: '你好' }])
})

test('bridge.onInbound 钩子在授权判定前执行，返回 true 时短路、false 时放行', async t => {
  const { manager, bridge } = setup(t)
  const received = []
  const sent = []
  let claimNext = false
  const off = bridge.onInbound((accountId, msg) => {
    received.push({ accountId, text: msg.text })
    return claimNext
  })
  let inbound
  manager.engine.register({
    id: 'telegram_test', label: 'Telegram', maxMessageLength: 4000,
    start() {}, stop() {},
    async send(chatId, text) { sent.push({ chatId, text }) },
    setMessageHandler(handler) { inbound = handler },
    status() { return '已连接' },
  })
  // 不加白名单：普通消息应触发 deny → 未授权提示；被认领的消息则完全绕过授权判定。
  const send = (text, messageId) => inbound({ chatId: 'user-1', userId: 'user-1', text, kind: 'dm', messageId })

  // 未认领：钩子返回 false，继续走 decideAccess → deny → 发送未授权提示。
  await send('普通消息', 'm1')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(received, [{ accountId: 'telegram_test', text: '普通消息' }])
  assert.ok(sent.some(item => item.text.includes('未授权')))

  // 认领：钩子返回 true，引擎短路，不再发送任何未授权提示。
  claimNext = true
  await send('认领我', 'm2')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(received, [
    { accountId: 'telegram_test', text: '普通消息' },
    { accountId: 'telegram_test', text: '认领我' },
  ])
  assert.equal(sent.length, 1)

  off()
  assert.equal(manager.engine.inboundHandlers.size, 0)
})
