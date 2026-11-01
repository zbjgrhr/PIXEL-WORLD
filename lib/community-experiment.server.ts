import type { CommunityMedia, ExperimentRecord } from './community-types'
import { checkedPublicText, checkPublicJsonValue } from './community-file-rules.server'
import { COMMUNITY_MAX_FILE_BYTES } from './community-validation'

export class ExperimentRecordError extends Error {
  constructor(field: string) { super(`Check experiment field: ${field}.`) }
}
function fail(field: string): never { throw new ExperimentRecordError(field) }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field)
  return value as Record<string, unknown>
}
function text(value: unknown, field: string, max = 2000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.trim()) fail(field)
  return value.trim()
}
function integer(value: unknown, field: string, max = 1_000_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) fail(field)
  return value as number
}
function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(field)
  return value
}
function choice<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) fail(field)
  return value as T
}
function timestamp(value: unknown, field: string): string | null {
  if (value === null) return null
  const result = text(value, field, 40)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) fail(field)
  return result
}

/** Canonical author-reported record. Evidence checks do not grant template approval. */
export function importExperimentRecord(input: unknown, ownerId: string, id: string, attachments: CommunityMedia[]): ExperimentRecord {
  const raw = object(input, 'record')
  let encoded: Uint8Array
  try { encoded = new TextEncoder().encode(JSON.stringify(raw)) } catch { return fail('record') }
  if (encoded.byteLength > 48_000) fail('record size')
  // Inspect all fields, even unknown ones, before constructing a public whitelist.
  try { checkedPublicText(encoded); checkPublicJsonValue(raw) } catch { return fail('private information') }
  const mediaIds = list(raw.mediaIds, 'mediaIds', 30).map(value => text(value, 'mediaIds', 120))
  if (new Set(mediaIds).size !== mediaIds.length || mediaIds.length !== attachments.length || new Set(attachments.map(item => item.id)).size !== attachments.length) fail('mediaIds')
  for (const item of attachments) {
    if (!mediaIds.includes(item.id) || item.ownerId !== ownerId || item.runId !== null || !item.verifiedAt || !/^[a-f\d]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > COMMUNITY_MAX_FILE_BYTES) fail('verified attachments')
  }
  const ids = (value: unknown, field: string) => {
    const entries = list(value, field, 30).map(item => text(item, field, 120))
    if (new Set(entries).size !== entries.length || entries.some(item => !mediaIds.includes(item))) fail(field)
    return entries
  }
  const model = object(raw.models, 'models'), usage = object(raw.usage, 'usage'), fallback = object(raw.fallback, 'fallback'), checks = object(raw.checks, 'checks')
  const check = (name: keyof ExperimentRecord['checks']) => {
    const value = object(checks[name], name)
    const state = choice(value.state, ['not-tested','passed','failed'] as const, name)
    const evidenceIds = ids(value.evidenceIds, `${name} evidence`)
    if (state === 'passed' && !evidenceIds.length) fail(`${name} evidence`)
    return { state, evidenceIds, note: text(value.note, `${name} note`, 2000, state === 'not-tested') }
  }
  const timing = list(raw.timing, 'timing', 300).map(entry => {
    const value = object(entry, 'timing')
    const startedAt = timestamp(value.startedAt, 'startedAt'), endedAt = timestamp(value.endedAt, 'endedAt')
    const elapsedMs = value.elapsedMs === null ? null : integer(value.elapsedMs, 'elapsedMs', 31_536_000_000)
    if (startedAt && endedAt) {
      const elapsed = Date.parse(endedAt) - Date.parse(startedAt)
      if (elapsed < 0 || elapsedMs !== null && Math.abs(elapsed - elapsedMs) > Math.max(1000, elapsed * .01)) fail('timing consistency')
    }
    return { stage: text(value.stage, 'stage', 200), startedAt, endedAt, elapsedMs }
  })
  const budgetUsd = usage.budgetUsd, costUsd = usage.costUsd
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 1_000_000
    || costUsd !== null && (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0 || costUsd > 1_000_000)) fail('usage')
  const costSource = choice(usage.costSource, ['actual','estimated','unknown'] as const, 'costSource')
  if ((costSource === 'unknown') !== (costUsd === null)) fail('costSource')
  const fallbackItems = list(fallback.items, 'fallback items', 1000).map(entry => {
    const value = object(entry, 'fallback item')
    return { assetId: text(value.assetId, 'assetId', 120), pose: value.pose === null ? null : text(value.pose, 'pose', 80), source: choice(value.source, ['builtin','existing-pose'] as const, 'fallback source'), reason: text(value.reason, 'fallback reason') }
  })
  const totalImageTasks = integer(fallback.totalImageTasks, 'totalImageTasks', 1000), supplementedTasks = integer(fallback.supplementedTasks, 'supplementedTasks', 1000)
  if (supplementedTasks > totalImageTasks || supplementedTasks !== fallbackItems.length || new Set(fallbackItems.map(item => `${item.assetId}:${item.pose}`)).size !== fallbackItems.length) fail('fallback counts')
  const issues = list(raw.issues, 'issues', 100).map(entry => {
    const value = object(entry, 'issue')
    if (typeof value.resolved !== 'boolean') fail('issue resolved')
    return { id: text(value.id, 'issue ID', 120), severity: choice(value.severity, ['blocking','major','minor'] as const, 'severity'), description: text(value.description, 'issue description'), evidenceIds: ids(value.evidenceIds, 'issue evidence'), proposedFix: text(value.proposedFix, 'proposedFix', 2000, true), taskId: text(value.taskId, 'taskId', 120, true), resolved: value.resolved }
  })
  if (new Set(issues.map(item => item.id)).size !== issues.length) fail('issue IDs')
  if (typeof raw.dirtyWorktree !== 'boolean') fail('dirtyWorktree')
  const projectCommit = text(raw.projectCommit, 'projectCommit', 40)
  if (!/^(?:[a-f\d]{7,40}|unknown)$/i.test(projectCommit)) fail('projectCommit')
  const levelCount = integer(raw.levelCount, 'levelCount', 20)
  if (!levelCount) fail('levelCount')
  const result: ExperimentRecord = {
    id, ownerId, pairId: text(raw.pairId, 'pairId', 120), language: choice(raw.language, ['zh-CN','en'] as const, 'language'),
    tier: choice(raw.tier, ['low','medium','high'] as const, 'tier'), outcome: choice(raw.outcome, ['completed','partial','failed'] as const, 'outcome'),
    title: text(raw.title, 'title', 120), story: text(raw.story, 'story', 6000), levelCount, projectCommit, dirtyWorktree: raw.dirtyWorktree, promptVersion: text(raw.promptVersion, 'promptVersion', 200),
    models: { textProvider: text(model.textProvider, 'textProvider', 120), textModelId: text(model.textModelId, 'textModelId', 200), imageProvider: text(model.imageProvider, 'imageProvider', 120), imageModelId: text(model.imageModelId, 'imageModelId', 200) }, timing,
    usage: { budgetUsd, costUsd: costUsd as number | null, costSource, calls: usage.calls === null ? null : integer(usage.calls, 'calls'), tokens: usage.tokens === null ? null : integer(usage.tokens, 'tokens') },
    fallback: { totalImageTasks, supplementedTasks, items: fallbackItems }, checks: { storyFidelity: check('storyFidelity'), artQuality: check('artQuality'), webPlaythrough: check('webPlaythrough'), offlinePlaythrough: check('offlinePlaythrough') },
    issues, mediaIds, templateReview: { state: 'not-reviewed', reviewerId: null, reviewedAt: null },
  }
  if (result.outcome === 'completed' && (result.checks.webPlaythrough.state !== 'passed' || result.checks.offlinePlaythrough.state !== 'passed'
    || !attachments.some(item => item.kind === 'game-zip') || !attachments.some(item => item.kind === 'game-spec') || result.issues.some(item => !item.resolved && item.severity !== 'minor'))) fail('completed outcome')
  return result
}
