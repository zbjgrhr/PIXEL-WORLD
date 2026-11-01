import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), insert: vi.fn(), post: vi.fn(), eq: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const postId = '11111111-1111-4111-8111-111111111111'
const payload = { postId, reason: 'This post contains an uncredited image. See the character portrait.' }
function request(body: unknown = payload, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/community/reports', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-user' } } })
  mocks.eq.mockReturnThis()
  mocks.post.mockResolvedValue({ data: { id: postId }, error: null })
  mocks.limit.mockResolvedValue({ data: [], error: null })
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'report', post_id: postId, status: 'open' }, error: null }) }) })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, from: (table: string) => table === 'community_posts'
    ? { select: () => ({ eq: mocks.eq, maybeSingle: mocks.post }) }
    : { insert: mocks.insert, select: () => ({ eq: mocks.eq, order: () => ({ limit: mocks.limit }) }) } })
})

describe('community reporting endpoints', () => {
  it('requires a configured backend and verified identity', async () => {
    mocks.client.mockResolvedValueOnce(null)
    expect((await GET()).status).toBe(503)
    mocks.user.mockResolvedValue({ data: { user: null } })
    expect((await GET()).status).toBe(401)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('rejects cross-origin submissions before accessing the session', async () => {
    expect((await POST(request(payload, 'https://other.example'))).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('binds reporter identity and status to the server and database', async () => {
    const response = await POST(request({ ...payload, reporter_id: 'forged', status: 'resolved' }))
    expect(response.status).toBe(201)
    expect(mocks.insert).toHaveBeenCalledWith({ reporter_id: 'verified-user', post_id: postId, reason: payload.reason })
    expect(mocks.eq).toHaveBeenCalledWith('moderation', 'published')
    expect((await response.json()).report.status).toBe('open')
  })
  it('does not allow a guessed private or missing post to be reported', async () => {
    mocks.post.mockResolvedValue({ data: null, error: null })
    expect((await POST(request())).status).toBe(404)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('rejects empty, oversized or credential-bearing reasons without echoing them', async () => {
    for (const reason of ['', ' ', 'x'.repeat(2001), '"api_key":"' + 'example'.repeat(8) + '"']) expect((await POST(request({ ...payload, reason }))).status).toBe(400)
    expect((await POST(request({ ...payload, reason: 'x'.repeat(65_000) }))).status).toBe(413)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('returns a duplicate conflict without retrying or overwriting the previous report', async () => {
    mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }) })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })
  it('limits report history to the verified caller', async () => {
    expect((await GET()).status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('reporter_id', 'verified-user')
    expect(mocks.limit).toHaveBeenCalledWith(100)
  })
})
