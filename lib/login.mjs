import { spawn } from 'node:child_process'
import { statSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 仅返回二维码 / 授权链接和状态；CLI 原始输出可能含凭据，不回显也不记日志。
export function createLogin({ command, verify, launch = spawn, timeoutMs = 240_000, qrFile = join(homedir(), '.zhihu-cli', 'login_qrcode.png') }) {
  let state = { status: 'idle', message: '' }, active = null
  const qrStamp = () => {
    try { const s = statSync(qrFile); return s.mtimeMs + ':' + s.size } catch { return '' }
  }
  const finish = (job, status, message) => {
    if (active !== job) return
    clearTimeout(job.timer)
    active = null
    state = { status, message }
  }
  const cancel = () => {
    if (!active) return
    const job = active
    finish(job, 'cancelled', '已取消登录。原有账号凭据不会由插件清除。')
    job.child?.kill()
  }
  const start = () => {
    if (active) return
    const job = { child: null, timer: null, oldQr: qrStamp() }
    active = job
    state = { status: 'running', message: '正在获取二维码…' }
    try {
      const spec = command()
      if (!spec.file) throw new Error('missing command')
      job.child = launch(spec.file, spec.args, {
        windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
      })
      job.timer = setTimeout(() => {
        finish(job, 'expired', '登录已超时，请重新点击登录获取新的授权信息。')
        job.child.kill()
      }, timeoutMs)
      job.timer.unref?.()
      let outputSize = 0
      const read = (chunk) => {
        if (active !== job) return
        outputSize += chunk.length
        if (outputSize > 256 * 1024) {
          finish(job, 'error', '登录程序返回异常，请检查程序版本后重试。')
          job.child.kill()
          return
        }
        // 二维码从固定文件读取，不解析终端文字。
      }
      job.child.stdout.on('data', read)
      job.child.stderr.on('data', read)
      job.child.once('error', () => finish(job, 'error', '无法启动登录程序，请检查 CLI 是否已安装以及程序路径是否正确。'))
      job.child.once('close', async (code) => {
        if (active !== job) return
        if (code !== 0) return finish(job, 'error', '登录未完成，可能是授权过期、网络失败或平台拒绝；请重新登录。')
        try {
          const connected = await verify()
          finish(job, connected ? 'success' : 'error', connected ? '登录成功，账号已连接。' : '授权已结束，但账号检查未通过。请检查网络后重新检查连接。')
        } catch { finish(job, 'error', '授权已结束，但连接检查失败，请重新检查连接。') }
      })
    } catch { finish(job, 'error', '找不到登录程序，请先安装 CLI 或检查已配置的程序路径。') }
  }
  const snapshot = () => {
    if (active && state.status === 'running') {
      const stamp = qrStamp()
      if (stamp && stamp !== active.oldQr) {
        try {
          const size = statSync(qrFile).size
          if (size > 0 && size <= 1024 * 1024) {
            const bytes = readFileSync(qrFile)
            if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
              state.qr = 'data:image/png;base64,' + bytes.toString('base64')
              state.message = '请使用知乎 App 扫码，并在手机上确认登录。此页会自动检查结果。'
            }
          }
        } catch { /* CLI 正在写入图片，等下一次读取。 */ }
      }
    }
    return { ...state }
  }
  return { start, cancel, snapshot }
}
