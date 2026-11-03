export interface TextCatalogModel { id: string; name: string; family: string; inputPerMillion: number | null; outputPerMillion: number | null }

export function normalizeTextCatalog(payload: unknown): TextCatalogModel[] {
  const rows = (payload as { data?: unknown[] })?.data
  if (!Array.isArray(rows)) throw new Error('模型目录格式不正确')
  const seen = new Set<string>()
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as { id?: unknown; name?: unknown; architecture?: { output_modalities?: unknown[] }; pricing?: Record<string, unknown> }
    if (typeof row.id !== 'string' || !/^[\w.-]+\/[\w.:-]+(?:\/[\w.:-]+)*$/.test(row.id) || row.id.length > 200 || seen.has(row.id) || !row.architecture?.output_modalities?.includes('text')) return []
    seen.add(row.id)
    const price = (field: string) => { const raw = row.pricing?.[field]; const number = Number(raw); return raw !== undefined && raw !== null && raw !== '' && Number.isFinite(number) && number >= 0 ? number * 1_000_000 : null }
    return [{ id: row.id, name: typeof row.name === 'string' ? row.name.slice(0, 180) : row.id, family: row.id.split('/')[0], inputPerMillion: price('prompt'), outputPerMillion: price('completion') }]
  }).sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id))
}
