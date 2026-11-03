import { expect, it } from 'vitest'
import { normalizeTextCatalog } from './text-model-catalog'

it('keeps text models, groups by author and preserves zero price without asserting availability', () => {
  const rows = normalizeTextCatalog({ data: [
    { id: 'qwen/new-model', name: 'Qwen', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0.0000015' } },
    { id: 'art/image-only', architecture: { output_modalities: ['image'] } },
    { id: 'qwen/new-model', architecture: { output_modalities: ['text'] } },
    { id: 'deepseek/text', architecture: { output_modalities: ['text'] }, pricing: { prompt: '-1' } },
  ] })
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ id: 'deepseek/text', family: 'deepseek', inputPerMillion: null })
  expect(rows[1]).toMatchObject({ inputPerMillion: 0, outputPerMillion: 1.5 })
})
it('rejects malformed responses and invalid model IDs', () => {
  expect(() => normalizeTextCatalog({ error: 'unavailable' })).toThrow()
  expect(normalizeTextCatalog({ data: [{id:'https://evil.example',architecture:{output_modalities:['text']}}] })).toEqual([])
})
