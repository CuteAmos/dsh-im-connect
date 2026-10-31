import assert from 'node:assert/strict'
import test from 'node:test'
import { registerApi, readApiJsonBody } from '../lib/api.js'
import { StateStore } from '../lib/config.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'

/** 捕获 webServer.register handler 的 mock ctx。 */
function makeCtx(overrides = {}) {
  let handler = null
  const ctx = {
    get: (name) => (name === 'connection' ? overrides.connection ?? { requestRejection: () => undefined } : undefined),
    webServer: {
      register: (route) => {
        assert.equal(route.kind, 'prefix')
        assert.equal(route.path, '/api/dsh-remote-approval')
        handler = route.handler
        return () => { handler = null }
      },
    },
    get handler() { return handler },
  }
  return ctx
}

function makeBridge(overrides = {}) {
  const sent = []
  const accounts = overrides.accounts ?? [{ accountId: 'acc1', platform: 'feishu', name: '飞书', connected: true }]
  const targets = overrides.targets ?? [{ chatId: 'chat1', kind: 'dm', title: '私聊' }]
  return {
    sent,
    send: async (accountId, chatId, text) => { sent.push({ accountId, chatId, text }) },
    listAccounts: () => accounts,
    listChatTargets: () => targets,
    onInbound: () => () => {},
  }
}

function makeDeps(bridge, state) {
  return { bridge, state, log: () => {} }
}

/** 构造一个可调用 handler 的假 req/res。 */
function makeRequest(method, path, options = {}) {
  const headers = options.headers ?? {}
  const res = {
    status: 0,
    body: undefined,
    writeHead(status, headers) { this.status = status; this._headers = headers },
    end(payload) { this.body = payload },
  }
  const req = {
    method,
    url: path,
    headers,
  }
  return { req, res }
}

async function invoke(handler, method, path, options = {}) {
  const { req, res } = makeRequest(method, path, options)
  if (options.body !== undefined) {
    const stream = Readable.from([Buffer.from(options.body)])
    req.on = stream.on.bind(stream)
    req.pipe = stream.pipe.bind(stream)
  } else {
    const empty = Readable.from([])
    req.on = empty.on.bind(empty)
  }
  await handler(req, res)
  return { status: res.status, body: res.body === undefined ? undefined : JSON.parse(res.body) }
}

test('registerApi 未认证请求返回 401', async () => {
  const ctx = makeCtx({ connection: { requestRejection: () => 401 } })
  registerApi(ctx, makeDeps(makeBridge(), new StateStore(join(mkdtempSync(join(tmpdir(), 'ra-')), 's.json'))))
  const result = await invoke(ctx.handler, 'GET', '/api/dsh-remote-approval/state')
  assert.equal(result.status, 401)
  assert.equal(result.body.ok, false)
})

test('registerApi 写请求缺 client 头返回 403', async () => {
  const state = new StateStore(join(mkdtempSync(join(tmpdir(), 'ra-')), 's.json'))
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), state))
  const result = await invoke(ctx.handler, 'POST', '/api/dsh-remote-approval/state', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: 'acc1', chatId: 'chat1' }),
  })
  assert.equal(result.status, 403)
  assert.equal(result.body.error, 'forbidden mutation request')
})

test('registerApi GET state 返回当前绑定', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-'))
  const state = new StateStore(join(dir, 's.json'))
  state.write({ accountId: 'acc1', chatId: 'chat1' })
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), state))
  const result = await invoke(ctx.handler, 'GET', '/api/dsh-remote-approval/state')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.state, { accountId: 'acc1', chatId: 'chat1' })
  rmSync(dir, { recursive: true, force: true })
})

test('registerApi POST state 写绑定并返回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-'))
  const state = new StateStore(join(dir, 's.json'))
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), state))
  const result = await invoke(ctx.handler, 'POST', '/api/dsh-remote-approval/state', {
    headers: { 'content-type': 'application/json', 'x-dsh-im-connect-client': '1' },
    body: JSON.stringify({ accountId: 'acc1', chatId: 'chat2' }),
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.state, { accountId: 'acc1', chatId: 'chat2' })
  assert.deepEqual(state.read(), { accountId: 'acc1', chatId: 'chat2' })
  rmSync(dir, { recursive: true, force: true })
})

test('registerApi POST state 账号不存在返回 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-'))
  const state = new StateStore(join(dir, 's.json'))
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), state))
  const result = await invoke(ctx.handler, 'POST', '/api/dsh-remote-approval/state', {
    headers: { 'content-type': 'application/json', 'x-dsh-im-connect-client': '1' },
    body: JSON.stringify({ accountId: 'nope', chatId: 'chat1' }),
  })
  assert.equal(result.status, 400)
  assert.equal(result.body.ok, false)
  assert.deepEqual(state.read(), { accountId: '', chatId: '' })
  rmSync(dir, { recursive: true, force: true })
})

test('registerApi GET accounts 返回账号列表', async () => {
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), new StateStore(join(mkdtempSync(join(tmpdir(), 'ra-')), 's.json'))))
  const result = await invoke(ctx.handler, 'GET', '/api/dsh-remote-approval/accounts')
  assert.equal(result.status, 200)
  assert.equal(result.body.accounts.length, 1)
  assert.equal(result.body.accounts[0].accountId, 'acc1')
})

test('registerApi GET targets 按 accountId 过滤', async () => {
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), new StateStore(join(mkdtempSync(join(tmpdir(), 'ra-')), 's.json'))))
  const result = await invoke(ctx.handler, 'GET', '/api/dsh-remote-approval/targets?accountId=acc1')
  assert.equal(result.status, 200)
  assert.equal(result.body.targets.length, 1)
  assert.equal(result.body.targets[0].chatId, 'chat1')
})

test('registerApi POST test 推送两条测试消息', async () => {
  const bridge = makeBridge()
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(bridge, new StateStore(join(mkdtempSync(join(tmpdir(), 'ra-')), 's.json'))))
  const result = await invoke(ctx.handler, 'POST', '/api/dsh-remote-approval/test', {
    headers: { 'content-type': 'application/json', 'x-dsh-im-connect-client': '1' },
    body: JSON.stringify({ accountId: 'acc1', chatId: 'chat1' }),
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.approvalPushed, true)
  assert.equal(result.body.questionPushed, true)
  assert.equal(bridge.sent.length, 2)
})

test('registerApi 未知路由返回 404', async () => {
  const ctx = makeCtx()
  registerApi(ctx, makeDeps(makeBridge(), new StateStore(join(mkdtempSync(join(tmpdir(), 'ra-')), 's.json'))))
  const result = await invoke(ctx.handler, 'GET', '/api/dsh-remote-approval/nope')
  assert.equal(result.status, 404)
  assert.equal(result.body.error, 'not found')
})

test('readApiJsonBody 解析 JSON、拒绝非对象、标记超限', async () => {
  const json = await readApiJsonBody(Readable.from([Buffer.from('{"a":1}')]))
  assert.deepEqual(json, { body: { a: 1 }, oversized: false, invalidJson: false })

  const empty = await readApiJsonBody(Readable.from([Buffer.from('')]))
  assert.deepEqual(empty.body, {})

  const invalid = await readApiJsonBody(Readable.from([Buffer.from('[1,2]')]))
  assert.equal(invalid.invalidJson, true)

  const bad = await readApiJsonBody(Readable.from([Buffer.from('{oops')]))
  assert.equal(bad.invalidJson, true)

  const big = await readApiJsonBody(Readable.from([Buffer.from('x'.repeat(1024 * 1024 + 10))]), 1024 * 1024)
  assert.equal(big.oversized, true)
})
