import assert from 'node:assert/strict'
import test from 'node:test'
import { QuestionPending, validUserQuestion, formatUserQuestion, answerUserQuestion } from '../lib/remote-approval/question.js'

test('validUserQuestion 校验通过 / 拒绝非法项', () => {
  assert.equal(validUserQuestion({ id: 'q1', question: '吃什么' }), true)
  assert.equal(validUserQuestion({ id: 'q1', question: '吃什么', options: [{ label: '饭' }] }), true)
  assert.equal(validUserQuestion({ id: 'q1', question: '吃什么', multiSelect: true }), true)
  assert.equal(validUserQuestion(null), false)
  assert.equal(validUserQuestion({ id: 'q1' }), false)
  assert.equal(validUserQuestion({ id: 1, question: 'x' }), false)
  assert.equal(validUserQuestion({ id: 'q1', question: 'x', options: [{ label: 1 }] }), false)
  assert.equal(validUserQuestion({ id: 'q1', question: 'x', multiSelect: 'yes' }), false)
})

test('formatUserQuestion 单选渲染序号选项', () => {
  const text = formatUserQuestion({ id: 'q1', question: '吃什么', options: [{ label: '饭' }, { label: '面' }] }, 0, 1, {})
  assert.match(text, /吃什么/)
  assert.match(text, /1\. 饭/)
  assert.match(text, /2\. 面/)
  assert.doesNotMatch(text, /@机器人/)
})

test('formatUserQuestion 多问题带进度 / 群聊带 @ 提示', () => {
  const text = formatUserQuestion({ id: 'q2', question: '几点', options: [] }, 1, 3, { requiresMention: true })
  assert.match(text, /（2\/3）/)
  assert.match(text, /@机器人/)
})

test('answerUserQuestion 无选项走 custom', () => {
  assert.deepEqual(answerUserQuestion({ id: 'q1', question: 'x' }, '随便答'), { id: 'q1', selected: [], custom: '随便答' })
})

test('answerUserQuestion 单选命中序号或 label，未命中走 custom', () => {
  const q = { id: 'q1', question: 'x', options: [{ label: '饭' }, { label: '面' }] }
  assert.deepEqual(answerUserQuestion(q, '1'), { id: 'q1', selected: ['饭'] })
  assert.deepEqual(answerUserQuestion(q, '面'), { id: 'q1', selected: ['面'] })
  assert.deepEqual(answerUserQuestion(q, '其它'), { id: 'q1', selected: [], custom: '其它' })
})

test('answerUserQuestion 多选按逗号/顿号切分，其余进 custom', () => {
  const q = { id: 'q1', question: 'x', multiSelect: true, options: [{ label: '饭' }, { label: '面' }, { label: '汤' }] }
  assert.deepEqual(answerUserQuestion(q, '1,3'), { id: 'q1', selected: ['饭', '汤'] })
  assert.deepEqual(answerUserQuestion(q, '饭、面，汤'), { id: 'q1', selected: ['饭', '面', '汤'] })
  assert.deepEqual(answerUserQuestion(q, '1,加辣'), { id: 'q1', selected: ['饭'], custom: '加辣' })
})

test('QuestionPending 单题：begin → activate → answer 完成', async () => {
  const p = new QuestionPending()
  const wait = p.begin('chat1', 'acc1', [{ id: 'q1', question: 'x', options: [{ label: 'a' }] }], 5000)
  assert.ok(wait)
  assert.equal(p.accountIdOf('chat1'), 'acc1')
  assert.equal(p.isReady('chat1'), false)
  assert.deepEqual(p.answer('chat1', 'a'), { handled: true, waitingPresentation: true })
  assert.equal(p.activate('chat1'), true)
  const result = p.answer('chat1', 'a')
  assert.equal(result.handled, true)
  assert.equal(result.completed, true)
  assert.deepEqual(await wait, { answers: [{ id: 'q1', selected: ['a'] }] })
  assert.equal(p.accountIdOf('chat1'), undefined)
})

test('QuestionPending 多题逐题推进 next', async () => {
  const p = new QuestionPending()
  const qs = [{ id: 'q1', question: 'a' }, { id: 'q2', question: 'b', options: [{ label: 'B' }] }]
  const wait = p.begin('chat1', 'acc1', qs, 5000)
  p.activate('chat1')
  const first = p.answer('chat1', '答案一')
  assert.equal(first.handled, true)
  assert.equal(first.next.index, 1)
  assert.equal(first.next.total, 2)
  assert.equal(p.isReady('chat1'), false)
  p.activate('chat1')
  const second = p.answer('chat1', 'B')
  assert.equal(second.completed, true)
  assert.deepEqual(await wait, { answers: [{ id: 'q1', selected: [], custom: '答案一' }, { id: 'q2', selected: ['B'] }] })
})

test('QuestionPending 重入返回 undefined', () => {
  const p = new QuestionPending()
  const first = p.begin('chat1', 'acc1', [{ id: 'q1', question: 'x' }], 5000)
  assert.ok(first)
  assert.equal(p.begin('chat1', 'acc1', [{ id: 'q2', question: 'y' }], 5000), undefined)
})

test('QuestionPending 超时按 abort 拒绝', async () => {
  const p = new QuestionPending()
  const wait = p.begin('chat1', 'acc1', [{ id: 'q1', question: 'x' }], 10)
  await assert.rejects(wait, /Aborted/)
  assert.equal(p.accountIdOf('chat1'), undefined)
})

test('QuestionPending cancel 拒绝并清理', async () => {
  const p = new QuestionPending()
  const wait = p.begin('chat1', 'acc1', [{ id: 'q1', question: 'x' }], 5000)
  assert.equal(p.cancel('chat1', new Error('取消')), true)
  await assert.rejects(wait, /取消/)
  assert.equal(p.accountIdOf('chat1'), undefined)
})
