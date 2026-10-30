import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalVerdict } from '../lib/verdict.js'
import { buildApprovalPrompt } from '../lib/approval.js'

test('approvalVerdict 识别批准与拒绝词汇', () => {
  for (const word of ['批准', '同意', 'yes', 'y', 'allow', 'YES', 'Allow']) {
    assert.equal(approvalVerdict(word), 'allow', word)
  }
  for (const word of ['拒绝', '不同意', 'no', 'n', 'reject', 'deny', 'NO', 'Deny']) {
    assert.equal(approvalVerdict(word), 'reject', word)
  }
})

test('approvalVerdict 对无关文本返回 undefined', () => {
  assert.equal(approvalVerdict('随便'), undefined)
  assert.equal(approvalVerdict(''), undefined)
  assert.equal(approvalVerdict('批准了吧'), undefined)
})

test('buildApprovalPrompt 包含工具名、原因与引导语', () => {
  const prompt = buildApprovalPrompt({ toolName: 'bash', reason: '写入 /etc' }, 300)
  assert.match(prompt, /工具：bash/)
  assert.match(prompt, /原因：写入 \/etc/)
  assert.match(prompt, /批准/)
  assert.match(prompt, /5 分钟/)
})

test('buildApprovalPrompt 缺省工具名与原因', () => {
  const prompt = buildApprovalPrompt({}, 60)
  assert.match(prompt, /工具：工具操作/)
  assert.doesNotMatch(prompt, /原因：/)
  assert.match(prompt, /1 分钟/)
})
