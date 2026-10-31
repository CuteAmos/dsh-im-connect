import assert from 'node:assert/strict'
import test from 'node:test'
import { handleUserQuestions } from '../lib/question-handler.js'
import { QuestionPending } from '../lib/question.js'

function makeBridge(overrides = {}) {
  const sent = []
  const bridge = {
    sent,
    send: async (accountId, chatId, text) => {
      if (overrides.sendError) throw new Error(overrides.sendError)
      sent.push({ accountId, chatId, text })
    },
    listAccounts: () => [],
    listChatTargets: (accountId) => overrides.targets ?? [],
    onInbound: () => () => {},
  }
  return bridge
}

function makeDeps(overrides = {}) {
  const bridge = overrides.bridge ?? makeBridge()
  return {
    bridge,
    questions: overrides.questions ?? new QuestionPending(),
    timeoutSecs: overrides.timeoutSecs ?? 300,
    readBinding: () => overrides.binding ?? { accountId: 'acc1', chatId: 'chat1' },
    log: () => {},
  }
}

const nextNever = async () => { throw new Error('next() 不应被调用') }

test('handleUserQuestions 未绑定目标时回退 next()', async () => {
  const deps = makeDeps({ binding: { accountId: '', chatId: '' } })
  let called = false
  const result = await handleUserQuestions({ questions: [{ id: 'q1', question: 'x' }] }, async () => { called = true; return { answers: [] } }, deps)
  assert.equal(called, true)
  assert.deepEqual(result, { answers: [] })
})

test('handleUserQuestions 非法 questions 直接 throw', async () => {
  const deps = makeDeps()
  await assert.rejects(handleUserQuestions({ questions: [] }, nextNever, deps), /无法在当前聊天展示这个问题/)
  await assert.rejects(handleUserQuestions({ questions: [null] }, nextNever, deps), /无法在当前聊天展示这个问题/)
})

test('handleUserQuestions 推送 → 群聊带 @ → 答案回流', async () => {
  const bridge = makeBridge({ targets: [{ chatId: 'chat1', kind: 'group', title: '群' }] })
  const questions = new QuestionPending()
  const deps = makeDeps({ bridge, questions })
  const promise = handleUserQuestions({ questions: [{ id: 'q1', question: '吃什么', options: [{ label: '饭' }] }] }, nextNever, deps)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(bridge.sent.length, 1)
  assert.match(bridge.sent[0].text, /@机器人/)
  assert.match(bridge.sent[0].text, /1\. 饭/)
  questions.activate('chat1')
  questions.answer('chat1', '饭')
  assert.deepEqual(await promise, { answers: [{ id: 'q1', selected: ['饭'] }] })
})

test('handleUserQuestions 推送失败 cancel + throw', async () => {
  const bridge = makeBridge({ sendError: '网络错误' })
  const deps = makeDeps({ bridge })
  await assert.rejects(
    handleUserQuestions({ questions: [{ id: 'q1', question: 'x' }] }, nextNever, deps),
    /交互问题未能发送到原聊天/,
  )
})

test('handleUserQuestions signal.aborted 直接 throw', async () => {
  const deps = makeDeps()
  const controller = new AbortController()
  controller.abort(new DOMException('Aborted', 'AbortError'))
  await assert.rejects(handleUserQuestions({ questions: [{ id: 'q1', question: 'x' }], signal: controller.signal }, nextNever, deps), /Aborted/)
})

test('handleUserQuestions IM 会话（im: 前缀）交还 next()，不推送', async () => {
  const deps = makeDeps()
  let called = false
  const result = await handleUserQuestions(
    { agent: { id: 'a1', session: { id: 'im:qq_x:dm:1:chat1' } }, questions: [{ id: 'q1', question: 'x' }] },
    async () => { called = true; return { answers: [] } },
    deps,
  )
  assert.equal(called, true)
  assert.deepEqual(result, { answers: [] })
  assert.equal(deps.bridge.sent.length, 0)
})

test('handleUserQuestions IM 会话（dsh-im-session- 前缀）交还 next()，不推送', async () => {
  const deps = makeDeps()
  let called = false
  const result = await handleUserQuestions(
    { agent: { id: 'a1', session: { id: 'dsh-im-session-abc' } }, questions: [{ id: 'q1', question: 'x' }] },
    async () => { called = true; return { answers: [] } },
    deps,
  )
  assert.equal(called, true)
  assert.deepEqual(result, { answers: [] })
  assert.equal(deps.bridge.sent.length, 0)
})
