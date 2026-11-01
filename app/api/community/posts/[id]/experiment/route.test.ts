import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), user: vi.fn(), rpc: vi.fn(), post: vi.fn(), files: vi.fn(), eq: vi.fn(), saved: vi.fn(), adminFrom: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
vi.mock('@/lib/supabase/admin.server', () => ({ communityAdminClient: mocks.admin }))
const id = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222', version = '2026-10-31T00:00:00Z'
const context = { params: Promise.resolve({ id }) }
function record() {
  const check = () => ({ state: 'not-tested', evidenceIds: [], note: '' })
  return { ownerId: 'forged', pairId: 'low-pair', language: 'en', tier: 'low', outcome: 'failed', title: 'Test', story: 'Penguin searches for its mother.', levelCount: 3, projectCommit: 'unknown', dirtyWorktree: true, promptVersion: 'test',
    models: { textProvider: 'test', textModelId: 'test', imageProvider: 'test', imageModelId: 'test' }, timing: [], usage: { budgetUsd: 2, costUsd: null, costSource: 'unknown', calls: null, tokens: null }, fallback: { totalImageTasks: 0, supplementedTasks: 0, items: [] }, checks: { storyFidelity: check(), artQuality: check(), webPlaythrough: check(), offlinePlaythrough: check() }, issues: [], mediaIds: [], templateReview: { state: 'accepted' } }
}
const request = (body: unknown = { updatedAt: version, record: record() }, origin = 'http://localhost:3000') => new Request(`http://localhost:3000/api/community/posts/${id}/experiment`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks(); mocks.eq.mockReturnThis()
  mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null })
  mocks.post.mockResolvedValue({ data: { id, owner_id: owner, language: 'en', section: 'workshop', moderation: 'draft', experiment_id: null, updated_at: version }, error: null })
  mocks.files.mockResolvedValue({ data: [], error: null })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, from: (table: string) => ({ select: () => table === 'community_posts' ? { eq: mocks.eq, maybeSingle: mocks.post } : { eq: mocks.eq, limit: mocks.files } }) })
  mocks.rpc.mockResolvedValue({ data: { id, experiment_id: 'imported' }, error: null })
  mocks.saved.mockResolvedValue({ data: { id: 'imported', owner_id: owner, language: 'en', validated_at: version, record: record() }, error: null })
  mocks.adminFrom.mockReturnValue({ select: () => ({ eq: mocks.eq, maybeSingle: mocks.saved }) })
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: mocks.adminFrom })
})
describe('verified experiment import boundary', () => {
  it('requires same origin, configuration and verified sign-in', async () => {
    expect((await POST(request({}, 'https://other.example'), context)).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
    mocks.admin.mockReturnValueOnce(null)
    expect((await POST(request(), context)).status).toBe(503)
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await POST(request(), context)).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('binds server identity and canonical unreviewed fields, not requested privileges', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(201)
    expect(mocks.eq).toHaveBeenCalledWith('owner_id', owner)
    expect(mocks.rpc).toHaveBeenCalledWith('community_import_experiment', expect.objectContaining({ p_owner: owner, p_post_id: id, p_expected_version: version, p_record: expect.objectContaining({ ownerId: owner, outcome: 'failed', templateReview: { state: 'not-reviewed', reviewerId: null, reviewedAt: null } }) }))
    expect((await response.json()).source).toBe('author-reported')
  })
  it('rejects foreign or stale drafts before trusted import', async () => {
    mocks.post.mockResolvedValueOnce({ data: null, error: null })
    expect((await POST(request(), context)).status).toBe(404)
    expect((await POST(request({ updatedAt: '2000-01-01T00:00:00Z', record: record() }), context)).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects invalid, cross-language and privacy-unsafe records without mutating the draft', async () => {
    for (const change of [{ language: 'zh-CN' }, { outcome: 'completed' }, { extra: 'api_key=' + 'example'.repeat(8) }]) expect((await POST(request({ updatedAt: version, record: { ...record(), ...change } }), context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('returns conflicts without retrying or exposing provider errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'private details' } })
    const response = await POST(request(), context)
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('private details')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('does not read privileged experiment data before caller-visible post authorization', async () => {
    mocks.post.mockResolvedValueOnce({ data: null, error: null })
    expect((await GET(new Request('http://localhost:3000/record'), context)).status).toBe(404)
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: { name: 'InvalidToken' } })
    expect((await GET(new Request('http://localhost:3000/record'), context)).status).toBe(401)
  })
  it('projects author-reported records without internal fields or requested approval, including anonymous public reads', async () => {
    mocks.post.mockResolvedValue({ data: { id, owner_id: owner, language: 'en', experiment_id: 'imported' }, error: null })
    mocks.user.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })
    const response = await GET(new Request('http://localhost:3000/record'), context)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.source).toBe('author-reported'); expect(data.independentReview).toBe('not-verified')
    expect(data.record.ownerId).toBe(owner); expect(data.record.templateReview.state).toBe('not-reviewed')
    expect(data).not.toHaveProperty('validated_at'); expect(data).not.toHaveProperty('storage_key')
  })
  it('keeps legacy/internal records and other owners records out of the public response', async () => {
    mocks.post.mockResolvedValue({ data: { id, owner_id: owner, language: 'en', experiment_id: 'imported' }, error: null })
    for (const entry of [{ id: 'imported', owner_id: owner, language: 'en', validated_at: null }, { id: 'imported', owner_id: 'other', language: 'en', validated_at: version }]) {
      mocks.saved.mockResolvedValueOnce({ data: entry, error: null })
      expect((await GET(new Request('http://localhost:3000/record'), context)).status).toBe(409)
    }
  })
  it('rejects changed evidence sets and another run’s attachments rather than reusing passed declarations', async () => {
    mocks.post.mockResolvedValue({ data: { id, owner_id: owner, language: 'en', experiment_id: 'imported' }, error: null })
    mocks.files.mockResolvedValueOnce({ data: [{ media: { run_id: 'old-round' } }], error: null })
    expect((await GET(new Request('http://localhost:3000/record'), context)).status).toBe(409)
    mocks.saved.mockResolvedValueOnce({ data: { id: 'imported', owner_id: owner, language: 'en', validated_at: version, record: { ...record(), mediaIds: ['removed-proof'] } }, error: null })
    expect((await GET(new Request('http://localhost:3000/record'), context)).status).toBe(409)
  })
})
