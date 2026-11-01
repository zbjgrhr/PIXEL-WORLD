import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const id = '11111111-1111-4111-8111-111111111111', mediaId = '22222222-2222-4222-8222-222222222222', updatedAt = '2026-10-31T00:00:00Z'
const context = { params: Promise.resolve({ id }) }
const request = (body: unknown = { action: 'withdraw', updatedAt }, origin = 'http://localhost:3000') => new Request(`http://localhost:3000/api/community/posts/${id}/revision`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-owner' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: { id, moderation: 'draft' }, error: null })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc })
})
describe('owner-only versioned post revisions', () => {
  it('requires same origin and valid fields before any mutation', async () => {
    expect((await POST(request({}, 'https://other.example'), context)).status).toBe(403)
    for (const body of [null, {}, { action: 'publish', updatedAt }, { action: 'detach', updatedAt, mediaId: 'bad' }, { action: 'withdraw', updatedAt: 'bad' }]) expect((await POST(request(body), context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires configured backend and a verified current identity', async () => {
    mocks.client.mockResolvedValueOnce(null)
    expect((await POST(request(), context)).status).toBe(503)
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await POST(request(), context)).status).toBe(401)
    mocks.user.mockResolvedValueOnce({ data: { user: { id: 'unverified' } }, error: { message: 'invalid token' } })
    expect((await POST(request(), context)).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('sends only the expected post/version to withdrawal and the exact attachment to removal', async () => {
    expect((await POST(request({ action: 'withdraw', updatedAt, ownerId: 'forged', moderation: 'published' }), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('community_withdraw_post', { p_post_id: id, p_expected_version: updatedAt })
    expect((await POST(request({ action: 'detach', updatedAt, mediaId, storageKey: 'delete-someone-else' }), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('community_detach_media', { p_post_id: id, p_expected_version: updatedAt, p_media_id: mediaId })
  })
  it('returns foreign/stale errors without retrying or exposing database details', async () => {
    for (const [code, status] of [['42501',404], ['40001',409], ['NETWORK',503]]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'private database details' } })
      const response = await POST(request(), context)
      expect(response.status).toBe(status)
      expect(await response.text()).not.toContain('private database details')
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })
})
