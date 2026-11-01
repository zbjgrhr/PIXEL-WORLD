import { describe, expect, it } from 'vitest'
import { assertPostOwner, assertPublicText, COMMUNITY_MAX_FILE_BYTES, createCommunityDraft, publicationIssues, templateEligibility, validateCommunityUpload } from './community-validation'
import type { CommunityMedia, ExperimentRecord } from './community-types'

const input = { section: 'workshop' as const, language: 'zh-CN' as const, title: '小企鹅找妈妈', description: '素材生成完成，但第一关位移异常，仍未通过试玩。', experimentId: 'run-05', mediaIds: ['evidence'], rights: 'ai-generated' as const, licenseNote: '', reuse: 'view-only' as const }
const actor = { userId: 'alice' }, date = '2026-10-31T01:00:00+08:00'
function evidence(id: string, kind: CommunityMedia['kind'] = 'image'): CommunityMedia {
  return { id, ownerId: 'alice', runId: 'run-05', kind, storageKey: `alice/run-05/${id}.bin`, sha256: 'a'.repeat(64), bytes: 1234, durationSeconds: kind === 'video' ? 55 : null, verifiedAt: date }
}
function completedRun(): ExperimentRecord {
  const check = () => ({ state: 'passed' as const, evidenceIds: ['evidence'], note: 'Verified evidence fixture, not a real game.' })
  return {
    id: 'run-05', ownerId: 'alice', pairId: 'low-pair', language: 'zh-CN', tier: 'low', outcome: 'completed',
    title: 'Test fixture', story: 'Test fixture', levelCount: 3, projectCommit: 'abcdef0', dirtyWorktree: true, promptVersion: 'test',
    models: { textProvider: 'test', textModelId: 'test-text', imageProvider: 'test', imageModelId: 'test-image' }, timing: [],
    usage: { budgetUsd: 2, costUsd: null, costSource: 'unknown', calls: null, tokens: null },
    fallback: { totalImageTasks: 45, supplementedTasks: 1, items: [{ assetId: 'item-1', pose: null, source: 'builtin', reason: 'Quality rejection' }] },
    checks: { storyFidelity: check(), artQuality: check(), webPlaythrough: check(), offlinePlaythrough: check() }, issues: [],
    mediaIds: ['evidence', 'spec', 'zip', 'video'], templateReview: { state: 'accepted', reviewerId: 'reviewer', reviewedAt: date },
  }
}
const media = () => [evidence('evidence'), evidence('spec', 'game-spec'), evidence('zip', 'game-zip'), evidence('video', 'video')]

describe('community drafts and ownership', () => {
  it('allows artwork categories and related UUIDs only on artwork posts', () => {
    const linkedGameId = '11111111-1111-4111-8111-111111111111'
    const post = createCommunityDraft({ ...input, section: 'art', experimentId: null, artKind: 'character', linkedGameId }, actor, 'post-1', date)
    expect(post.artKind).toBe('character'); expect(post.linkedGameId).toBe(linkedGameId)
    expect(() => createCommunityDraft({ ...input, artKind: 'character' }, actor, 'post-1', date)).toThrow(/artwork/)
    expect(() => createCommunityDraft({ ...input, section: 'art', linkedGameId: 'javascript:bad' }, actor, 'post-1', date)).toThrow(/artwork/)
  })
  it('binds the owner to the session and ignores requested publishing privileges', () => {
    const post = createCommunityDraft({ ...input, ownerId: 'mallory', moderation: 'published' } as typeof input, actor, 'post-1', date)
    expect(post.ownerId).toBe('alice')
    expect(post.moderation).toBe('draft')
    expect(() => createCommunityDraft(input, null, 'post-1', date)).toThrow(/Sign in/)
    expect(() => assertPostOwner(post, { userId: 'mallory' })).toThrow(/own/)
    expect(() => assertPostOwner(post, actor)).not.toThrow()
  })
  it('allows a failed experiment post without pretending the game is complete', () => {
    const post = createCommunityDraft(input, actor, 'post-1', date)
    const run = { ...completedRun(), outcome: 'failed' as const }
    expect(publicationIssues(post, media(), run)).toEqual([])
    expect(templateEligibility(run, media()).eligible).toBe(false)
  })
  it('does not publish local files, other authors uploads, or a mismatched language/run', () => {
    const post = createCommunityDraft(input, actor, 'post-1', date)
    expect(publicationIssues(post, [{ ...evidence('evidence'), storageKey: 'C:/Users/test/private.png', verifiedAt: null }], completedRun()).length).toBeGreaterThan(0)
    expect(publicationIssues(post, [{ ...evidence('evidence'), ownerId: 'mallory' }], completedRun()).length).toBeGreaterThan(0)
    expect(publicationIssues(post, [{ ...evidence('evidence'), runId: 'run-04' }], completedRun()).length).toBeGreaterThan(0)
    expect(publicationIssues(post, media(), { ...completedRun(), language: 'en' }).length).toBeGreaterThan(0)
  })
  it('requires a rights explanation and rejects credential-like public text', () => {
    expect(() => createCommunityDraft({ ...input, rights: 'licensed' }, actor, 'post-1', date)).toThrow(/permission/)
    expect(() => assertPublicText(`Bearer ${'example'.repeat(5)}`)).toThrow(/credentials/)
    expect(() => assertPublicText(`api_key=${'example'.repeat(5)}`)).toThrow(/credentials/)
    expect(() => assertPublicText(JSON.stringify({ api_key: 'example'.repeat(5) }))).toThrow(/credentials/)
    expect(() => assertPublicText('No API key was included.')).not.toThrow()
  })
})

describe('upload preflight', () => {
  it('accepts artwork media and rejects disguised files and executable formats', () => {
    expect(validateCommunityUpload({ name: 'sprite.png', mime: 'image/png', bytes: 1000 }, 'art')).toBe('image')
    for (const name of ['sprite.png.exe', 'game.html', 'script.svg']) expect(() => validateCommunityUpload({ name, mime: 'image/png', bytes: 1000 }, 'art')).toThrow()
    expect(() => validateCommunityUpload({ name: 'sprite.png', mime: 'video/mp4', bytes: 1000 }, 'art')).toThrow()
  })
  it('keeps archives in the workshop and enforces the free-tier size before upload', () => {
    const zip = { name: 'game.zip', mime: 'application/zip', bytes: 1000 }
    expect(validateCommunityUpload(zip, 'workshop')).toBe('game-zip')
    expect(() => validateCommunityUpload(zip, 'art')).toThrow()
    for (const bytes of [0, NaN, -1, 1.5, COMMUNITY_MAX_FILE_BYTES + 1]) expect(() => validateCommunityUpload({ ...zip, bytes }, 'workshop')).toThrow()
  })
})

describe('featured template gate', () => {
  it('requires accepted review, checks, same-run spec/ZIP and a short real recording', () => {
    expect(templateEligibility(completedRun(), media()).eligible).toBe(true)
    expect(templateEligibility(completedRun(), media().filter(item => item.kind !== 'game-zip')).eligible).toBe(false)
    expect(templateEligibility(completedRun(), media().map(item => item.kind === 'video' ? { ...item, durationSeconds: 61 } : item)).eligible).toBe(false)
    const run = completedRun()
    run.templateReview.state = 'not-reviewed'
    expect(templateEligibility(run, media()).eligible).toBe(false)
  })
  it('never treats a complete image queue as a passed playthrough', () => {
    const run = completedRun()
    run.checks.webPlaythrough = { state: 'failed', evidenceIds: ['evidence'], note: 'Movement stopped' }
    run.checks.offlinePlaythrough = { state: 'not-tested', evidenceIds: [], note: '' }
    run.issues.push({ id: 'movement', severity: 'blocking', description: 'Movement stopped', evidenceIds: ['evidence'], proposedFix: 'Diagnose physics/render coordinates', taskId: 'movement-05', resolved: false })
    expect(templateEligibility(run, media()).eligible).toBe(false)
  })
  it('rejects another run evidence and unspecified fallback sources', () => {
    expect(templateEligibility(completedRun(), media().map(item => ({ ...item, runId: 'run-04' }))).eligible).toBe(false)
    const run = completedRun()
    run.fallback.items = []
    expect(templateEligibility(run, media()).eligible).toBe(false)
  })
  it('accepts a verified short animated GIF as the demonstration, not a static image or an overlong animation', () => {
    const items = media().map(item => item.kind === 'video' ? { ...item, kind: 'image' as const, storageKey: 'alice/run-05/demo.gif', durationSeconds: 55 } : item)
    expect(templateEligibility(completedRun(), items).eligible).toBe(true)
    expect(templateEligibility(completedRun(), items.map(item => item.id === 'video' ? { ...item, durationSeconds: null } : item)).eligible).toBe(false)
    expect(templateEligibility(completedRun(), items.map(item => item.id === 'video' ? { ...item, durationSeconds: 61 } : item)).eligible).toBe(false)
    expect(templateEligibility(completedRun(), items.map(item => item.id === 'video' ? { ...item, storageKey: 'alice/run-05/static.png' } : item)).eligible).toBe(false)
  })
})
