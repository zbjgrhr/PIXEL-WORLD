import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn(), from: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const id = '11111111-1111-4111-8111-111111111111'
const payload = { kind: 'post', id, action: 'approve', version: '2026-10-31T00:00:00.000Z', reason: 'Text and rights reviewed.', reviewConfirmed: true, reviewedMediaIds: [] }
function request(body: unknown = payload, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/community/moderation', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-moderator' } } })
  mocks.rpc.mockImplementation(async name => ({ data: name === 'community_is_moderator' ? true : { id, kind: 'post', state: 'published' }, error: null }))
  mocks.limit.mockResolvedValue({ data: [], error: null })
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ limit: mocks.limit }), limit: mocks.limit }) }) })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: mocks.from })
})

describe('moderation API boundaries', () => {
  it('includes only published related-game summaries in the artwork review queue', async () => {
    const gameId = '33333333-3333-4333-8333-333333333333'
    const chain = (data: unknown[]) => {
      const value = { eq: vi.fn(), order: vi.fn(), in: vi.fn(), limit: vi.fn(), then: (resolve: (entry: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve,reject) }
      for (const method of [value.eq,value.order,value.in,value.limit]) method.mockReturnValue(value)
      return value
    }
    const posts = chain([{ id, section: 'art', art_kind: 'character', linked_game_id: gameId }]), reports = chain([]), games = chain([{ id: gameId, title: 'Published game', language: 'en' }])
    mocks.from.mockImplementation(table => ({ select: (columns: string) => table === 'community_reports' ? reports : columns === 'id,title,language' ? games : posts }))
    const response = await GET()
    expect(response.status).toBe(200)
    expect(games.eq).toHaveBeenCalledWith('moderation','published')
    expect(games.in).toHaveBeenCalledWith('id',[gameId]); expect(games.limit).toHaveBeenCalledWith(40)
    expect((await response.json()).posts[0].linked_game.title).toBe('Published game')
  })
  it('requires configuration, a verified session and a database-approved role', async () => {
    mocks.client.mockResolvedValueOnce(null)
    const missing = await GET()
    expect(missing.status).toBe(503)
    expect((await missing.json()).code).toBe('COMMUNITY_NOT_CONFIGURED')
    mocks.user.mockResolvedValueOnce({ data: { user: null } })
    expect((await GET()).status).toBe(401)
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    expect((await GET()).status).toBe(403)
    expect((await POST(request({ ...payload, moderator: true, actorId: 'admin' }))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'community_review')).toBe(false)
  })
  it('rejects cross-origin mutations before checking authentication', async () => {
    expect((await POST(request(payload, 'https://other.example'))).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('loads bounded pending posts and open reports only after checking permissions', async () => {
    expect((await GET()).status).toBe(200)
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['community_posts', 'community_reports'])
    expect(mocks.limit).toHaveBeenCalledWith(20)
  })
  it('passes only whitelisted action data to the atomic database operation', async () => {
    expect((await POST(request({ ...payload, actor_id: 'forged', next_state: 'published', is_official: true }))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('community_review', { p_kind: 'post', p_subject_id: id, p_action: 'approve', p_expected_version: payload.version, p_reason: payload.reason })
  })
  it('rejects missing explanations, invalid action types and credentials', async () => {
    for (const change of [{ reason: '' }, { reason: 'x'.repeat(2001) }, { kind: ['post'] }, { action: 'resolve' }, { version: 'unknown' }, { reason: '"api_key":"' + 'example'.repeat(8) + '"' }]) expect((await POST(request({ ...payload, ...change }))).status).toBe(400)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'community_review')).toBe(false)
  })
  it('returns a concurrency conflict without replaying the decision', async () => {
    mocks.rpc.mockImplementation(async name => name === 'community_is_moderator' ? { data: true, error: null } : { data: null, error: { code: '40001' } })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'community_review')).toHaveLength(1)
  })
  it('does not approve unverified or unacknowledged attachments', async () => {
    mocks.limit.mockResolvedValueOnce({ data: [{ media_id: 'unseen' }], error: null })
    expect((await POST(request())).status).toBe(400)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'community_review')).toBe(false)
  })
  it('requires explicit confirmation of the exact verified media set', async () => {
    const mediaId = '22222222-2222-4222-8222-222222222222'
    mocks.limit.mockResolvedValue({ data: [{ media_id: mediaId, media: { kind: 'image', verified_at: payload.version, sha256: 'a'.repeat(64) } }], error: null })
    expect((await POST(request())).status).toBe(400)
    expect((await POST(request({ ...payload, reviewedMediaIds: [mediaId], reviewConfirmed: false }))).status).toBe(400)
    expect((await POST(request({ ...payload, reviewedMediaIds: [mediaId] }))).status).toBe(200)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'community_review')).toHaveLength(1)
  })
  it('handles report decisions through the same role-checked atomic operation', async () => {
    expect((await POST(request({ ...payload, kind: 'report', action: 'dismiss', version: 'open' }))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('community_review', expect.objectContaining({ p_kind: 'report', p_action: 'dismiss', p_expected_version: 'open' }))
  })
  it('accepts explicit review of verified archives, specifications and reports without treating them as playable proof', async () => {
    const ids = ['zip','spec','report']
    mocks.limit.mockResolvedValue({ data: ['game-zip','game-spec','report'].map((kind, index) => ({ media_id: ids[index], media: { kind, verified_at: payload.version, sha256: 'a'.repeat(64) } })), error: null })
    expect((await POST(request({ ...payload, reviewedMediaIds: ids.slice(0,2) }))).status).toBe(400)
    expect((await POST(request({ ...payload, reviewedMediaIds: ids }))).status).toBe(200)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'community_review')).toHaveLength(1)
  })
})
