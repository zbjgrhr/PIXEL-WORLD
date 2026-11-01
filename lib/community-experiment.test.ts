import { describe, expect, it } from 'vitest'
import { importExperimentRecord } from './community-experiment.server'
import type { CommunityMedia } from './community-types'

export function recordFixture() {
  const check = () => ({ state: 'not-tested', evidenceIds: [], note: '' })
  return {
    pairId: 'penguin-low', language: 'en', tier: 'low', outcome: 'failed', title: 'Penguin test', story: 'A penguin searches for its mother.', levelCount: 3,
    projectCommit: 'unknown', dirtyWorktree: true, promptVersion: 'record-test',
    models: { textProvider: 'test', textModelId: 'test-text', imageProvider: 'test', imageModelId: 'test-image' },
    timing: [{ stage: 'planning', startedAt: null, endedAt: null, elapsedMs: null }],
    usage: { budgetUsd: 2, costUsd: null, costSource: 'unknown', calls: null, tokens: null },
    fallback: { totalImageTasks: 0, supplementedTasks: 0, items: [] },
    checks: { storyFidelity: check(), artQuality: check(), webPlaythrough: check(), offlinePlaythrough: check() }, issues: [], mediaIds: [],
  }
}
const media = (id: string, kind: CommunityMedia['kind'] = 'image'): CommunityMedia => ({ id, ownerId: 'owner', runId: null, kind, storageKey: `owner/${id}.png`, sha256: 'a'.repeat(64), bytes: 1000, durationSeconds: null, verifiedAt: '2026-10-31T00:00:00Z' })
describe('canonical author-reported experiment import', () => {
  it('preserves a failed run without inventing evidence, costs or template approval', () => {
    const result = importExperimentRecord({ ...recordFixture(), id: 'forged', ownerId: 'other', templateReview: { state: 'accepted', reviewerId: 'self' }, extra: 'discarded' }, 'owner', 'server-run', [])
    expect(result.id).toBe('server-run'); expect(result.ownerId).toBe('owner')
    expect(result.outcome).toBe('failed'); expect(result.usage.costUsd).toBeNull()
    expect(result.templateReview).toEqual({ state: 'not-reviewed', reviewerId: null, reviewedAt: null })
    expect(result).not.toHaveProperty('extra')
  })
  it('requires an exact, verified, owned and previously unbound attachment set', () => {
    const input = { ...recordFixture(), mediaIds: ['evidence'] }
    expect(importExperimentRecord(input, 'owner', 'run', [media('evidence')]).mediaIds).toEqual(['evidence'])
    for (const file of [{ ...media('evidence'), ownerId: 'other' }, { ...media('evidence'), runId: 'old-round' }, { ...media('evidence'), verifiedAt: null }, { ...media('evidence'), sha256: '' }]) expect(() => importExperimentRecord(input, 'owner', 'run', [file])).toThrow()
    expect(() => importExperimentRecord(input, 'owner', 'run', [])).toThrow()
    expect(() => importExperimentRecord({ ...input, mediaIds: ['evidence','evidence'] }, 'owner', 'run', [media('evidence')])).toThrow()
  })
  it('rejects credentials and local private paths even in discarded fields', () => {
    for (const extra of ['api_key=' + 'example'.repeat(8), 'C:\\Users\\private\\report.txt']) expect(() => importExperimentRecord({ ...recordFixture(), extra }, 'owner', 'run', [])).toThrow(/private information/)
  })
  it('checks elapsed times and preserves unknown values instead of inventing durations', () => {
    const input = { ...recordFixture(), timing: [{ stage: 'images', startedAt: '2026-10-31T00:00:00Z', endedAt: '2026-10-31T00:00:10Z', elapsedMs: 10000 }] }
    expect(importExperimentRecord(input, 'owner', 'run', []).timing[0].elapsedMs).toBe(10000)
    expect(() => importExperimentRecord({ ...input, timing: [{ ...input.timing[0], elapsedMs: 20000 }] }, 'owner', 'run', [])).toThrow(/timing consistency/)
  })
  it('requires honest cost-source combinations while retaining an actual budget overrun', () => {
    const input = recordFixture()
    expect(() => importExperimentRecord({ ...input, usage: { ...input.usage, costUsd: 0 } }, 'owner', 'run', [])).toThrow(/costSource/)
    expect(importExperimentRecord({ ...input, usage: { ...input.usage, costUsd: 3, costSource: 'actual' } }, 'owner', 'run', []).usage.costUsd).toBe(3)
  })
  it('checks fallback details rather than accepting a summary count alone', () => {
    const input = recordFixture()
    expect(() => importExperimentRecord({ ...input, fallback: { totalImageTasks: 45, supplementedTasks: 1, items: [] } }, 'owner', 'run', [])).toThrow(/fallback counts/)
    expect(() => importExperimentRecord({ ...input, checks: { ...input.checks, webPlaythrough: { state: 'passed', evidenceIds: [], note: 'Claimed passed' } } }, 'owner', 'run', [])).toThrow(/evidence/)
  })
  it('does not accept image completion as a completed playable game', () => {
    expect(() => importExperimentRecord({ ...recordFixture(), outcome: 'completed' }, 'owner', 'run', [])).toThrow(/completed outcome/)
  })
  it('keeps a claimed complete run independently unreviewed even with verified evidence', () => {
    const input = recordFixture(), check = { state: 'passed', evidenceIds: ['proof'], note: 'Author-reported playthrough.' }
    const result = importExperimentRecord({ ...input, outcome: 'completed', mediaIds: ['proof','spec','zip'], checks: { ...input.checks, webPlaythrough: check, offlinePlaythrough: check } }, 'owner', 'run', [media('proof'),media('spec','game-spec'),media('zip','game-zip')])
    expect(result.outcome).toBe('completed'); expect(result.templateReview.state).toBe('not-reviewed')
  })
})
