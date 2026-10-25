import { spawn } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { cleanText, normalizeItems } from './core.mjs'

const BASE = 'https://developer.zhihu.com/api/v1/content'

function runCli(command, args, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      })
    } catch (error) { reject(error); return }
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true; child.kill(); reject(new Error('知乎增强读取超时'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) child.kill() })
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 512 * 1024) child.kill() })
    child.on('error', (error) => {
      if (settled) return
      settled = true; clearTimeout(timer); reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (code !== 0) return reject(new Error(cleanText(stderr || stdout, 600) || `知乎增强 CLI 退出码 ${code}`))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('知乎增强 CLI 没有返回 JSON')) }
    })
  })
}

export function buildPlusArgs(config) {
  const query = cleanText(config.keywords, 200)
  const limit = Math.max(1, Math.min(Number(config.limit) || 10, 30))
  if (query) return ['search', query, '--limit', String(limit), '--answers', '0', '--json']
  const comments = Math.max(0, Math.min(Number(config.commentLimit) || 0, 5))
  return ['feeds', '--limit', String(limit), '--comment-limit', String(comments), '--json']
}

function actionText(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
}

function actionId(value, label = '目标 ID') {
  const id = String(value ?? '').trim()
  if (!/^\d{1,32}$/.test(id)) throw new Error(`${label} 必须是 1–32 位数字`)
  return id
}

export function prepareZhihuAction(input = {}) {
  const kind = String(input.kind || '')
  const targetType = String(input.targetType || '')
  const undo = input.undo === true
  let args, summary

  if (kind === 'like') {
    const targetId = actionId(input.targetId)
    const commands = { answer: 'vote', article: 'like-article', pin: 'like-pin', comment: 'like-comment' }
    const command = commands[targetType]
    if (!command) throw new Error('点赞类型必须是回答、文章、想法或评论')
    args = [command, targetId]
    if (undo) args.push(targetType === 'answer' ? '--neutral' : '--undo')
    else if (targetType === 'answer') args.push('--up')
    args.push('--json')
    summary = `${undo ? '取消点赞' : '点赞'}${{ answer: '回答', article: '文章', pin: '想法', comment: '评论' }[targetType]} ${targetId}`
  } else if (kind === 'comment' || kind === 'reply') {
    const targetId = actionId(input.targetId, '内容 ID')
    if (!['answer', 'article', 'pin', 'question'].includes(targetType)) throw new Error('评论类型必须是回答、文章、想法或问题')
    const text = actionText(input.text, kind === 'reply' ? 100 : 150)
    if (!text) throw new Error('评论正文不能为空')
    if (kind === 'reply') {
      const replyTo = actionId(input.replyTo, '评论 ID')
      args = ['reply', targetId, replyTo, text, '--type', targetType, '--json']
      summary = `回复评论 ${replyTo}（${text.length} 字）`
    } else {
      args = ['comment', targetId, text, '--type', targetType, '--json']
      summary = `评论${{ answer: '回答', article: '文章', pin: '想法', question: '问题' }[targetType]} ${targetId}（${text.length} 字）`
    }
  } else if (kind === 'post') {
    if (!['pin', 'article', 'answer'].includes(targetType)) throw new Error('发布类型必须是想法、文章或回答')
    const text = actionText(input.text, 20000)
    if (!text) throw new Error('发布正文不能为空')
    if (targetType === 'answer') {
      const targetId = actionId(input.targetId, '问题 ID')
      args = ['publish-answer', targetId, text, '--json']
      summary = `向问题 ${targetId} 发布回答（${text.length} 字）`
    } else {
      const title = cleanText(input.title, targetType === 'pin' ? 100 : 200)
      if (!title) throw new Error('标题不能为空')
      args = targetType === 'pin' ? ['pin', title, '--content', text, '--json'] : ['article', title, text, '--json']
      summary = `发布${targetType === 'pin' ? '想法' : '文章'}《${title}》（${text.length} 字）`
    }
  } else if (kind === 'collect') {
    const targetId = actionId(input.targetId, '内容 ID')
    const collectionId = actionId(input.collectionId, '收藏夹 ID')
    const type = input.targetType === 'article' ? 'article' : 'answer'
    args = ['collect', collectionId, targetId, '--type', type, ...(undo ? ['--undo'] : []), '--json']
    summary = `${undo ? '移出' : '收藏到'} 收藏夹 ${collectionId}：${type === 'article' ? '文章' : '回答'} ${targetId}`
  } else if (kind === 'follow') {
    if (input.targetType === 'question') {
      const targetId = actionId(input.targetId, '问题 ID')
      args = ['follow-question', targetId, ...(undo ? ['--undo'] : []), '--json']
      summary = `${undo ? '取消关注' : '关注'}问题 ${targetId}`
    } else if (input.targetType === 'user') {
      const token = String(input.targetId ?? '').trim()
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(token)) throw new Error('用户必须是 1–64 位 url_token')
      args = ['follow-user', token, ...(undo ? ['--undo'] : []), '--json']
      summary = `${undo ? '取消关注' : '关注'}用户 ${token}`
    } else throw new Error('关注类型必须是用户或问题')
  } else if (kind === 'profile') {
    const payload = {}
    for (const key of ['name', 'headline', 'gender']) {
      if (!(key in (input.profile || {}))) continue
      const value = actionText(input.profile[key], key === 'headline' ? 300 : 40)
      if (!value) throw new Error(`${key} 不能为空`)
      payload[key] = value
    }
    if (!Object.keys(payload).length) throw new Error('要改的资料字段不能为空（支持 name / headline / gender）')
    summary = `修改个人资料：${Object.keys(payload).join('、')}`
    return { python: true, payload, summary }
  } else throw new Error('只支持点赞、评论、回复、发布、收藏、关注和改资料')

  return { args, summary }
}

async function fetchOfficial(config) {
  const secret = cleanText(process.env.ZHIHU_ACCESS_SECRET || config.accessSecret, 1000)
  if (!secret) throw new Error('还没配置知乎 Access Secret；请在设置页填写，或设置 ZHIHU_ACCESS_SECRET')
  const query = cleanText(config.keywords, 200)
  const url = new URL(`${BASE}/${query ? 'zhihu_search' : 'hot_list'}`)
  if (query) {
    url.searchParams.set('Query', query)
    url.searchParams.set('Count', String(Math.min(Number(config.limit) || 10, 10)))
  } else url.searchParams.set('Limit', String(Math.min(Number(config.limit) || 10, 30)))
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${secret}`,
      'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error(`知乎接口返回了非 JSON（HTTP ${response.status}）`) }
  if (!response.ok || ('Code' in payload && Number(payload.Code) !== 0)) {
    throw new Error(cleanText(payload?.Message || payload?.message || payload?.error || text, 300) || `知乎接口 HTTP ${response.status}`)
  }
  const items = normalizeItems(payload, 'zhihu', config.limit)
  if (!items.length) throw new Error('知乎接口成功，但没有解析到内容；请查看接口返回格式是否变化')
  return items
}

async function fetchAccount(config) {
  const command = String(config.cliPath || '').trim()
  if (!command || !existsSync(command)) throw new Error('知乎增强 CLI 尚未安装；请按设置页提示安装')
  const payload = await runCli(command, buildPlusArgs(config))
  const expandedLimit = Math.min(30, (Number(config.limit) || 10) * (Math.min(Number(config.commentLimit) || 0, 5) + 1))
  const items = normalizeItems(payload, 'zhihu-plus', expandedLimit)
  if (!items.length) throw new Error('知乎增强 CLI 成功，但没有解析到推荐内容')
  return items
}

function profilePaths(command) {
  const dataRoot = resolve(command, '..', '..', '..')
  const python = process.platform === 'win32'
    ? command.replace(/zhihu\.exe$/i, 'python.exe')
    : command.replace(/zhihu$/i, 'python')
  return { python, script: join(dataRoot, 'bin', 'profile.py') }
}

export async function executeZhihuAction(config, action) {
  const command = String(config.cliPath || '').trim()
  if (!command || !existsSync(command)) throw new Error('知乎增强 CLI 尚未安装')
  const prepared = prepareZhihuAction(action)
  if (!prepared.python) return runCli(command, prepared.args)
  const { python, script } = profilePaths(command)
  if (!existsSync(python)) throw new Error('找不到知乎环境的 python，无法修改资料')
  if (!existsSync(script)) throw new Error(`找不到资料脚本 ${script}`)
  const payloadFile = join(tmpdir(), `zh-profile-${randomUUID()}.json`)
  writeFileSync(payloadFile, JSON.stringify(prepared.payload), 'utf8')
  try {
    return await runCli(python, [script, payloadFile], 60_000)
  } finally {
    try { unlinkSync(payloadFile) } catch { /* 临时文件可留 */ }
  }
}

export async function fetchZhihu(config) {
  return config.sourceMode === 'account' ? fetchAccount(config) : fetchOfficial(config)
}

export async function fetchZhihuCommands(config) {
  const command = String(config.cliPath || '').trim()
  if (!command || !existsSync(command)) return { ownerId: '', items: [] }
  const profile = await runCli(command, ['whoami', '--json'], 15_000)
  const ownerId = cleanText(profile?.url_token || profile?.id || profile?.data?.url_token || profile?.data?.id, 120)
  if (!ownerId) throw new Error('知乎账号信息没有返回可校验的用户 ID，可信指令保持关闭')
  const payload = await runCli(command, ['user-pins', ownerId, '--limit', '10', '--json'])
  return { ownerId, items: normalizeItems(payload, 'zhihu-command', 10) }
}

export async function checkZhihu(config) {
  const officialConfigured = Boolean(process.env.ZHIHU_ACCESS_SECRET || config.accessSecret)
  const command = String(config.cliPath || '').trim()
  const cliInstalled = Boolean(command && existsSync(command))
  let accountLoggedIn = false, accountError = ''
  if (cliInstalled) {
    try {
      const result = await runCli(command, ['status', '--json'], 15_000)
      accountLoggedIn = result?.authenticated === true
    } catch (error) {
      const message = cleanText(error?.message || error, 300)
      try {
        const result = JSON.parse(message)
        accountLoggedIn = result?.authenticated === true
      } catch { accountError = message }
    }
  }
  return {
    ok: true, mode: config.sourceMode,
    officialConfigured,
    officialSource: process.env.ZHIHU_ACCESS_SECRET ? 'environment' : config.accessSecret ? 'config' : 'none',
    cliInstalled, cliPath: command, accountLoggedIn, accountError,
  }
}
