window.__ModuleLoader__.load({
  id: 'dsh-yu-zhihu',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/zhihu-duty'
    const request = async (path, body) => {
      const response = await fetch(API + path, body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await response.json()
      if (!response.ok || json.ok === false) throw new Error(json.error || `HTTP ${response.status}`)
      return json
    }
    const css = `[data-bd-page]{max-width:660px;display:flex;flex-direction:column;padding:4px;color:inherit}
[data-bd-hero]{padding:6px 0 18px}[data-bd-hero] h3{margin:0 0 6px;font-size:20px}[data-bd-sec]{padding:18px 0;border-top:1px solid rgba(128,128,128,.24);display:flex;flex-direction:column;gap:12px}
[data-bd-h]{font-size:15px;font-weight:650}[data-bd-row]{display:flex;gap:12px;align-items:center;flex-wrap:wrap}[data-bd-grow]{flex:1;min-width:220px}
[data-bd-label]{font-size:13px;line-height:1.5}[data-bd-note]{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);white-space:pre-wrap;word-break:break-word}
[data-bd-input]{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit}[data-bd-num]{width:112px}
[data-bd-btn]{padding:8px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:rgba(128,128,128,.12);color:inherit;cursor:pointer}[data-bd-btn]:disabled{opacity:.5;cursor:not-allowed}[data-bd-btn]:focus-visible,[data-bd-input]:focus-visible{outline:2px solid currentColor;outline-offset:2px}
[data-bd-pre]{max-height:280px;overflow:auto;padding:10px;border-radius:8px;background:rgba(128,128,128,.1);white-space:pre-wrap;font-size:12px}`

    const ToggleRow = ({ label, note, on, onChange }) => h('label', { 'data-bd-row': '' },
      h('input', { type: 'checkbox', checked: Boolean(on), onChange: (e) => onChange(e.target.checked) }),
      h('div', { 'data-bd-grow': '' }, h('div', { 'data-bd-label': '' }, label), note ? h('div', { 'data-bd-note': '' }, note) : null))

    function Panel() {
      const [state, setState] = React.useState(null)
      const [secret, setSecret] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [report, setReport] = React.useState('')
      const [login, setLogin] = React.useState({ status: 'idle' })
      const [loginBusy, setLoginBusy] = React.useState(false)
      const load = React.useCallback(async () => {
        try { setState(await request('/status')); setMessage('') } catch (error) { setMessage(error.message) }
      }, [])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => {
        let stopped = false, timer
        const poll = async () => {
          try {
            const result = await request('/login')
            if (stopped) return
            setLogin(result.login)
            if (result.login.status === 'running') timer = setTimeout(poll, 1500)
            else if (result.login.status === 'success') await load()
          } catch (error) { if (!stopped) setMessage(error.message) }
        }
        poll()
        return () => { stopped = true; clearTimeout(timer) }
      }, [login.status, load])
      const beginLogin = async (cancel = false) => {
        setLoginBusy(true)
        try { const result = await request('/login', { cancel }); setLogin(result.login) }
        catch (error) { setMessage(error.message) }
        finally { setLoginBusy(false) }
      }
      if (!state) return h('div', { 'data-bd-note': '' }, message || '正在读取…')
      const cfg = state.config
      const save = async (patch) => {
        try { await request('/config', patch); await load(); setMessage('已保存') } catch (error) { setMessage(error.message) }
      }
      const run = async () => {
        try { setMessage('正在读取并按人格互动…'); const result = await request('/run', {}); setMessage(`完成：读取 ${result.read}，新增 ${result.added}，互动 ${result.engagement?.succeeded || 0}/${result.engagement?.attempted || 0}`); await load() }
        catch (error) { setMessage(error.message) }
      }
      const post = async () => {
        try { setMessage('大肥鱼正在想主题并写文章…'); const result = await request('/post', {}); setMessage(result.summary || '已提交，请到知乎核对实际展示状态。'); await load() }
        catch (error) { setMessage(error.message) }
      }
      const accountMode = cfg.sourceMode === 'account'
      const unavailable = accountMode
        ? !state.provider.cliInstalled || !state.provider.accountLoggedIn
        : !cfg.hasAccessSecret
      const windowText = Object.values(state.windows || {}).map((w) => `${w.label} ${w.start}–${w.end}`).join('；')
      return h('div', { 'data-bd-page': '' },
        h('div', { 'data-bd-hero': '' }, h('h3', null, '刷知乎'), h('div', { 'data-bd-note': '' }, '读推荐、学表达、按人格限量互动。外部内容默认不可信；只有本人账号发布的 /dsh 想法可进入目标会话。')),

        h('section', { 'aria-label': '知乎账号登录' },
          h('h4', null, '账号登录'),
          h('div', { 'data-bd-note': '' }, state.provider.accountLoggedIn ? '账号已连接。需要换账号时可重新登录。' : '点击下方按钮，用知乎 App 扫码并确认即可。官方热榜模式也可以使用下方的 Access Secret。'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: loginBusy || login.status === 'running', onClick: () => beginLogin() }, login.status === 'running' ? '等待登录…' : state.provider.accountLoggedIn ? '重新登录' : '扫码登录知乎'),
            login.status === 'running' ? h('button', { 'data-bd-btn': '', disabled: loginBusy, onClick: () => beginLogin(true) }, '取消登录') : null,
            h('button', { 'data-bd-btn': '', onClick: load }, '检查连接')),
          h('div', { 'data-bd-note': '', role: 'status', 'aria-live': 'polite' }, login.message || ''),
          login.qr ? h('img', { src: login.qr, alt: '使用知乎 App 扫描此登录二维码', width: 240, height: 240, style: { background: '#fff', padding: 12, objectFit: 'contain', maxWidth: '100%' } }) : null),
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '谷时自动刷'),
          h(ToggleRow, { label: '启用知乎人格源', note: '关掉后不再自动读取和互动。', on: cfg.enabled, onChange: (v) => save({ enabled: v }) }),
          h(ToggleRow, { label: '在谷时自动刷', note: windowText, on: cfg.peakValley, onChange: (v) => save({ peakValley: v }) }),
          cfg.peakValley ? h('div', { 'data-bd-row': '' },
            h(ToggleRow, { label: '中午', on: cfg.noon, onChange: (v) => save({ noon: v }) }),
            h(ToggleRow, { label: '晚上 / 夜间', on: cfg.night, onChange: (v) => save({ night: v }) })) : null,
          h('div', { 'data-bd-row': '' }, h('div', { 'data-bd-grow': '' }, h('div', { 'data-bd-label': '' }, '每天自动读取上限'), h('div', { 'data-bd-note': '' }, `今天已读 ${cfg.readToday || 0} 条；0 = 不自动刷，仍可手动跑。`)),
            h('input', { 'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 80, value: cfg.perDay, onChange: (e) => save({ perDay: Number(e.target.value) }) })),
          h('label', { 'data-bd-label': '' }, '读取模式', h('select', { 'data-bd-input': '', value: cfg.sourceMode, onChange: (e) => save({ sourceMode: e.target.value }) }, h('option', { value: 'account' }, '我的推荐流（增强）'), h('option', { value: 'official' }, '官方热榜 / 搜索'))),
          h('label', { 'data-bd-label': '' }, accountMode ? '关键词（留空刷推荐流）' : '关键词（留空刷热榜）', h('input', { 'data-bd-input': '', value: cfg.keywords, onChange: (e) => setState({ ...state, config: { ...cfg, keywords: e.target.value } }), onBlur: (e) => save({ keywords: e.target.value }) })),
          accountMode ? h(React.Fragment, null,
            h('div', { 'data-bd-row': '' }, h(ToggleRow, { label: '自动点赞', on: cfg.autoLike, onChange: (v) => save({ autoLike: v }) }), h(ToggleRow, { label: '自动评论', on: cfg.autoComment, onChange: (v) => save({ autoComment: v }) }), h(ToggleRow, { label: '自动回复', on: cfg.autoReply, onChange: (v) => save({ autoReply: v }) })),
            h('div', { 'data-bd-note': '' }, '同一人在同一内容下最多回复两轮；写操作先记账，失败或超时不自动重试。')) : null,
          h('div', { 'data-bd-row': '' }, h('button', { 'data-bd-btn': '', onClick: run, disabled: state.running || unavailable }, state.running ? '正在刷…' : '现在刷一轮'), h('button', { 'data-bd-btn': '', onClick: async () => { const value = await request('/report'); setReport(report ? '' : value.text) } }, report ? '收起报告' : '看今天报告')),
          report ? h('pre', { 'data-bd-pre': '' }, report) : null),
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '主动发文'),
          h('div', { 'data-bd-note': '' }, '不填题目、不贴草稿。大肥鱼按当前人格自己决定主题并写一篇知乎文章；每天最多尝试一篇，提交前先记账，结果不明确时不重试。'),
          h('button', { 'data-bd-btn': '', disabled: state.posting || !state.provider.cliInstalled || !state.provider.accountLoggedIn, onClick: post }, state.posting ? '正在想主题…' : '让大肥鱼自己想主题并发一篇')),
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '账号与指令安全'),
          h(ToggleRow, { label: '允许本人想法发布 /dsh 指令', note: '硬校验已登录账号的 url_token；昵称、转载和别人复制前缀都无效。', on: cfg.trustedCommands, onChange: (v) => save({ trustedCommands: v }) }),
          h('label', { 'data-bd-label': '' }, '指令目标会话 ID', h('input', { 'data-bd-input': '', value: cfg.commandSession || '', placeholder: 'session-…', onChange: (e) => setState({ ...state, config: { ...cfg, commandSession: e.target.value } }), onBlur: (e) => save({ commandSession: e.target.value }) })),
          accountMode ? h('div', { 'data-bd-note': '' }, `增强 CLI：${state.provider.cliInstalled ? '已安装' : '未安装'}\n账号：${state.provider.accountLoggedIn ? '已登录' : '未登录'}${state.provider.accountError ? `\n检查失败：${state.provider.accountError}` : ''}\n请使用上方“扫码登录知乎”按钮`) : h(React.Fragment, null,
            h('div', { 'data-bd-row': '' }, h('input', { 'data-bd-input': '', 'data-bd-grow': '', type: 'password', value: secret, placeholder: cfg.hasAccessSecret ? 'Access Secret 已配置；留空不变' : '知乎 Access Secret', onChange: (e) => setSecret(e.target.value) }), h('button', { 'data-bd-btn': '', onClick: async () => { if (!secret.trim()) return; await save({ accessSecret: secret }); setSecret('') } }, '保存密钥'), cfg.secretSource === 'config' ? h('button', { 'data-bd-btn': '', onClick: () => save({ clearAccessSecret: true }) }, '清除密钥') : null),
            h('div', { 'data-bd-note': '' }, '官方模式只能采集，不能互动或主动发文；密钥状态不会回显。')),
          unavailable ? h('div', { 'data-bd-note': '' }, accountMode ? '请先使用上方按钮扫码登录，完成后会自动检查。' : '先配置知乎 Access Secret。') : null,
          message ? h('div', { 'data-bd-note': '' }, message) : null,
          h('div', { 'data-bd-note': '' }, `最近结果：${state.lastResult || '还没运行'}`))
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-zhihu-scroll styles')
        const slots = ctx.get?.('slots') || ctx.slots
        if (slots) slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'zhihu-scroll', order: 31, label: '刷知乎' }, () => h(Panel),
        ))
      },
    }
  },
})
