import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function scan(dir, depth, budget) {
  if (depth > 7 || budget.n > 4000) return ''
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return '' }
  for (const entry of entries) {
    if (!entry.isDirectory() || ++budget.n > 4000) continue
    const next = join(dir, entry.name)
    const bin = join(next, 'lib', 'bin.js')
    if (entry.name === 'dsh' && existsSync(bin)) return bin
    const hit = scan(next, depth + 1, budget)
    if (hit) return hit
  }
  return ''
}

function findCommand(config) {
  const explicit = String(config.dshBin || process.env.DSH_BIN || '').trim()
  if (explicit) return { command: process.execPath, args: [explicit] }
  const roots = []
  if (process.resourcesPath) roots.push(process.resourcesPath)
  try { roots.push(join(dirname(process.execPath), 'resources')) } catch { /* 非 Electron */ }
  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    const asar = join(root, 'app.asar')
    if (existsSync(asar)) return {
      command: process.execPath,
      args: ['--expose-internals', join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')],
      electron: true,
    }
    const hit = scan(root, 0, { n: 0 })
    if (hit) return { command: process.execPath, args: [hit] }
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const local = scan(join(home, 'profiles'), 0, { n: 0 })
  return local ? { command: process.execPath, args: [local] } : null
}

export function runPersonaPlanner(root, config, prompt) {
  const found = findCommand(config)
  if (!found) return Promise.reject(new Error('找不到 DSH headless CLI；可在设置里填写 dshBin'))
  const plannerDir = join(root, 'planner')
  mkdirSync(plannerDir, { recursive: true })
  const overlay = join(plannerDir, 'overlay.yml')
  writeFileSync(overlay, [
    '- id: credentials', '  disabled: false', '',
    '- id: authorization', '  disabled: false', '',
    '- id: deepseek-account', '  disabled: false', '',
    '- id: agent-default-model', '  config:', '    provider: deepseek-account',
    `    model: ${String(config.model || 'deepseek-flash')}`, '    reasoningEffort: high', '',
  ].join('\n'), 'utf8')
  const args = [...found.args, 'headless', '--patch', overlay, prompt]
  return new Promise((resolve, reject) => {
    const child = spawn(found.command, args, {
      cwd: plannerDir, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_HOME: process.env.DSH_HOME || join(homedir(), '.dsh'), ...(found.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true; child.kill(); reject(new Error('人格互动规划超时'))
    }, 180_000)
    child.stdout.on('data', (chunk) => { if (stdout.length < 1024 * 1024) stdout += chunk })
    child.stderr.on('data', (chunk) => { if (stderr.length < 256 * 1024) stderr += chunk })
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error) } })
    child.on('close', (code) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (code !== 0) reject(new Error((stderr || stdout).slice(-1000) || `人格互动规划退出码 ${code}`))
      else resolve(stdout)
    })
  })
}
