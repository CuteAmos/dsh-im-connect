import assert from 'node:assert/strict'
import test from 'node:test'
import { handleApproval } from '../lib/remote-approval/approval.js'
import { PendingTable } from '../lib/remote-approval/pending.js'

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

/** PC 端无审批卡消费者：next() 返回 'unavailable'（api-remotes 无 Web 卡的语义）。 */
const nextUnavailable = async () => 'unavailable'

test('handleApproval 未绑定目标时回退 next()', async () => {
  const deps = makeDeps({ binding: { accountId: '', chatId: '' } })
  let called = false
  const result = await handleApproval({ toolName: 'bash' }, async () => { called = true; return 'fallback' }, deps)
  assert.equal(called, true)
  assert.equal(result, 'fallback')
})

test('handleApproval PC 弃权后等 IM：推送 → allow 返回 allowed-once（新契约）', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const promise = handleApproval({ agent: { id: 'a1' }, toolName: 'bash', reason: 'r' }, nextUnavailable, deps)
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
  const promise = handleApproval({ agent: { id: 'a1' }, toolName: 'bash' }, nextUnavailable, deps)
  await new Promise((r) => setTimeout(r, 0))
  pending.activate('chat1')
  pending.answer('chat1', false)
  assert.equal(await promise, 'rejected')
})

test('handleApproval 推送失败返回 rejected 并清理 pending', async () => {
  const bridge = makeBridge({ sendError: 'net down' })
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const result = await handleApproval({ agent: { id: 'a1' } }, nextUnavailable, deps)
  assert.equal(result, 'rejected')
  assert.equal(pending.accountIdOf('chat1'), undefined)
})

test('handleApproval 旧契约（无 agent）返回 {behavior}', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  const promise = handleApproval({ toolName: 'bash' }, nextUnavailable, deps)
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
  const result = await handleApproval({ agent: { id: 'a1' } }, nextUnavailable, deps)
  assert.equal(result, 'rejected')
  assert.equal(bridge.sent.length, 0)
})

test('handleApproval signal 已 abort 时不推送，直接返回 cancelled（新契约）', async () => {
  const bridge = makeBridge()
  const controller = new AbortController()
  controller.abort()
  const deps = makeDeps({ bridge })
  const result = await handleApproval({ agent: { id: 'a1' }, toolName: 'bash', signal: controller.signal }, nextUnavailable, deps)
  assert.equal(result, 'cancelled')
  assert.equal(bridge.sent.length, 0)
  assert.equal(deps.pending.accountIdOf('chat1'), undefined)
})

test('handleApproval IM 会话（im: 前缀）交还 next()，不推送', async () => {
  const bridge = makeBridge()
  const deps = makeDeps({ bridge })
  let called = false
  const result = await handleApproval({ agent: { id: 'a1', session: { id: 'im:qq_x:dm:1:chat1' } }, toolName: 'bash' }, async () => { called = true; return 'handled-by-im-connect' }, deps)
  assert.equal(called, true)
  assert.equal(result, 'handled-by-im-connect')
  assert.equal(bridge.sent.length, 0)
})

test('handleApproval IM 会话（dsh-im-session- 前缀）交还 next()，不推送', async () => {
  const bridge = makeBridge()
  const deps = makeDeps({ bridge })
  let called = false
  const result = await handleApproval({ agent: { id: 'a1', session: { id: 'dsh-im-session-abc' } }, toolName: 'bash' }, async () => { called = true; return 'handled-by-im-connect' }, deps)
  assert.equal(called, true)
  assert.equal(result, 'handled-by-im-connect')
  assert.equal(bridge.sent.length, 0)
})

test('handleApproval 超时（PC 弃权 + IM 超时）返回 cancelled 并推送超时通知', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending, timeoutSecs: 1 })
  const promise = handleApproval({ agent: { id: 'a1' }, toolName: 'bash' }, nextUnavailable, deps)
  await new Promise((r) => setTimeout(r, 0))
  pending.activate('chat1')
  const result = await promise
  assert.equal(result, 'cancelled')
  assert.equal(pending.accountIdOf('chat1'), undefined)
  // 审批提示 + 超时通知共两条
  assert.equal(bridge.sent.length, 2)
  assert.match(bridge.sent[1].text, /超时取消/)
})

test('handleApproval PC 先决：释放 IM 等待、推「无需二次审批」、返回 PC 结果', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  // next() 立即 resolve 'allowed-once'，模拟 Web 卡消费者批准。
  const result = await handleApproval({ agent: { id: 'a1' }, toolName: 'bash' }, async () => 'allowed-once', deps)
  assert.equal(result, 'allowed-once')
  assert.equal(pending.accountIdOf('chat1'), undefined)
  assert.equal(bridge.sent.length, 2)
  assert.match(bridge.sent[1].text, /已在 PC 端完成审批/)
})

test('handleApproval IM 先决：直接返回 allow 结果，PC 卡仍挂起', async () => {
  const bridge = makeBridge()
  const pending = new PendingTable()
  const deps = makeDeps({ bridge, pending })
  // next() 永不 settle，模拟 Web 卡挂起等用户；IM 先决。
  const promise = handleApproval({ agent: { id: 'a1' }, toolName: 'bash' }, () => new Promise(() => {}), deps)
  await new Promise((r) => setTimeout(r, 0))
  pending.activate('chat1')
  pending.answer('chat1', true)
  assert.equal(await promise, 'allowed-once')
  assert.equal(bridge.sent.length, 1)
})
