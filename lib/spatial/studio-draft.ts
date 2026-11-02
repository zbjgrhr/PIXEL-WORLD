import { parseSpatialProject, type SpatialProject } from './spec'
import type { WorldProject } from '../project-library'

export type SpatialStage = 'idea' | 'rules' | 'publish'
export function spatialDraftKey(mode: SpatialProject['genre'], projectId?: string): string {
  const base = `pixel-world-home-${mode}-draft-v1`
  return projectId ? `${base}:${projectId}` : base
}
export function restoreSpatialDraft(raw: string | null, mode: SpatialProject['genre'], project?: WorldProject) {
  if (!raw) return null
  const saved = JSON.parse(raw)
  if (project && (saved.record?.id !== project.id || saved.record?.revision !== project.revision)) return null
  const applied = parseSpatialProject(saved.applied || saved.config)
  if (applied.genre !== mode) throw Error('草稿玩法不匹配。')
  const input = saved.config || applied
  if (typeof input.title !== 'string' || typeof input.brief !== 'string') throw Error('草稿文字字段无效。')
  // Empty text is a valid in-progress edit, but cannot enter the runtime.
  const config = { ...parseSpatialProject({ ...input, title: input.title.trim() ? input.title : applied.title, brief: input.brief.trim() ? input.brief : applied.brief }), title: input.title, brief: input.brief }
  if (config.genre !== mode) throw Error('草稿玩法不匹配。')
  const savedProject = project || saved.record as WorldProject | undefined
  return { config, applied, record: project || saved.record as WorldProject | undefined,
    previewCreated: Boolean(saved.previewCreated || saved.record?.spatial),
    stage: (['idea', 'rules', 'publish'].includes(saved.stage) ? saved.stage : 'idea') as SpatialStage,
    dirty: !savedProject?.spatial || JSON.stringify(config) !== JSON.stringify(savedProject.spatial),
  }
}
