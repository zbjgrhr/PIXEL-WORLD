import type { CommunityActor, CommunityMedia, CommunityPost, CommunitySection, ExperimentRecord, MediaKind } from './community-types'
import { ARTWORK_KINDS } from './community-types'

// Below Supabase Free's documented 50 MB/file limit. Local game exports are unaffected.
export const COMMUNITY_MAX_FILE_BYTES = 45_000_000
const uploadTypes: Record<string, { kind: MediaKind; mime: string[] }> = {
  png: { kind: 'image', mime: ['image/png'] },
  jpg: { kind: 'image', mime: ['image/jpeg'] },
  jpeg: { kind: 'image', mime: ['image/jpeg'] },
  webp: { kind: 'image', mime: ['image/webp'] },
  gif: { kind: 'image', mime: ['image/gif'] },
  mp4: { kind: 'video', mime: ['video/mp4'] },
  webm: { kind: 'video', mime: ['video/webm'] },
  mp3: { kind: 'audio', mime: ['audio/mpeg'] },
  wav: { kind: 'audio', mime: ['audio/wav', 'audio/x-wav'] },
  ogg: { kind: 'audio', mime: ['audio/ogg'] },
  zip: { kind: 'game-zip', mime: ['application/zip', 'application/x-zip-compressed'] },
  json: { kind: 'game-spec', mime: ['application/json'] },
  md: { kind: 'report', mime: ['text/markdown', 'text/plain'] },
  txt: { kind: 'report', mime: ['text/plain'] },
  log: { kind: 'report', mime: ['text/plain'] },
}

/** Metadata preflight only: the upload endpoint must also verify actual bytes. */
export function validateCommunityUpload(file: { name: string; mime: string; bytes: number }, section: CommunitySection): MediaKind {
  if (!file.name || file.name.length > 255 || /[\\/\x00-\x1f]/.test(file.name)) throw new Error('Use a plain file name, not a local path.')
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > COMMUNITY_MAX_FILE_BYTES) throw new Error('The file must be between 1 byte and 45 MB.')
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const rule = uploadTypes[extension]
  if (!rule || !rule.mime.includes(file.mime.toLowerCase())) throw new Error('The file type does not match a supported format.')
  if (section === 'art' && !['image', 'video', 'audio'].includes(rule.kind)) throw new Error('Artwork posts accept images, video, and audio.')
  return rule.kind
}

const credentialPattern = /(?:\bsk-(?:or-v1-)?[a-z\d_-]{20,}|\bBearer\s+[a-z\d._~-]{16,}|\b(?:api[_ -]?key|access[_ -]?token|service[_ -]?role[_ -]?key)["']?\s*[:=]\s*["']?[a-z\d._~-]{8,})/i
export function assertPublicText(text: string) {
  if (credentialPattern.test(text)) throw new Error('Remove credentials before submitting this content.')
}

type PostInput = Pick<CommunityPost, 'section' | 'language' | 'title' | 'description' | 'experimentId' | 'mediaIds' | 'rights' | 'licenseNote' | 'reuse' | 'artKind' | 'linkedGameId'>

/** Actor and ID must come from the server session, never a request's authorId. */
export function createCommunityDraft(input: PostInput, actor: CommunityActor | null, id: string, now: string): CommunityPost {
  if (!actor?.userId) throw new Error('Sign in before posting.')
  if (!/^[a-z\d_-]{1,120}$/i.test(id) || !Number.isFinite(Date.parse(now))) throw new Error('Invalid post ID or timestamp.')
  if (input.experimentId !== null && (typeof input.experimentId !== 'string' || !/^[a-z\d_-]{1,120}$/i.test(input.experimentId))) throw new Error('Invalid experiment reference.')
  if (!['workshop', 'art'].includes(input.section) || !['zh-CN', 'en'].includes(input.language)) throw new Error('Invalid section or language.')
  if (!['original', 'ai-generated', 'licensed'].includes(input.rights) || !['view-only', 'download', 'remix-with-credit'].includes(input.reuse)) throw new Error('Choose the source and reuse permissions.')
  const artKind = input.artKind ?? 'other', linkedGameId = input.linkedGameId ?? null
  if (!ARTWORK_KINDS.includes(artKind) || linkedGameId !== null && (typeof linkedGameId !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(linkedGameId))
    || input.section !== 'art' && (artKind !== 'other' || linkedGameId !== null)) throw new Error('Check the artwork category and related game.')
  const title = input.title.trim(), description = input.description.trim(), licenseNote = input.licenseNote.trim()
  if (!title || title.length > 120 || !description || description.length > 10_000 || licenseNote.length > 2_000) throw new Error('Check the title and description length.')
  if (input.rights === 'licensed' && !licenseNote) throw new Error('Describe the permission for licensed content.')
  if (!Array.isArray(input.mediaIds) || input.mediaIds.length > 30 || input.mediaIds.some(value => typeof value !== 'string' || !/^[a-z\d_-]{1,120}$/i.test(value))) throw new Error('Invalid media references.')
  assertPublicText([title, description, licenseNote].join('\n'))
  return { id, ownerId: actor.userId, section: input.section, language: input.language, title, description,
    experimentId: input.experimentId, mediaIds: [...new Set(input.mediaIds)], rights: input.rights,
    licenseNote, reuse: input.reuse, artKind, linkedGameId, moderation: 'draft', createdAt: now }
}

export function assertPostOwner(post: Pick<CommunityPost, 'ownerId'>, actor: CommunityActor | null) {
  if (!actor?.userId || post.ownerId !== actor.userId) throw new Error('You can only change your own posts.')
}

/** Publishing needs trusted upload records in addition to valid text; drafts may lack them. */
export function publicationIssues(post: CommunityPost, media: CommunityMedia[], run?: ExperimentRecord): string[] {
  const issues: string[] = []
  for (const id of post.mediaIds) {
    const item = media.find(item => item.id === id)
    if (!item || item.ownerId !== post.ownerId || !item.verifiedAt || !/^[a-f\d]{64}$/.test(item.sha256)
      || !item.storageKey.startsWith(`${post.ownerId}/`) || item.storageKey.includes('..') || !/^[a-z\d_./-]+$/i.test(item.storageKey)
      || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > COMMUNITY_MAX_FILE_BYTES) {
      issues.push(`Unverified or inaccessible media: ${id}`)
      continue
    }
    if (post.section === 'art' && !['image', 'video', 'audio'].includes(item.kind)) issues.push(`Unsupported artwork attachment: ${id}`)
    if (post.experimentId && item.runId !== post.experimentId) issues.push(`Media belongs to a different experiment: ${id}`)
  }
  if (post.experimentId && (!run || run.id !== post.experimentId || run.ownerId !== post.ownerId || run.language !== post.language)) issues.push('The linked experiment does not match this author and language.')
  return issues
}

/** Failed experiments remain publishable; completed and template-worthy are distinct. */
export function templateEligibility(run: ExperimentRecord, media: CommunityMedia[]): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (run.outcome !== 'completed') reasons.push('The experiment is not complete.')
  if (run.templateReview.state !== 'accepted' || !run.templateReview.reviewerId || !run.templateReview.reviewedAt) reasons.push('Template review has not been accepted.')
  const owned = media.filter(item => item.runId === run.id && item.ownerId === run.ownerId && item.verifiedAt
    && /^[a-f\d]{64}$/.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0 && run.mediaIds.includes(item.id))
  const evidenceIds = new Set(owned.map(item => item.id))
  for (const name of ['storyFidelity', 'artQuality', 'webPlaythrough', 'offlinePlaythrough'] as const) {
    const check = run.checks[name]
    if (!check || check.state !== 'passed' || !check.evidenceIds.length || check.evidenceIds.some(id => !evidenceIds.has(id))) reasons.push(`${name}: missing passed evidence from this run.`)
  }
  for (const kind of ['game-spec', 'game-zip', 'video'] as const) {
    if (!owned.some(item => (item.kind === kind || kind === 'video' && item.kind === 'image' && /\.(gif|webp)$/i.test(item.storageKey))
      && (kind !== 'video' || item.durationSeconds !== null && item.durationSeconds > 0 && item.durationSeconds <= 60))) reasons.push(`Missing verified ${kind} from this run.`)
  }
  if (run.issues.some(issue => !issue.resolved && issue.severity !== 'minor')) reasons.push('Blocking or major issues remain unresolved.')
  if (run.fallback.supplementedTasks < 0 || run.fallback.totalImageTasks < run.fallback.supplementedTasks || run.fallback.items.length !== run.fallback.supplementedTasks) reasons.push('The fallback record is incomplete.')
  return { eligible: reasons.length === 0, reasons }
}
