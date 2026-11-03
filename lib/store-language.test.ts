import { describe, it, expect } from 'vitest'
import { migrateGameData } from './store'
import { createFallbackGameSpec } from './game-spec'
import { buildGameDataFromSpec } from './virtual-levels'

describe('saved game language', () => {
  it('retains English for a generated game without authored-map or physics overrides', () => {
    const spec = createFallbackGameSpec('A penguin finds its mother in Japan.', 'Penguin Reunion', 2, 'en')
    const data = buildGameDataFromSpec(spec)
    const restored = migrateGameData(data, 'custom-saved-id')
    expect(restored.data?.spec?.creationLanguage).toBe('en')
    expect(restored.data?.spec?.title).toBe('Penguin Reunion')
    expect(migrateGameData(restored, 'custom-saved-id').data?.spec?.creationLanguage).toBe('en')
  })
  it('keeps the existing Chinese default for legacy games without a language', () => {
    const spec = createFallbackGameSpec('找到妈妈', '企鹅团聚', 2)
    delete spec.creationLanguage
    expect(migrateGameData(buildGameDataFromSpec(spec)).data?.spec?.creationLanguage).toBe('zh-CN')
  })
})
