import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

test('login API accepts desktop origin, rejects foreign origins and never runs social actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhihu-login-api-'))
  let handler
  const dispose = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('No real network in login route tests') }
  try {
    apply({ get: (key) => key === 'dshHomePath' ? () => root : undefined,
      webServer: { register: (value) => { handler = value.handler; return () => {} } },
      effect: (run) => { const stop = run(); if (typeof stop === 'function') dispose.push(stop) },
    })
    const request = async (method, origin, type = 'application/json') => {
      const req = Readable.from([JSON.stringify({ cancel: true })])
      req.method = method; req.url = '/api/zhihu-duty/login'
      req.headers = { host: '127.0.0.1:9999', 'content-type': type, ...(origin ? { origin } : {}) }
      let body
      const res = { setHeader() {}, end: (value) => { body = JSON.parse(value) } }
      await handler(req, res)
      return { status: res.statusCode, body }
    }
    assert.equal((await request('GET')).body.login.status, 'idle')
    assert.equal((await request('POST', 'https://evil.example')).status, 403)
    assert.equal((await request('POST', 'null')).status, 403)
    assert.equal((await request('POST', 'dsh-app://app', 'text/plain')).status, 415)
    assert.equal((await request('POST', 'dsh-app://app')).status, 200)
    assert.equal((await request('POST', 'http://127.0.0.1:9999')).status, 200)
    assert.equal((await request('DELETE')).status, 405)
  } finally { for (const stop of dispose.reverse()) stop(); globalThis.fetch = originalFetch }
})
