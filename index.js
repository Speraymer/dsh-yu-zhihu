import { createLogin } from './lib/login.mjs'
import { createBrowserLogin } from './lib/browser-login.mjs'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cleanText, dueWindow, ensureSourceHome, intervalDue, intervalMinutesOf, localDay, remainingToday, storeRun, storeVoiceSelections, WINDOWS, writeJsonAtomic } from './lib/core.mjs'
import { buildEngagementPrompt, buildOriginalArticlePrompt, buildPublicPersona, parseEngagementPlan, recordAttempt } from './lib/engagement.mjs'
import { runPersonaPlanner } from './lib/headless.mjs'
import { checkZhihu, executeZhihuAction, fetchZhihu, fetchZhihuCommands, prepareZhihuAction } from './lib/provider.mjs'
import { claimCommands } from './lib/commands.mjs'

export const name = 'zhihu-scroll'
export const inject = ['webServer', 'agents']

const DEFAULTS = {
  enabled: true, autoRun: true, runAt: '21:40', limit: 15, keywords: '', accessSecret: '',
  peakValley: true, noon: true, night: true, perDay: 40, quotaDay: '', readToday: 0, lastWindowKey: '',
  intervalMinutes: 0, lastIntervalAt: '',
  sourceMode: 'account', commentLimit: 5, cliPath: '', model: 'deepseek-flash', provider: 'deepseek-account', dshBin: '',
  autoLike: true, autoComment: true, autoReply: true, autoPost: true, autoCollect: true,
  likePerRound: 6, commentPerRound: 3, replyPerRound: 3, collectPerRound: 3, collectionId: '',
  engagementDefaultsV1: true, engagementDefaultsV2: true, ownershipV1: true,
  trustedCommands: true, commandSession: '',
  lastRunDay: '', lastRunAt: '', lastResult: '',
}

function homeOf(ctx) {
  try {
    const value = ctx?.get?.('dshHomePath')
    if (typeof value === 'function') return value('zhihu-duty')
    if (typeof value === 'string' && value) return join(value, 'zhihu-duty')
  } catch { /* 使用默认目录 */ }
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'zhihu-duty')
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let text = '', size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('请求正文过大')); req.destroy(); return }
      text += chunk
    })
    req.on('end', () => {
      try { resolve(text ? JSON.parse(text) : {}) } catch { reject(new Error('JSON 格式错误')) }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const root = homeOf(ctx)
  const configFile = join(root, 'config.json')
  const logFile = join(root, 'duty.log')
  const interactionFile = join(root, 'interactions.json')
  const commandLedger = join(root, 'trusted-commands.json')
  const cliPath = join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'zhihu.exe' : 'zhihu')
  const storedConfig = readJson(configFile, {})
  const needsEngagementDefaults = storedConfig.engagementDefaultsV1 !== true
  const needsAutoPostDefault = storedConfig.engagementDefaultsV2 !== true
  let config = { ...DEFAULTS, cliPath, ...storedConfig }
  const qrLogin = createLogin({
    command: () => ({ file: config.cliPath, args: ['login', '--qrcode', '--json'] }),
    verify: async () => (await checkZhihu(config)).accountLoggedIn,
  })
  const browserLogin = createBrowserLogin({ root, verify: async () => (await checkZhihu(config)).accountLoggedIn })
  let login = qrLogin
  ctx.effect(() => () => login.cancel(), 'zhihu-duty login cleanup')
  let running = false
  let posting = false
  let commandChecking = false, lastCommandCheck = 0

  const log = (message) => {
    try { appendFileSync(logFile, `${new Date().toISOString()} ${cleanText(message, 500)}\n`, 'utf8') } catch { /* 日志失败不阻塞 */ }
  }
  const save = (patch = {}) => {
    config = { ...config, ...patch }
    writeJsonAtomic(configFile, config)
    ensureSourceHome(root, { id: 'zhihu', name: '知乎', enabled: config.enabled })
  }
  ensureSourceHome(root, { id: 'zhihu', name: '知乎', enabled: config.enabled })
  if (!existsSync(configFile)) save()
  else {
    if (needsEngagementDefaults) save({
      autoRun: true, sourceMode: 'account', commentLimit: 5,
      autoLike: true, autoComment: true, autoReply: true,
      likePerRound: 2, commentPerRound: 1, replyPerRound: 2, engagementDefaultsV1: true,
    })
    if (needsAutoPostDefault) save({ autoPost: true, engagementDefaultsV2: true })
    if (storedConfig.ownershipV1 !== true) save({
      autoCollect: true, collectPerRound: 3, likePerRound: 6, commentPerRound: 3, replyPerRound: 3,
      perDay: 40, limit: 15, ownershipV1: true,
    })
  }

  const publicConfig = () => ({
    enabled: config.enabled, autoRun: config.autoRun, runAt: config.runAt, limit: config.limit,
    peakValley: config.peakValley, noon: config.noon, night: config.night, perDay: config.perDay,
    intervalMinutes: config.intervalMinutes, lastIntervalAt: config.lastIntervalAt,
    readToday: config.quotaDay === localDay() ? Number(config.readToday) || 0 : 0,
    keywords: config.keywords, sourceMode: config.sourceMode, commentLimit: config.commentLimit, cliPath: config.cliPath,
    autoLike: config.autoLike, autoComment: config.autoComment, autoReply: config.autoReply, autoPost: config.autoPost,
    autoCollect: config.autoCollect, collectionId: config.collectionId,
    likePerRound: config.likePerRound, commentPerRound: config.commentPerRound, replyPerRound: config.replyPerRound,
    collectPerRound: config.collectPerRound,
    trustedCommands: config.trustedCommands, commandSession: config.commandSession,
    hasAccessSecret: Boolean(process.env.ZHIHU_ACCESS_SECRET || config.accessSecret),
    secretSource: process.env.ZHIHU_ACCESS_SECRET ? 'environment' : config.accessSecret ? 'config' : 'none',
  })

  const personaStyle = () => {
    const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'AGENTS.md')
    try {
      const text = readFileSync(file, 'utf8')
      return buildPublicPersona(text)
    } catch { return '' }
  }

  const findAgent = (id) => {
    const value = String(id || '').trim()
    for (const candidate of value.startsWith('session-') ? [value, value.slice(8)] : [value, `session-${value}`]) {
      try { const agent = ctx.agents.get(candidate); if (agent) return agent } catch { /* 未打开 */ }
    }
  }

  const dispatchCommands = async () => {
    if (commandChecking) return 0
    if (!config.trustedCommands || !String(config.commandSession || '').trim()) return 0
    const agent = findAgent(config.commandSession)
    if (!agent) { log('trusted-command target=offline'); return 0 }
    commandChecking = true
    try {
      const { ownerId, items } = await fetchZhihuCommands(config)
      const commands = claimCommands(commandLedger, items, ownerId)
      for (const command of commands) {
        await agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: command.text }], source: { kind: 'zhihu' } })
      }
      if (commands.length) log(`trusted-command delivered=${commands.length}`)
      return commands.length
    } catch (error) {
      log(`trusted-command error=${cleanText(error?.message || error, 200)}`)
      return 0
    } finally { commandChecking = false }
  }

  const engage = async (items) => {
    if (config.sourceMode !== 'account' || (!config.autoLike && !config.autoComment && !config.autoReply && !config.autoPost)) return { attempted: 0, succeeded: 0, skipped: true }
    let history = readJson(interactionFile, { version: 1, attempts: [] })
    const built = buildEngagementPrompt(items, personaStyle(), config, history)
    if (!built.candidates.length) return { attempted: 0, succeeded: 0, skipped: true }
    const output = await runPersonaPlanner(root, config, built.prompt)
    const actions = parseEngagementPlan(output, items, config, history)
    let succeeded = 0, failed = ''
    const succeededActions = []
    for (const action of actions) {
      history = recordAttempt(history, action, 'started')
      writeJsonAtomic(interactionFile, history)
      try {
        await executeZhihuAction(config, action)
        succeeded += 1
        succeededActions.push(action)
        log(`engage kind=${action.kind} type=${action.targetType} target=${action.targetId} ok`)
      } catch (error) {
        failed = cleanText(error?.message || error, 300)
        log(`engage kind=${action.kind} type=${action.targetType} target=${action.targetId} error=${failed}`)
        break
      }
    }
    try { storeVoiceSelections(root, '知乎', items, succeededActions) }
    catch (error) { log(`voice-store error=${cleanText(error?.message || error, 200)}`) }
    appendFileSync(join(root, 'out', `${localDay()}.md`), `- 自动互动：计划 ${actions.length}，成功 ${succeeded}${failed ? `，停止：${failed}` : ''}\n`, 'utf8')
    return { attempted: actions.length, succeeded, error: failed }
  }

  const postOriginalArticle = async () => {
    if (posting) return { ok: false, error: '上一篇还在生成或发布' }
    const provider = await checkZhihu(config)
    if (!provider.cliInstalled || !provider.accountLoggedIn) return { ok: false, error: '增强 CLI 尚未安装或账号未登录' }
    posting = true
    let history = readJson(interactionFile, { version: 1, attempts: [] })
    try {
      const output = await runPersonaPlanner(root, config, buildOriginalArticlePrompt(personaStyle()))
      const action = parseEngagementPlan(output, [], { ...config, autoPost: true }, history)[0]
      if (!action || action.targetType !== 'article') return { ok: false, error: '今天已经发过一篇，或这次没有形成可安全发布的文章' }
      history = recordAttempt(history, action, 'started')
      writeJsonAtomic(interactionFile, history)
      const result = await executeZhihuAction(config, action)
      log('original-post type=article ok')
      return { ok: true, summary: '大肥鱼已经自己想好主题并提交了一篇知乎文章', result }
    } catch (error) {
      const message = cleanText(error?.message || error, 500)
      log(`original-post error=${message}`)
      return { ok: false, error: `${message}。结果不明确时请先到知乎核对；不会自动重试。` }
    } finally { posting = false }
  }

  const run = async (reason = 'manual', windowKey = '') => {
    if (running) return { ok: false, busy: true, error: '上一轮还在运行' }
    if (!config.enabled) return { ok: false, error: '刷知乎已停用' }
    const remaining = reason === 'manual' ? Math.max(1, Math.min(Number(config.limit) || 10, 30)) : remainingToday(config)
    if (remaining <= 0) {
      // 额度用完也要留痕，否则看起来像定时器根本没跑。
      log(`run skipped reason=${reason} quota readToday=${config.readToday}/${config.perDay}`)
      return { ok: true, skipped: true, read: 0, added: 0, error: '今天的自动浏览额度已用完' }
    }
    running = true
    try {
      const items = await fetchZhihu({ ...config, limit: Math.min(Number(config.limit) || 10, remaining) })
      const commandCount = await dispatchCommands()
      const result = storeRun(root, config.sourceMode === 'account' ? '知乎·我的推荐流' : '知乎', items)
      const engagement = await engage(items)
      const now = new Date()
      const day = localDay(now), used = config.quotaDay === day ? Number(config.readToday) || 0 : 0
      save({ ...(reason === 'manual' ? {} : { quotaDay: day, readToday: used + result.read }), ...(windowKey ? { lastWindowKey: windowKey } : {}), ...(reason === 'interval' ? { lastIntervalAt: now.toISOString() } : {}), lastRunDay: day, lastRunAt: now.toISOString(), lastResult: `${reason}：新增 ${result.added}/${result.read}，互动 ${engagement.succeeded}/${engagement.attempted}，可信指令 ${commandCount}` })
      log(`run reason=${reason} read=${result.read} added=${result.added} engagement=${engagement.succeeded}/${engagement.attempted}`)
      return { ok: true, ...result, engagement }
    } catch (error) {
      const message = cleanText(error?.message || error, 500)
      save({ lastResult: `${reason}失败：${message}`, ...(windowKey ? { lastWindowKey: windowKey } : {}) })
      log(`run error=${message}`)
      return { ok: false, error: message }
    } finally { running = false }
  }

  const status = async () => ({
    ok: true, home: root, running, posting, config: publicConfig(), windows: WINDOWS, lastRunAt: config.lastRunAt,
    lastResult: config.lastResult, provider: await checkZhihu(config),
    personaSource: join(root, 'source.json'),
  })

  const handle = async (req, res, url) => {
    const path = url.pathname
    if (path === '/api/zhihu-duty/login') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, login: login.snapshot() })
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return sendJson(res, 415, { ok: false, error: '请从设置页开始登录' })
        if (req.headers?.origin && req.headers.origin !== 'dsh-app://app') {
          let origin
          try { origin = new URL(req.headers.origin) } catch { return sendJson(res, 403, { ok: false, error: '请求来源无效' }) }
          if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) return sendJson(res, 403, { ok: false, error: '请求来源不匹配' })
        }
        const body = await readBody(req)
        if (body.cancel === true) login.cancel()
        else {
          if (body.method != null && !['browser', 'qr'].includes(body.method)) return sendJson(res, 400, { ok: false, error: '不支持的登录方式' })
          if (login.snapshot().status !== 'running') login = body.method === 'browser' ? browserLogin : qrLogin
          login.start()
        }
        return sendJson(res, 200, { ok: true, login: login.snapshot() })
      }
      return sendJson(res, 405, { ok: false, error: '登录接口仅支持 GET / POST' })
    }
    if (req.method === 'GET' && path === '/api/zhihu-duty/status') return sendJson(res, 200, await status())
    if (req.method === 'GET' && path === '/api/zhihu-duty/config') return sendJson(res, 200, { ok: true, config: publicConfig() })
    if (req.method === 'POST' && path === '/api/zhihu-duty/config') {
      const body = await readBody(req)
      const patch = {}
      if ('enabled' in body) patch.enabled = body.enabled === true
      if ('peakValley' in body) patch.peakValley = body.peakValley === true
      if ('noon' in body) patch.noon = body.noon === true
      if ('night' in body) patch.night = body.night === true
      if ('perDay' in body) patch.perDay = Math.max(0, Math.min(3000, Number(body.perDay) || 0))
      if ('intervalMinutes' in body) {
        const minutes = Math.floor(Number(body.intervalMinutes) || 0)
        patch.intervalMinutes = minutes <= 0 ? 0 : Math.min(1440, Math.max(5, minutes))
      }
      if ('limit' in body) patch.limit = Math.max(1, Math.min(50, Number(body.limit) || 10))
      if ('keywords' in body) patch.keywords = cleanText(body.keywords, 200)
      if ('sourceMode' in body) {
        if (!['official', 'account'].includes(body.sourceMode)) return sendJson(res, 400, { ok: false, error: '读取模式无效' })
        patch.sourceMode = body.sourceMode
      }
      if ('commentLimit' in body) patch.commentLimit = Math.max(0, Math.min(5, Number(body.commentLimit) || 0))
      if ('cliPath' in body) patch.cliPath = cleanText(body.cliPath, 500)
      for (const key of ['autoLike', 'autoComment', 'autoReply', 'autoPost', 'autoCollect']) if (key in body) patch[key] = body[key] === true
      if ('trustedCommands' in body) patch.trustedCommands = body.trustedCommands === true
      if ('commandSession' in body) patch.commandSession = cleanText(body.commandSession, 120)
      if ('collectionId' in body) patch.collectionId = cleanText(body.collectionId, 32).replace(/\D/g, '')
      if ('likePerRound' in body) patch.likePerRound = Math.max(0, Math.min(20, Number(body.likePerRound) || 0))
      if ('commentPerRound' in body) patch.commentPerRound = Math.max(0, Math.min(10, Number(body.commentPerRound) || 0))
      if ('replyPerRound' in body) patch.replyPerRound = Math.max(0, Math.min(10, Number(body.replyPerRound) || 0))
      if ('collectPerRound' in body) patch.collectPerRound = Math.max(0, Math.min(10, Number(body.collectPerRound) || 0))
      if ('accessSecret' in body && String(body.accessSecret).trim()) patch.accessSecret = String(body.accessSecret).trim()
      if (body.clearAccessSecret === true) patch.accessSecret = ''
      save(patch)
      return sendJson(res, 200, { ok: true, config: publicConfig() })
    }
    if (req.method === 'POST' && path === '/api/zhihu-duty/run') return sendJson(res, 200, await run('manual'))
    if (req.method === 'POST' && path === '/api/zhihu-duty/post') {
      const result = await postOriginalArticle()
      return sendJson(res, result.ok ? 200 : 409, result)
    }
    if (req.method === 'POST' && path === '/api/zhihu-duty/action') {
      const body = await readBody(req)
      const provider = await checkZhihu(config)
      if (!provider.cliInstalled || !provider.accountLoggedIn) return sendJson(res, 409, { ok: false, error: '增强 CLI 尚未安装或账号未登录' })
      let prepared
      try { prepared = prepareZhihuAction(body) }
      catch (error) { return sendJson(res, 400, { ok: false, error: cleanText(error?.message || error, 300) }) }
      try {
        const result = await executeZhihuAction(config, body)
        log(`manual-action kind=${body.kind} type=${body.targetType} target=${cleanText(body.targetId || 'new', 40)} ok`)
        return sendJson(res, 200, { ok: true, summary: prepared.summary, result })
      } catch (error) {
        const message = cleanText(error?.message || error, 500)
        log(`manual-action kind=${body.kind} type=${body.targetType} target=${cleanText(body.targetId || 'new', 40)} error=${message}`)
        return sendJson(res, 502, { ok: false, error: `${message}。结果不明确时请先到知乎核对；插件不会自动重试。` })
      }
    }
    if (req.method === 'GET' && path === '/api/zhihu-duty/report') {
      const file = join(root, 'out', `${localDay()}.md`)
      return sendJson(res, 200, { ok: true, file, text: existsSync(file) ? readFileSync(file, 'utf8').slice(-100000) : '' })
    }
    return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/api/zhihu-duty',
    handler: async (req, res) => {
      try { await handle(req, res, new URL(req.url, 'http://127.0.0.1')) }
      catch (error) { sendJson(res, 500, { ok: false, error: cleanText(error?.message || error, 300) }) }
    },
  }), 'zhihu-duty api')

  const timer = setInterval(() => {
    // 设了「每 N 分钟」就按间隔跑（只在谷时里），否则沿用原来的两个固定窗口。
    // 额度用完时不再每分钟空转写日志：直接等额度（跨天或调大上限后自然恢复）。
    if (intervalMinutesOf(config) > 0) {
      if (!running && remainingToday(config) > 0 && intervalDue(config)) void run('interval')
    } else {
      const windowKey = dueWindow(config)
      if (windowKey && !running) void run('scheduled', windowKey)
    }
    if (Date.now() - lastCommandCheck >= 5 * 60_000) { lastCommandCheck = Date.now(); void dispatchCommands() }
  }, 60_000)
  if (timer.unref) timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'zhihu-duty timer')
  log(`mounted home=${root}`)
}
