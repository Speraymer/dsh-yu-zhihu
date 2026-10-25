import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeJsonAtomic } from './core.mjs'
import { stopLoginProcess } from './login.mjs'

export function zhihuCookies(items) {
  const cookies = {}
  for (const c of items || []) {
    if (['zhihu.com', '.zhihu.com', 'www.zhihu.com'].includes(c.domain) &&
        ['z_c0', '_xsrf', 'd_c0'].includes(c.name) && typeof c.value === 'string' && c.value.trim() &&
        (c.expires == null || c.expires === -1 || c.expires > Date.now() / 1000)) cookies[c.name] = c.value
  }
  return ['z_c0', '_xsrf', 'd_c0'].every((name) => cookies[name]) ? cookies : null
}

export async function connectBrowser(profile) {
  const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/)
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(path)) throw Error('invalid endpoint')
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    let message
    try { message = JSON.parse(data) } catch { return }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id); clearTimeout(request.timer)
    if (message.error) request.reject(Error('browser command failed'))
    else request.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const req of pending.values()) { clearTimeout(req.timer); req.reject(Error('browser closed')) }
    pending.clear()
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('browser timeout')) }, 5000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('browser unavailable')) }, { once: true })
  })
  return {
    call(method) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(Error('browser timeout')) }, 5000)
        pending.set(id, { resolve, reject, timer })
        try { socket.send(JSON.stringify({ id, method })) }
        catch { pending.delete(id); clearTimeout(timer); reject(Error('browser unavailable')) }
      })
    },
    close: () => socket.close(),
  }
}

export function createBrowserLogin({ root, verify, launch = spawn, connect = connectBrowser,
  browser = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map((p) => join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(existsSync),
  cookieFile = join(homedir(), '.zhihu-cli', 'cookies.json'), intervalMs = 1000, timeoutMs = 240_000 }) {
  let active = null, state = { status: 'idle', message: '' }
  const finish = (job, status, message) => {
    if (active !== job) return
    active = null; clearTimeout(job.timer); clearTimeout(job.deadline)
    job.connection?.close(); stopLoginProcess(job.child)
    state = { status, message }
  }
  const poll = async (job) => {
    if (active !== job) return
    try {
      const connection = job.connection || await connect(job.profile)
      if (active !== job) { connection.close(); return }
      job.connection = connection
      const result = await connection.call('Storage.getCookies')
      if (active !== job) return
      const cookies = zhihuCookies(result.cookies)
      if (cookies) {
        // 保留旧凭据用于回滚，只保存独立窗口中知乎的三个必要 Cookie。
        mkdirSync(join(cookieFile, '..'), { recursive: true })
        if (existsSync(cookieFile)) copyFileSync(cookieFile, `${cookieFile}.before-browser-${Date.now()}`)
        writeJsonAtomic(cookieFile, { cookies })
        state = { status: 'running', message: '已接收登录状态，正在检查账号连接…' }
        const ok = await verify()
        if (active !== job) return
        finish(job, ok ? 'success' : 'error', ok ? '登录成功，账号已连接。' : '浏览器登录状态已保存，但账号连接检查未通过；请稍后点击检查连接。')
        return
      }
    } catch {
      if (active !== job) return
      if (job.connection) return finish(job, 'error', '浏览器连接或登录状态保存失败，请重试；原有凭据备份已保留（如有）。')
      // Edge 启动时尚未生成调试端口文件，等待下一次检查。
    }
    if (active === job) job.timer = setTimeout(() => poll(job), intervalMs)
  }
  return {
    start() {
      if (active) return
      const job = {}; active = job
      state = { status: 'running', message: '请在新打开的 Edge 窗口完成知乎登录（扫码或短信）；成功后会自动接收登录状态。' }
      try {
        if (!browser) throw Error('missing Edge')
        mkdirSync(root, { recursive: true })
        job.profile = mkdtempSync(join(root, 'login-browser-'))
        job.child = launch(browser, [`--user-data-dir=${job.profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--new-window', 'https://www.zhihu.com/signin'], { shell: false, windowsHide: false, stdio: 'ignore' })
        job.child.once('error', () => finish(job, 'error', '无法启动 Edge 登录窗口，请确认浏览器已安装。'))
        job.child.once('close', () => finish(job, 'cancelled', '登录窗口已关闭。'))
        job.deadline = setTimeout(() => finish(job, 'expired', '浏览器登录超时，请重新打开登录窗口。'), timeoutMs)
        job.deadline.unref?.()
        void poll(job)
      } catch { finish(job, 'error', '无法打开独立登录窗口，请检查 Edge 安装及目录写入权限。') }
    },
    cancel() { if (active) finish(active, 'cancelled', '已取消浏览器登录。') },
    snapshot: () => ({ ...state }),
  }
}
