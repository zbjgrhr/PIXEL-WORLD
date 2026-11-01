import { assertPublicText } from './community-validation'

export class CommunityFileError extends Error {
  constructor(public readonly code: 'INVALID_CONTENT' | 'TYPE_MISMATCH' | 'LIMIT_EXCEEDED' | 'PRIVATE_CONTENT' | 'INVALID_ARCHIVE') {
    super('The file could not be verified. Check its format, size, and private information.')
  }
}

/** JSON escaping must not hide a credential or private path inside a string. */
export function checkPublicJsonValue(value: unknown, depth = 0): void {
  if (depth > 20) throw new CommunityFileError('LIMIT_EXCEEDED')
  if (typeof value === 'string') { checkedPublicText(new TextEncoder().encode(value)); return }
  if (Array.isArray(value)) { value.forEach(item => checkPublicJsonValue(item, depth + 1)); return }
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    checkPublicJsonValue(key, depth + 1); checkPublicJsonValue(item, depth + 1)
  }
}

/** Do not echo parser errors or text containing a credential into responses/logs. */
export function checkedPublicText(bytes: Uint8Array): string {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new CommunityFileError('INVALID_CONTENT') }
  try { assertPublicText(text) } catch { throw new CommunityFileError('PRIVATE_CONTENT') }
  if (/(?:\b[A-Z]:[\\/](?:Users|Documents and Settings)[\\/]|file:\/\/|\/Users\/[^\s/]+\/|\/home\/[^\s/]+\/)/i.test(text)) throw new CommunityFileError('PRIVATE_CONTENT')
  return text
}

export function checkSpecText(text: string): { language: 'zh-CN' | 'en'; levelCount: number } {
  let value
  try { value = JSON.parse(text) } catch { throw new CommunityFileError('INVALID_CONTENT') }
  checkPublicJsonValue(value)
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.title !== 'string' || !value.title.trim()
    || typeof value.world !== 'string' || !value.world.trim() || typeof value.hero?.name !== 'string' || !value.hero.name.trim()
    || typeof value.boss?.name !== 'string' || !value.boss.name.trim() || !Array.isArray(value.levels) || !value.levels.length || value.levels.length > 20
    || !Array.isArray(value.assets) || value.assets.length > 1000
    || value.creationLanguage !== undefined && !['zh-CN', 'en'].includes(value.creationLanguage)) throw new CommunityFileError('INVALID_CONTENT')
  const ids = value.levels.map((level: { id?: unknown; name?: unknown }) => level?.id)
  if (ids.some((id: unknown) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new CommunityFileError('INVALID_CONTENT')
  return { language: value.creationLanguage || 'zh-CN', levelCount: value.levels.length }
}
