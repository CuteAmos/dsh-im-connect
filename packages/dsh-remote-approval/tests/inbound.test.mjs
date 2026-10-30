import assert from 'node:assert/strict'
import test from 'node:test'
import { installInbound } from '../lib/inbound.js'
import { PendingTable } from '../lib/pending.js'

/** 捕获 onInbound 注册的 handler 的 mock bridge。 */
function makeBridge() {
  let handler = null
  const bridge = {
    onInbound: (h) => {
      handler = h
      return () => { handler = null }
    },
    get handler() { return handler },
    listAccounts: () => [],
    listChatTargets: () => [],
    send: async () => {},
  }
  return bridge
}

function makeDeps(bridge, binding = { accountId: 'acc1', chatId: 'chat1' }) {
  return {
    bridge,
    pending: new PendingTable(),
    readBinding: () => binding,
    log: () => {},
  }
}

test('installInbound 命中审批回复时认领并 answer', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  const off = installInbound(deps)
  const msg = { chatId: 'chat1', text: '批准', messageId: 'm1' }
  deps.pending.waitApproval('chat1', 'acc1', 5000)
  deps.pending.activate('chat1')
  const handled = await bridge.handler('acc1', msg)
  assert.equal(handled, true)
  assert.equal(deps.pending.accountIdOf('chat1'), undefined)
  off()
})

test('installInbound 不认领无关文本 / 错账号 / 错 chatId', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  installInbound(deps)
  deps.pending.waitApproval('chat1', 'acc1', 5000)
  deps.pending.activate('chat1')
  assert.equal(await bridge.handler('acc1', { chatId: 'chat1', text: '随便' }), false)
  assert.equal(await bridge.handler('acc2', { chatId: 'chat1', text: '批准' }), false)
  assert.equal(await bridge.handler('acc1', { chatId: 'chat9', text: '批准' }), false)
  // 尚未被认领，等待仍在
  assert.equal(deps.pending.accountIdOf('chat1'), 'acc1')
})

test('installInbound 未激活时不认领', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  installInbound(deps)
  deps.pending.waitApproval('chat1', 'acc1', 5000) // 未 activate
  assert.equal(await bridge.handler('acc1', { chatId: 'chat1', text: '批准' }), false)
  assert.equal(deps.pending.accountIdOf('chat1'), 'acc1')
})

test('installInbound 注销后不再认领', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  const off = installInbound(deps)
  deps.pending.waitApproval('chat1', 'acc1', 5000)
  deps.pending.activate('chat1')
  off()
  assert.equal(bridge.handler, null)
})
