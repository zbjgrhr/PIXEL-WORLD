import { createProject, importProject, type WorldProject } from './project-library'
import { parseSpatialProject, serializeSpatialProject, type SpatialProject } from './spatial/spec'
import { buildSpatialHtml } from './spatial/export'
import { readStoredGameArchive } from './community-play-archive'
import { readEditableProject } from './editable-project'
import { makeZip } from './export-game'

export function spatialWorldProject(value: unknown): WorldProject {
  const spatial = parseSpatialProject(value), project = createProject(spatial.genre, spatial.title)
  project.spatial = spatial
  project.draft.story = spatial.brief
  project.planning.bpm = spatial.rhythm.bpm
  project.planning.lanes = 4
  return project
}
export async function readProjectFile(file: Pick<File, 'name' | 'size' | 'text' | 'arrayBuffer'>): Promise<WorldProject> {
  if (file.size > 64 * 1024 * 1024) throw Error('导入文件不能超过64 MB。')
  if (/\.zip$/i.test(file.name)) {
    const buffer = await file.arrayBuffer()
    const files = readStoredGameArchive(buffer, true)
    const entry = files.find(f => f.name === 'project.json')!
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes))
    if (data.schema === 'pixel-world/spatial') return spatialWorldProject(data)
    const spec = await readEditableProject(buffer), project = createProject('platformer', spec.title)
    project.draft = { name: spec.title, story: spec.backgroundStory || '', prompt: '', levelCount: spec.levels.length, creationLanguage: spec.creationLanguage === 'en' ? 'en' : 'zh-CN', spec }
    project.publishedSpec = spec
    return project
  }
  const text = await file.text(), value = JSON.parse(text)
  return value?.schema === 'pixel-world/spatial' ? spatialWorldProject(value) : importProject(text)
}
export function buildSpatialZip(project: SpatialProject, runtime: string): Blob {
  const encode = (s: string) => new TextEncoder().encode(s)
  return makeZip([{ name: 'index.html', bytes: encode(buildSpatialHtml(project, runtime)) }, { name: 'project.json', bytes: encode(serializeSpatialProject(project)) }])
}
