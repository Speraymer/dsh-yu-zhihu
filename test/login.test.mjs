import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogin, stopLoginProcess } from '../lib/login.mjs'

function fixture(options = {}) {
  const children = []
  const login = createLogin({
    command: () => ({ file: 'mock-cli', args: ['login'] }), verify: async () => true,
    qrFile: join(mkdtempSync(join(tmpdir(), 'zhihu-qr-')), 'images', 'qr.png'),
    launch: (file, args, settings) => {
      assert.equal(file, 'mock-cli'); assert.equal(settings.shell, false)
      assert.equal(settings.windowsHide, true)
      const child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.killed = false; child.kill = () => { child.killed = true }
      children.push(child); return child
    }, ...options,
  })
  return { login, children }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('one login at a time; verify success, clear transient authorization data', async () => {
  const { login, children } = fixture()
  login.start(); login.start(); assert.equal(children.length, 1)
  assert.equal(login.snapshot().status, 'running')
  children[0].stdout.emit('data', Buffer.from('private_token=DO_NOT_EXPOSE'))
  assert.ok(!JSON.stringify(login.snapshot()).includes('DO_NOT_EXPOSE'))
  children[0].emit('close', 0); await tick()
  assert.equal(login.snapshot().status, 'success')
  assert.equal(login.snapshot().url, undefined); assert.equal(login.snapshot().qr, undefined)
})
test('cancel and retry ignore previous process completion', async () => {
  const { login, children } = fixture()
  login.start(); login.cancel(); assert.equal(children[0].killed, true)
  assert.equal(login.snapshot().status, 'cancelled')
  login.start(); children[0].emit('close', 0); await tick()
  assert.equal(login.snapshot().status, 'running')
  children[1].emit('close', 1); await tick(); assert.equal(login.snapshot().status, 'error')
})
test('spawn failures and failed account checks are not success', async () => {
  const broken = fixture({ launch() { throw Error('secret path') } }).login
  broken.start(); assert.equal(broken.snapshot().status, 'error')
  assert.ok(!JSON.stringify(broken.snapshot()).includes('secret path'))
  const { login, children } = fixture({ verify: async () => false })
  login.start(); children[0].emit('close', 0); await tick()
  assert.equal(login.snapshot().status, 'error')
})
test('timeout stops the child and cannot become success later', async () => {
  const { login, children } = fixture({ timeoutMs: 10 })
  login.start(); await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(login.snapshot().status, 'expired'); assert.equal(children[0].killed, true)
  children[0].emit('close', 0); await tick(); assert.equal(login.snapshot().status, 'expired')
})
test('only fresh fixed-path PNG is displayed; old QR is never reused', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'zhihu-login-test-')), 'qr.png')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFEkAAAAASUVORK5CYII=', 'base64')
  writeFileSync(file, png); utimesSync(file, 1, 1)
  const { login } = fixture({ qrFile: file })
  login.start(); assert.equal(login.snapshot().qr, undefined)
  writeFileSync(file, png); assert.match(login.snapshot().qr, /^data:image\/png;base64,/)
  login.cancel(); assert.equal(login.snapshot().qr, undefined)
  login.start(); assert.equal(login.snapshot().qr, undefined); login.cancel()
})

test('Windows cancellation targets only the login process tree and ignores finished children', () => {
  let call, killed = 0
  const child = { pid: 12345, exitCode: null, kill: () => { killed++ } }
  const killer = new EventEmitter()
  stopLoginProcess(child, (...args) => { call = args; return killer }, 'win32')
  assert.equal(call[0], 'taskkill.exe')
  assert.deepEqual(call[1], ['/PID', '12345', '/T', '/F'])
  assert.equal(call[2].shell, false)
  assert.equal(call[2].windowsHide, true)
  killer.emit('error', Error('mock missing taskkill')); assert.equal(killed, 1)
  stopLoginProcess({ ...child, exitCode: 0 }, () => { throw Error('must not kill reused PID') }, 'win32')
})

test('creates QR directory before CLI starts and reports unwritable paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhihu-qr-dir-'))
  const qrFile = join(dir, 'new', 'qr.png')
  const { login } = fixture({ qrFile })
  login.start(); assert.ok(existsSync(join(dir, 'new'))); login.cancel()
  const file = join(dir, 'file'); writeFileSync(file, 'keep')
  const broken = fixture({ qrFile: join(file, 'qr.png') })
  broken.login.start()
  assert.equal(broken.children.length, 0)
  assert.match(broken.login.snapshot().message, /目录写入权限/)
})

test('reports QR polling rejection without leaking CLI output or leaving a dead QR', async () => {
  const { login, children } = fixture()
  login.start()
  children[0].stderr.emit('data', Buffer.from('secret-cookie QR login polling rej'))
  children[0].stderr.emit('data', Buffer.from('ected (403); secret-token'))
  children[0].emit('close', 1); await tick()
  assert.match(login.snapshot().message, /风控/)
  assert.equal(login.snapshot().qr, undefined)
  assert.ok(!JSON.stringify(login.snapshot()).includes('secret'))
})
