import { describe, expect, it } from 'vitest'
import { spatialDraftKey, restoreSpatialDraft } from './studio-draft'
import { spatialWorldProject } from '../project-file'
import { createSpatialProject } from './spec'

describe('per-project spatial editing drafts', () => {
  const project = spatialWorldProject(createSpatialProject('星夜', 'rhythm'))
  const encoded = (patch: Record<string, unknown> = {}) => JSON.stringify({ config: { ...project.spatial, rhythm: { ...project.spatial!.rhythm, bpm: 120 } }, applied: project.spatial, record: project, stage: 'rules', previewCreated: true, ...patch })
  it('isolates two works and the unbound new-work draft', () => {
    expect(new Set([spatialDraftKey('rhythm'), spatialDraftKey('rhythm', 'a'), spatialDraftKey('rhythm', 'b'), spatialDraftKey('exploration', 'a')]).size).toBe(4)
  })
  it('restores unsaved rules and navigation while preserving the earlier preview', () => {
    const restored = restoreSpatialDraft(encoded(), 'rhythm', project)!
    expect(restored.config.rhythm.bpm).toBe(120); expect(restored.applied.rhythm.bpm).toBe(100)
    expect(restored.stage).toBe('rules'); expect(restored.dirty).toBe(true)
  })
  it('does not overwrite newer project revisions or restore a different work', () => {
    expect(restoreSpatialDraft(encoded(), 'rhythm', { ...project, revision: project.revision + 1 })).toBeNull()
    expect(restoreSpatialDraft(encoded(), 'rhythm', { ...project, id: 'custom-other' })).toBeNull()
  })
  it('recognizes an unchanged saved work when returning through the genre shortcut', () => {
    expect(restoreSpatialDraft(encoded({ config: project.spatial }), 'rhythm')!.dirty).toBe(false)
  })
  it('preserves temporarily empty text without letting it become the playable spec', () => {
    const restored = restoreSpatialDraft(encoded({ config: { ...project.spatial, title: '', brief: '' } }), 'rhythm', project)!
    expect(restored.config.title).toBe(''); expect(restored.applied.title).toBeTruthy()
  })
  it('rejects cross-genre and invalid rules from stored drafts', () => {
    expect(() => restoreSpatialDraft(encoded(), 'exploration')).toThrow('不匹配')
    expect(() => restoreSpatialDraft(encoded({ config: { ...project.spatial, arenaSize: 99999 } }), 'rhythm')).toThrow()
  })
})
