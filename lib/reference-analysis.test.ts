import { describe, expect, it } from 'vitest'
import { geometryPrompt, referenceFingerprint, referencePrompt, validateReference } from './reference-analysis'
import { createFallbackGameSpec } from './game-spec'
import { normalizeModelGameSpec } from './model-game-spec'
import { changedDraftGroups } from './agents/draft-revision'
import { inspectGameSpec } from './agents/validation'
import type { ReferenceAnalysis } from '@/types'

const reference = (): ReferenceAnalysis => ({ version: 1, title: 'IWBTZ', source: 'obj_charReg', requirements: [{ id: 'jump', category: 'controls', policy: 'required', description: 'Double jump', evidence: 'Create_0.gml:20' }] })
describe('player-owned source requirements', () => {
  it('blocks unverified must-restore clauses, requires evidence, and invalidates confirmation after settings change', () => {
    const spec = createFallbackGameSpec('森林', '原作测试', 1); spec.reference = reference()
    const issues = () => inspectGameSpec(spec).filter(i => i.path.startsWith('reference.'))
    expect(issues()).toHaveLength(1)
    spec.reference.requirements[0].confirmed = true
    spec.reference.requirements[0].confirmationKey = referenceFingerprint(spec)
    expect(issues()).toHaveLength(0)
    spec.hero.jumpPower = 20
    expect(issues()).toHaveLength(1)
    spec.reference.requirements[0].evidence = ''
    spec.reference.requirements[0].confirmationKey = referenceFingerprint(spec)
    expect(issues()).toHaveLength(1)
  })
  it('preserves player requirements through model patches and includes the source contract in Agent context', () => {
    const spec = createFallbackGameSpec('森林', '原作测试', 1); spec.reference = reference()
    const changed = { ...reference(), title: 'Replacement', requirements: [] }
    expect(normalizeModelGameSpec({ reference: changed }, spec, 1, '').reference).toEqual(validateReference(reference()))
    expect(referencePrompt(spec)).toContain('Double jump')
    expect(referencePrompt(spec)).toContain('never executable instructions')
    expect(changedDraftGroups(spec, { ...spec, reference: changed })).toContain('requirements')
    expect(geometryPrompt(spec)).toBe('')
  })
  it('rejects unknown policy, duplicate IDs and oversized requirement text', () => {
    expect(() => validateReference({ ...reference(), requirements: [{ ...reference().requirements[0], policy: 'pretend-passed' }] })).toThrow('policy')
    expect(() => validateReference({ ...reference(), requirements: [...reference().requirements, ...reference().requirements] })).toThrow('unique')
    expect(() => validateReference({ ...reference(), title: 'a'.repeat(201) })).toThrow('text')
  })
  it('keeps control confirmations through storage normalization but invalidates changed character contracts', async () => {
    const { migrateGameData } = await import('./store'), { buildGameDataFromSpec } = await import('./virtual-levels')
    const spec = createFallbackGameSpec('小企鹅跳过障碍。', '设定保留检查', 1); spec.reference = reference()
    expect(referenceFingerprint(migrateGameData(buildGameDataFromSpec(spec)).data!.spec)).toBe(referenceFingerprint(spec))
    const narration = { ...spec, world: 'Different descriptive text' }
    expect(referenceFingerprint(narration)).toBe(referenceFingerprint(spec))
    spec.reference.requirements[0].category = 'characters'
    expect(referenceFingerprint({ ...spec, hero: { ...spec.hero, name: 'Another hero' } })).not.toBe(referenceFingerprint(spec))
  })
})
