import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlusArgs, prepareZhihuAction } from '../lib/provider.mjs'

test('enhanced mode is read-only and bounded', () => {
  assert.deepEqual(buildPlusArgs({ keywords: '', limit: 99, commentLimit: 99 }), [
    'feeds', '--limit', '30', '--comment-limit', '5', '--json',
  ])
  assert.deepEqual(buildPlusArgs({ keywords: 'AI', limit: 4, commentLimit: 3 }), [
    'search', 'AI', '--limit', '4', '--answers', '0', '--json',
  ])
})

test('write actions are bounded CLI calls without retries', () => {
  assert.deepEqual(prepareZhihuAction({ kind: 'like', targetType: 'answer', targetId: '123' }).args, ['vote', '123', '--up', '--json'])
  assert.deepEqual(prepareZhihuAction({ kind: 'like', targetType: 'comment', targetId: '456', undo: true }).args, ['like-comment', '456', '--undo', '--json'])
  assert.deepEqual(prepareZhihuAction({ kind: 'comment', targetType: 'article', targetId: '7', text: '认真评论' }).args, ['comment', '7', '认真评论', '--type', 'article', '--json'])
  assert.deepEqual(prepareZhihuAction({ kind: 'reply', targetType: 'pin', targetId: '7', replyTo: '8', text: '到这里就收住' }).args, ['reply', '7', '8', '到这里就收住', '--type', 'pin', '--json'])
  assert.deepEqual(prepareZhihuAction({ kind: 'post', targetType: 'pin', title: '标题', text: '正文' }).args, ['pin', '标题', '--content', '正文', '--json'])
  assert.throws(() => prepareZhihuAction({ kind: 'like', targetType: 'answer', targetId: '--help' }), /目标 ID/)
  assert.equal(prepareZhihuAction({ kind: 'reply', targetType: 'answer', targetId: '1', replyTo: '2', text: '字'.repeat(120) }).args[3].length, 100)
})
