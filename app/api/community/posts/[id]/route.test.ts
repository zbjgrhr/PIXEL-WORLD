import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PATCH, DELETE } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), from: vi.fn(), update: vi.fn(), remove: vi.fn(), eq: vi.fn(), current: vi.fn(), changed: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const id = '11111111-1111-4111-8111-111111111111'
const updatedAt = '2026-10-31T00:00:00.000Z'
const context = { params: Promise.resolve({ id }) }
const payload = { language: 'en', title: 'Revised experiment', description: 'Movement remains unverified.', rights: 'ai-generated', licenseNote: '', reuse: 'view-only', updatedAt }
const current = { id, owner_id: 'session-owner', section: 'workshop', language: 'en', updated_at: updatedAt, experiment_id: null }
function request(body: unknown = payload, method = 'PATCH', origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/community/posts/${id}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'session-owner' } }, error: null })
  mocks.current.mockResolvedValue({ data: current, error: null })
  mocks.changed.mockResolvedValue({ data: { ...current, moderation: 'pending' }, error: null })
  const mutation = { eq: mocks.eq, maybeSingle: mocks.changed, select: vi.fn() }
  mutation.select.mockReturnValue(mutation)
  mocks.eq.mockReturnThis()
  const selection = { eq: mocks.eq, maybeSingle: mocks.current }
  mocks.update.mockReturnValue(mutation)
  mocks.remove.mockReturnValue({ eq: mocks.eq, select: async () => ({ data: [{ id }], error: null }) })
  mocks.from.mockReturnValue({ select: () => selection, update: mocks.update, delete: mocks.remove })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, from: mocks.from })
})

describe('community edit and delete endpoints', () => {
  it('retains artwork category and provenance when older clients omit the new fields', async () => {
    const gameId = '33333333-3333-4333-8333-333333333333'
    mocks.current.mockResolvedValueOnce({ data: { ...current, section: 'art', art_kind: 'scene', linked_game_id: gameId }, error: null })
    expect((await PATCH(request(), context)).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ art_kind: 'scene', linked_game_id: gameId }))
  })
  it('rejects cross-origin changes before session or database access', async () => {
    for (const handler of [PATCH, DELETE]) expect((await handler(request(payload, 'PATCH', 'https://other.example'), context)).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('requires an available backend and a verified user', async () => {
    mocks.client.mockResolvedValueOnce(null)
    expect((await PATCH(request(), context)).status).toBe(503)
    mocks.user.mockResolvedValueOnce({ data: { user: null } })
    expect((await DELETE(request(payload, 'DELETE'), context)).status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('does not disclose or mutate another owners post', async () => {
    mocks.current.mockResolvedValue({ data: null, error: null })
    expect((await PATCH(request(), context)).status).toBe(404)
    expect(mocks.eq).toHaveBeenCalledWith('owner_id', 'session-owner')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('whitelists edits and retains server-owned identity, attachments and review state', async () => {
    const result = await PATCH(request({ ...payload, owner_id: 'forged', moderation: 'published', section: 'art', experimentId: 'forged', mediaIds: ['forged'] }), context)
    expect(result.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ title: payload.title, description: payload.description, language: 'en', rights: 'ai-generated', license_note: '', reuse: 'view-only', art_kind: 'other', linked_game_id: null })
    expect(mocks.eq).toHaveBeenCalledWith('updated_at', updatedAt)
    expect((await result.json()).post.moderation).toBe('pending')
  })
  it('preserves newer changes instead of overwriting or deleting them', async () => {
    for (const handler of [PATCH, DELETE]) expect((await handler(request({ ...payload, updatedAt: 'old' }), context)).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    mocks.changed.mockResolvedValue({ data: null, error: null })
    expect((await PATCH(request(), context)).status).toBe(409)
  })
  it('rejects credentials and oversized edits without echoing them', async () => {
    const result = await PATCH(request({ ...payload, description: 'api_key=' + 'example'.repeat(8) }), context)
    expect(result.status).toBe(400)
    expect(await result.text()).not.toContain('example')
    expect((await PATCH(request({ ...payload, description: 'x'.repeat(65_000) }), context)).status).toBe(413)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('does not relabel the language of a linked experiment', async () => {
    mocks.current.mockResolvedValue({ data: { ...current, experiment_id: 'run-1', language: 'zh-CN' }, error: null })
    expect((await PATCH(request(), context)).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('deletes only the owned post, leaving shared files intact', async () => {
    const result = await DELETE(request({ updatedAt }, 'DELETE'), context)
    expect(result.status).toBe(204)
    expect(mocks.eq).toHaveBeenCalledWith('owner_id', 'session-owner')
    expect(mocks.eq).toHaveBeenCalledWith('updated_at', updatedAt)
    expect(mocks.from.mock.calls.every(([table]) => table === 'community_posts')).toBe(true)
  })
})
