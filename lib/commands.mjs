import { readFileSync } from 'node:fs'
import { writeJsonAtomic } from './core.mjs'

export function trustedCommand(item, ownerId) {
  if (!ownerId || String(item?.authorId || '') !== String(ownerId)) return ''
  const match = /^\/dsh\s+([\s\S]+)$/i.exec(String(item?.text || item?.title || '').trim())
  return match ? match[1].trim().slice(0, 4000) : ''
}

export function claimCommands(file, items, ownerId) {
  let state = { ids: [] }
  try { state = JSON.parse(readFileSync(file, 'utf8')) } catch { /* 首次运行 */ }
  const seen = new Set(Array.isArray(state.ids) ? state.ids.map(String) : [])
  const commands = []
  for (const item of items) {
    const text = trustedCommand(item, ownerId)
    if (!text || seen.has(String(item.id))) continue
    seen.add(String(item.id)); commands.push({ id: String(item.id), text })
  }
  if (commands.length) writeJsonAtomic(file, { ids: [...seen].slice(-1000) })
  return commands
}
