import assert from 'node:assert/strict'
import test from 'node:test'
import { testConnection, buildTestApprovalText, buildTestQuestionText } from '../lib/test.js'

function makeBridge(overrides = {}) {
  const sent = []
  const accounts = overrides.accounts ?? [{ accountId: 'acc1', platform: 'feishu', name: '飞书机器人', connected: true }]
  const targets = overrides.targets ?? [{ chatId: 'chat1', kind: 'dm', title: '私聊' }]
  const bridge = {
    sent,
    send: async (accountId, chatId, text) => {
      if (overrides.sendError) throw new Error(overrides.sendError)
      sent.push({ accountId, chatId, text })
    },
    listAccounts: () => accounts,
    listChatTargets: () => targets,
    onInbound: () => () => {},
  }
  return bridge
}

function makeDeps(bridge) {
  return { bridge, log: () => {} }
}

test('buildTestApprovalText 带【测试】前缀并含审批引导', () => {
  const text = buildTestApprovalText()
  assert.match(text, /^【测试】/)
  assert.match(text, /工具：测试工具/)
  assert.match(text, /批准/)
})

test('buildTestQuestionText 带【测试】前缀并含编号选项', () => {
  const text = buildTestQuestionText()
  assert.match(text, /^【测试】/)
  assert.match(text, /1\. 选项A/)
  assert.match(text, /2\. 选项B/)
})

test('testConnection 缺账号/缺目标直接失败且不推送', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  const noAccount = await testConnection(deps, { accountId: '', chatId: 'chat1' })
  assert.equal(noAccount.ok, false)
  assert.equal(bridge.sent.length, 0)

  const noChat = await testConnection(deps, { accountId: 'acc1', chatId: '' })
  assert.equal(noChat.ok, false)
  assert.equal(bridge.sent.length, 0)
})

test('testConnection 账号不存在/未连接时失败', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  const missing = await testConnection(deps, { accountId: 'nope', chatId: 'chat1' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /账号不存在/)

  const disconnected = makeBridge({ accounts: [{ accountId: 'acc1', platform: 'feishu', name: '飞书', connected: false }] })
  const result = await testConnection(makeDeps(disconnected), { accountId: 'acc1', chatId: 'chat1' })
  assert.equal(result.ok, false)
  assert.match(result.error, /账号未连接/)
})

test('testConnection 成功推两条并带命中绑定提示', async () => {
  const bridge = makeBridge()
  const deps = makeDeps(bridge)
  const result = await testConnection(deps, { accountId: 'acc1', chatId: 'chat1' })
  assert.equal(result.ok, true)
  assert.equal(result.approvalPushed, true)
  assert.equal(result.questionPushed, true)
  assert.equal(bridge.sent.length, 2)
  assert.deepEqual(result.warnings, ['该目标命中历史绑定记录'])
})

test('testConnection 发送失败时返回失败并标记已推/未推', async () => {
  const bridge = makeBridge({ sendError: 'net down' })
  const deps = makeDeps(bridge)
  const result = await testConnection(deps, { accountId: 'acc1', chatId: 'chat1' })
  assert.equal(result.ok, false)
  assert.equal(result.approvalPushed, false)
  assert.equal(result.questionPushed, false)
  assert.match(result.error, /审批测试消息发送失败/)
})
