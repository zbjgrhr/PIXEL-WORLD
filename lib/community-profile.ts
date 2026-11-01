import { assertPublicText } from './community-validation'

export const profileColumns = 'id,display_name,is_official,avatar_media_id,updated_at'
export interface ProfileRow { id: string; display_name: string; is_official: boolean; avatar_media_id: string | null; updated_at: string }
export interface PublicAuthor { id: string; displayName: string | null; isOfficial: boolean; avatarUrl: string | null }
export function publicAuthor(id: string, profile?: ProfileRow | null): PublicAuthor {
  return { id, displayName: profile?.display_name || null, isOfficial: profile?.is_official === true,
    avatarUrl: profile?.avatar_media_id ? `/api/community/profiles/${id}/avatar?v=${encodeURIComponent(profile.updated_at)}` : null }
}
export function profileInput(value: unknown) {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input.name !== 'string') throw new Error('name')
  const name = input.name.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('name')
  assertPublicText(name)
  const avatar = input.avatarMediaId
  if (avatar !== null && (typeof avatar !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(avatar))) throw new Error('avatar')
  if (input.updatedAt !== null && (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt)))) throw new Error('version')
  return { p_name: name, p_avatar: avatar as string | null, p_expected: input.updatedAt as string | null, p_public_consent: input.avatarPublicConsent === true }
}
