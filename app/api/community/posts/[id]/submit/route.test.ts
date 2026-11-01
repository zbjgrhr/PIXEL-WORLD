import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id }) }
const version = '2026-10-31T00:00:00.000Z'
function request(body: unknown = { updatedAt: version }, origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/community/posts/${id}/submit`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-author' } } })
  mocks.rpc.mockResolvedValue({ data: { id, moderation: 'pending' }, error: null })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc })
})

describe('post submission API', () => {
  it('requires same origin, configuration and a verified session', async () => {
    expect((await POST(request({}, 'https://other.example'), context)).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
    mocks.client.mockResolvedValueOnce(null)
    expect((await POST(request(), context)).status).toBe(503)
    mocks.user.mockResolvedValueOnce({ data: { user: null } })
    expect((await POST(request(), context)).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('submits a saved version, ignoring client-authored approval and ownership', async () => {
    const response = await POST(request({ updatedAt: version, ownerId: 'forged', moderation: 'published' }), context)
    expect(response.status).toBe(200)
    expect((await response.json()).post.moderation).toBe('pending')
    expect(mocks.rpc).toHaveBeenCalledWith('community_submit_post', { p_post_id: id, p_expected_updated_at: version })
  })
  it('rejects a missing version or invalid ID before submission', async () => {
    expect((await POST(request({}), context)).status).toBe(400)
    expect((await POST(request(), { params: Promise.resolve({ id: 'bad-id' }) })).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('distinguishes stale, foreign and invalid-media submissions without retrying', async () => {
    for (const [code, status] of [['40001', 409], ['42501', 404], ['22023', 400]]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code } })
      expect((await POST(request(), context)).status).toBe(status)
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })
})
