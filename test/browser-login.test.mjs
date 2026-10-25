import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserLogin, zhihuCookies, connectBrowser } from '../lib/browser-login.mjs'

const items = ['z_c0', '_xsrf', 'd_c0'].map((name) => ({ name, value: 'fixture-' + name, domain: '.zhihu.com', expires: -1 }))
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zhihu-browser-test-'))
  const cookieFile = join(root, 'cookies.json')
  const child = new EventEmitter(); child.kill = () => { child.killed = true }
  let closed = false, calls = 0, spawned
  const login = createBrowserLogin({ root, cookieFile, browser: 'mock-edge', intervalMs: 5,
    launch: (...args) => { spawned = args; return child }, verify: async () => true,
    connect: async () => ({ call: async (method) => { assert.equal(method, 'Storage.getCookies'); calls++; return { cookies: items } }, close: () => { closed = true } }), ...extra })
  return { login, root, cookieFile, child, stats: () => ({ closed, calls, spawned }) }
}

test('only complete unexpired Zhihu authentication cookies are accepted', () => {
  assert.ok(zhihuCookies(items))
  assert.equal(zhihuCookies(items.slice(1)), null)
  assert.equal(zhihuCookies(items.map((c) => ({ ...c, domain: 'evilzhihu.com' }))), null)
  assert.equal(zhihuCookies(items.map((c) => ({ ...c, expires: 1 }))), null)
  assert.deepEqual(Object.keys(zhihuCookies([...items, { name: 'other', domain: '.zhihu.com', value: 'secret' }])), ['z_c0', '_xsrf', 'd_c0'])
})

test('isolated browser login saves CLI-compatible credentials with rollback backup', async () => {
  const f = fixture()
  writeFileSync(f.cookieFile, 'original')
  f.login.start(); f.login.start(); await tick()
  assert.equal(f.login.snapshot().status, 'success')
  assert.equal(JSON.parse(readFileSync(f.cookieFile)).cookies.z_c0, 'fixture-z_c0')
  const backup = readdirSync(f.root).find((p) => p.includes('before-browser-'))
  assert.equal(readFileSync(join(f.root, backup), 'utf8'), 'original')
  assert.ok(f.stats().closed); assert.ok(f.child.killed)
  assert.equal(f.stats().calls, 1)
  const [,args,options] = f.stats().spawned
  assert.ok(args.some((arg) => arg.startsWith('--user-data-dir=' + f.root)))
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.equal(options.shell, false)
  assert.ok(!JSON.stringify(f.login.snapshot()).includes('fixture-z_c0'))
})

test('cancel ignores an in-flight cookie response and does not overwrite credentials', async () => {
  let resolve
  const f = fixture({ connect: async () => ({ call: () => new Promise((r) => { resolve = r }), close() {} }) })
  f.login.start(); await tick(); f.login.cancel()
  resolve({ cookies: items }); await tick()
  assert.equal(f.login.snapshot().status, 'cancelled')
  assert.equal(existsSync(f.cookieFile), false)
})

test('unavailable browser and startup timeout are explicit failures', async () => {
  const missing = fixture({ browser: null }); missing.login.start()
  assert.equal(missing.login.snapshot().status, 'error')
  const slow = fixture({ connect: async () => { throw Error('not ready') }, timeoutMs: 15 })
  slow.login.start(); await new Promise((r) => setTimeout(r, 30))
  assert.equal(slow.login.snapshot().status, 'expired'); assert.ok(slow.child.killed)
  assert.equal(existsSync(slow.cookieFile), false)
})

test('failed verification is never reported as connected', async () => {
  const f = fixture({ verify: async () => false }); f.login.start(); await tick()
  assert.equal(f.login.snapshot().status, 'error')
  assert.match(f.login.snapshot().message, /已保存/)
})

test('debug endpoint file cannot redirect to a foreign host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhihu-browser-endpoint-'))
  writeFileSync(join(root, 'DevToolsActivePort'), '9222\n//evil.example/')
  await assert.rejects(connectBrowser(root), /invalid endpoint/)
})
