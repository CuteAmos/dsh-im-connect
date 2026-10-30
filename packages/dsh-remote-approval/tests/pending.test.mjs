import assert from 'node:assert/strict'
import test from 'node:test'
import { PendingTable } from '../lib/pending.js'

test('PendingTable 完整生命周期：wait → activate → answer', async () => {
  const table = new PendingTable()
  const wait = table.waitApproval('chat1', 'acc1', 5000)
  assert.ok(wait)
  assert.equal(table.accountIdOf('chat1'), 'acc1')
  assert.equal(table.isReady('chat1'), false)
  assert.equal(table.answer('chat1', true), false) // 未激活
  assert.equal(table.activate('chat1'), true)
  assert.equal(table.isReady('chat1'), true)
  assert.equal(table.answer('chat1', true), true)
  assert.equal(await wait, 'allow')
  assert.equal(table.accountIdOf('chat1'), undefined)
})

test('PendingTable 拒绝并发：同 chatId 已有等待返回 undefined', () => {
  const table = new PendingTable()
  const first = table.waitApproval('chat1', 'acc1', 5000)
  const second = table.waitApproval('chat1', 'acc1', 5000)
  assert.ok(first)
  assert.equal(second, undefined)
})

test('PendingTable 超时返回 timeout', async () => {
  const table = new PendingTable()
  const wait = table.waitApproval('chat1', 'acc1', 10)
  table.activate('chat1')
  assert.equal(await wait, 'timeout')
})

test('PendingTable abort 返回 undefined 并清理', async () => {
  const table = new PendingTable()
  const controller = new AbortController()
  const wait = table.waitApproval('chat1', 'acc1', 5000, controller.signal)
  controller.abort()
  assert.equal(await wait, undefined)
  assert.equal(table.accountIdOf('chat1'), undefined)
})

test('PendingTable cancel 与 dispose', async () => {
  const table = new PendingTable()
  const wait = table.waitApproval('chat1', 'acc1', 5000)
  assert.equal(table.cancel('chat1'), true)
  assert.equal(await wait, undefined)
  table.dispose()
})
