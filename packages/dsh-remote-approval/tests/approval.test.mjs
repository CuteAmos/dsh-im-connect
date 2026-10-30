import assert from 'node:assert/strict'
import test from 'node:test'
import { handleApproval } from '../lib/approval.js'
import { PendingTable } from '../lib/pending.js'

/** 极简 mock bridge：记录 send，可选抛错。 */
function makeBridge(overrides = {}) {
  const sent = []
  const bridge = {
    sent,
    send: async (accountId, chatId, text) => {
      if (overrides.sendError) throw new Error(overrides.sendError)
      sent.push({ accountId, chatId, text })
    },
    listAccounts: () => [],
    listChatTargets: () => [],
    onInbound: () => () => {},
  }
  return bridge
}

function makeDeps(overrides = {}) {
  const bridge = overrides.bridge ?? makeBridge()
  return {
    bridge,
    pending: overrides.pending ?? new PendingTable(),
    timeoutSecs: overrides.timeoutSecs ?? 300,
    readBinding: () => overrides.binding ?? { accountId: 'acc1', chatId: 'chat1' },
    log: () => {},
  }
}

const nextNever = async () => { throw new Error('next() 不应被调用') }

test('handleApproval 未绑定目标时回退 next()', async () => {
  const deps = makeDeps({ binding: { accountId: '', chatId: '' } })
  let called = false
  const result = await handleApproval({ toolName: 'bash' }, async () => { called = true; return 'fallback' }, deps)
  assert.equal(called, true)
  assert.equal(result, 'fallback')
})

test('handleApproval 完整通过：推送 → 等待 → allow 返回 allowed-once（新契约）', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const promise = handleApproval({ agent: { id: 'a1' }, toolName: 'bash', reason: 'r' }, nextNever, deps)
  // 等待推送完成
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(bridge.sent.length, 1)
  assert.equal(bridge.sent[0].accountId, 'acc1')
  assert.equal(bridge.sent[0].chatId, 'chat1')
  assert.match(bridge.sent[0].text, /工具：bash/)
  pending.activate('chat1')
  pending.answer('chat1', true)
  assert.equal(await promise, 'allowed-once')
})

test('handleApproval 拒绝返回 rejected（新契约）', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const promise = handleApproval({ agent: { id: 'a1' }, toolName: 'bash' }, nextNever, deps)
  await new Promise((r) => setTimeout(r, 0))
  pending.activate('chat1')
  pending.answer('chat1', false)
  assert.equal(await promise, 'rejected')
})

test('handleApproval 推送失败返回 rejected 并清理 pending', async () => {
  const bridge = makeBridge({ sendError: 'net down' })
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const result = await handleApproval({ agent: { id: 'a1' } }, nextNever, deps)
  assert.equal(result, 'rejected')
  assert.equal(pending.accountIdOf('chat1'), undefined)
})

test('handleApproval 旧契约（无 agent）返回 {behavior}', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const promise = handleApproval({ toolName: 'bash' }, nextNever, deps)
  await new Promise((r) => setTimeout(r, 0))
  pending.activate('chat1')
  pending.answer('chat1', true)
  assert.deepEqual(await promise, { behavior: 'allow' })
})

test('handleApproval 已有并发等待时拒绝', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  pending.waitApproval('chat1', 'acc1', 5000)
  const deps = makeDeps({ bridge, pending })
  const result = await handleApproval({ agent: { id: 'a1' } }, nextNever, deps)
  assert.equal(result, 'rejected')
  assert.equal(bridge.sent.length, 0)
})
