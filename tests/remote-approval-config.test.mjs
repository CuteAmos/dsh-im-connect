import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StateStore } from '../lib/remote-approval/config.js'

test('StateStore 读回写入的绑定', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new StateStore(join(dir, 'state.json'))
  store.write({ accountId: 'acc1', chatId: 'chat1' })
  assert.deepEqual(store.read(), { accountId: 'acc1', chatId: 'chat1' })
})

test('StateStore 缺失文件返回空绑定', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new StateStore(join(dir, 'missing.json'))
  assert.deepEqual(store.read(), { accountId: '', chatId: '' })
})

test('StateStore 损坏 JSON 返回空绑定', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'state.json')
  writeFileSync(file, '{broken', 'utf8')
  const store = new StateStore(file)
  assert.deepEqual(store.read(), { accountId: '', chatId: '' })
})
