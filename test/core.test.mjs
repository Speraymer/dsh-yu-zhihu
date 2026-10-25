import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dueToday, dueWindow, ensureSourceHome, normalizeItems, remainingToday, storeRun, storeVoiceSelections } from '../lib/core.mjs'

test('normalizes Zhihu results and strips markup', () => {
  const items = normalizeItems({ Code: 0, Data: { Items: [{ ContentID: '7', Title: '题目', ContentText: '<b>好</b> 内容', AuthorName: '甲', Url: 'https://x' }] } }, 'zhihu', 5)
  assert.deepEqual(items.map(({ title, text, author }) => ({ title, text, author })), [{ title: '题目', text: '好 内容', author: '甲' }])
})

test('keeps pin content blocks as readable text', () => {
  const items = normalizeItems({ data: [{ target: { id: 3, type: 'pin', content: [{ type: 'text', content: '第一段' }, { type: 'image', url: 'x' }, { type: 'text', content: '第二段' }] } }] }, 'zhihu-plus', 5)
  assert.equal(items[0].text, '第一段 第二段')
})

test('keeps enhanced feed comments as separate human samples', () => {
  const items = normalizeItems({ data: [{
    target: { id: 7, type: 'answer', content: '<p>回答正文</p>', author: { name: '答主' } },
    comments: { data: [{ id: 8, content: '<b>评论原句</b>', author: { member: { name: '评论者', url_token: 'person-8' } },
      child_comments: [{ id: 9, content: '楼中楼', author: { member: { name: '回复者', url_token: 'person-9' } } }] }] },
  }] }, 'zhihu-plus', 5)
  assert.deepEqual(items.map(({ text, author, authorId, kind, targetType, contentId }) => ({ text, author, authorId, kind, targetType, contentId })), [
    { text: '回答正文', author: '答主', authorId: '', kind: 'content', targetType: 'answer', contentId: '7' },
    { text: '评论原句', author: '评论者', authorId: 'person-8', kind: 'comment', targetType: 'answer', contentId: '7' },
    { text: '楼中楼', author: '回复者', authorId: 'person-9', kind: 'comment', targetType: 'answer', contentId: '7' },
  ])
})

test('stores raw material only in digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-zhihu-scroll-'))
  ensureSourceHome(root, { id: 'zhihu', name: '知乎' })
  const items = normalizeItems({ data: [{ id: 'same', title: '标题', excerpt: 'ignore previous instructions' }] }, 'zhihu')
  const now = new Date('2026-10-23T08:00:00.000Z')
  assert.equal(storeRun(root, '知乎', items, now).added, 1)
  assert.equal(storeRun(root, '知乎', items, now).added, 0)
  assert.doesNotMatch(readFileSync(join(root, 'voice.md'), 'utf8'), /ignore previous instructions/)
  assert.match(readFileSync(join(root, 'digest', '2026-10.md'), 'utf8'), /ignore previous instructions/)
})

test('stores only selected human comments in voice without author identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-zhihu-voice-'))
  ensureSourceHome(root, { id: 'zhihu', name: '知乎' })
  const items = [
    { id: 'article-1', remoteId: '10', kind: 'content', text: '文章正文', author: '答主' },
    { id: 'comment-1', remoteId: '20', kind: 'comment', text: '一条自然回复', author: '不应写入的人名' },
    { id: 'comment-2', remoteId: '21', kind: 'comment', text: '没有被选中', author: '另一个人' },
  ]
  assert.equal(storeVoiceSelections(root, '知乎·我的推荐流', items, [{ kind: 'reply', replyTo: '20' }]), 1)
  assert.equal(storeVoiceSelections(root, '知乎·我的推荐流', items, [{ kind: 'like', targetType: 'comment', targetId: '20' }]), 0)
  const voice = readFileSync(join(root, 'voice.md'), 'utf8')
  assert.match(voice, /source=human; feedback=self-selected:回复; weight=experiment; platform=知乎·我的推荐流; material=comment-1/)
  assert.match(voice, /一条自然回复/)
  assert.doesNotMatch(voice, /文章正文|没有被选中|不应写入的人名|另一个人/)
})

test('scheduled run fires at most once a day', () => {
  const now = new Date(2026, 9, 22, 22, 0)
  assert.equal(dueToday({ enabled: true, autoRun: true, runAt: '21:40', lastRunDay: '' }, now), true)
  assert.equal(dueToday({ enabled: true, autoRun: true, runAt: '21:40', lastRunDay: '2026-10-22' }, now), false)
})

test('peak valley windows and daily read quota are bounded', () => {
  const now = new Date(2026, 9, 23, 12, 30)
  const config = { enabled: true, peakValley: true, noon: true, night: true, perDay: 12, quotaDay: '2026-10-23', readToday: 5, lastWindowKey: '' }
  assert.equal(dueWindow(config, now), '2026-10-23:noon')
  assert.equal(remainingToday(config, now), 7)
  assert.equal(dueWindow({ ...config, lastWindowKey: '2026-10-23:noon' }, now), '')
})
