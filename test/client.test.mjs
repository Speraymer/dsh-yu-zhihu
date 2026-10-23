import test from 'node:test'
import assert from 'node:assert/strict'

test('registers a parallel settings section', async () => {
  let bundle, section
  globalThis.window = { __ModuleLoader__: { load(value) { bundle = value } } }
  globalThis.document = { head: { appendChild() {} }, createElement: () => ({ remove() {} }) }
  await import(`../client.js?test=${Date.now()}`)
  const plugin = bundle.factory(() => ({ createElement() {}, useState() {}, useCallback() {}, useEffect() {} }))
  const slots = { inject(_name, run) { run() }, register(meta) { section = meta } }
  plugin.apply({ get: () => slots, effect(run) { run() } })
  assert.deepEqual({ id: bundle.id, section: section.id, order: section.order, label: section.label }, {
    id: 'dsh-yu-zhihu', section: 'zhihu-scroll', order: 31, label: '刷知乎',
  })
})

test('login button starts authorization and renders its progress and cancel action', async () => {
  let bundle, render, loginState = { status: 'idle' }, stateIndex = 0
  const requests = []
  const effects = []
  const config = { sourceMode: 'account', keywords: '', commandSession: '' }
  const data = { config, provider: { cliInstalled: true, accountLoggedIn: false, loggedIn: false } }
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type(props || {})
      return { type, props: props || {}, children: children.flat(Infinity).filter((x) => x != null && x !== false) }
    },
    useState(initial) {
      const index = stateIndex++
      if (index === 0) return [data, () => {}]
      if (initial?.status) return [loginState, (value) => { loginState = value }]
      return [initial, () => {}]
    }, useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
  }
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => ({ ok: true, login: { status: 'running', message: 'fixture pending', qr: 'data:image/png;base64,fixture' } }) }
  }
  try {
    globalThis.window = { __ModuleLoader__: { load(value) { bundle = value } } }
    await import('../client.js?login-ui=' + Date.now())
    const plugin = bundle.factory(() => React)
    const slots = { inject(_name, fn) { fn() }, register(_meta, fn) { render = fn } }
    plugin.apply({ get: () => slots, effect: (fn) => fn() })
    const flatten = (node) => typeof node === 'object' ? [node, ...node.children.flatMap(flatten)] : []
    let tree = render()
    let nodes = flatten(tree)
    const button = nodes.find((n) => n.type === 'button' && n.children.includes('扫码登录知乎'))
    assert.ok(button); await button.props.onClick()
    assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/zhihu-duty/login')
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0].options.body), { cancel: false })
    stateIndex = 0; nodes = flatten(render())
    assert.ok(nodes.find((n) => n.type === 'button' && n.children.includes('等待登录…')).props.disabled)
    assert.ok(nodes.find((n) => n.type === 'img' && n.props.alt.includes('二维码')))
    await nodes.find((n) => n.type === 'button' && n.children.includes('取消登录')).props.onClick()
    assert.deepEqual(JSON.parse(requests[1].options.body), { cancel: true })
    assert.ok(requests.every((r) => r.url.endsWith('/login')))
  } finally { globalThis.fetch = oldFetch }
})
