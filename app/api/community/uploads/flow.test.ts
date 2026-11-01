import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as LIST, POST as RESERVE } from './route'
import { POST as VERIFY, DELETE as CANCEL } from './[id]/route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), user: vi.fn(), rpc: vi.fn(), trustedRpc: vi.fn(), lookup: vi.fn(), saved: vi.fn(), list: vi.fn(), eq: vi.fn(), download: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
vi.mock('@/lib/supabase/admin.server', () => ({ communityAdminClient: mocks.admin }))
const owner = '11111111-1111-4111-8111-111111111111', post = '22222222-2222-4222-8222-222222222222', upload = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-31T00:00:00Z'
let png: Buffer
const ticket = () => ({ id: upload, owner_id: owner, post_id: post, section: 'art', language: 'en', original_name: 'sprite.png', mime_type: 'image/png', kind: 'image', declared_bytes: png.length, storage_key: `${owner}/${upload}.png`, state: 'reserved', media_id: null, expires_at: stamp, failure_code: null })
const context = { params: Promise.resolve({ id: upload }) }
const request = (body: unknown = {}, method = 'POST', origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/community/uploads', { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const metadata = () => ({ postId: post, updatedAt: stamp, name: 'sprite.png', mime: 'image/png', bytes: png.length })
beforeAll(async () => { png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#408a70' } }).png().toBuffer() })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.eq.mockReturnThis()
  mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null })
  mocks.saved.mockResolvedValue({ data: { id: post, section: 'art' }, error: null })
  mocks.lookup.mockResolvedValue({ data: ticket(), error: null })
  mocks.list.mockResolvedValue({ data: [], error: null })
  mocks.rpc.mockImplementation(async name => ({ data: name === 'community_begin_verify' ? { ...ticket(), state: 'verifying' } : name === 'community_begin_upload_delete' ? { ...ticket(), state: 'deleting' } : ticket(), error: null }))
  mocks.trustedRpc.mockImplementation(async name => ({ data: name === 'community_commit_upload' ? { id: upload } : true, error: null }))
  mocks.download.mockResolvedValue({ data: new Blob([Uint8Array.from(png)], { type: 'image/png' }), error: null })
  mocks.remove.mockResolvedValue({ data: [], error: null })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: (table: string) => ({ select: () => table === 'community_posts'
    ? { eq: mocks.eq, maybeSingle: mocks.saved }
    : { eq: mocks.eq, or: mocks.eq, maybeSingle: mocks.lookup, order: () => ({ limit: mocks.list }) } }) })
  mocks.admin.mockReturnValue({ rpc: mocks.trustedRpc, storage: { from: () => ({ download: mocks.download, remove: mocks.remove }) } })
})
describe('reserved storage upload API and actual byte inspection', () => {
  it('requires same-origin requests, private configuration and verified identity', async () => {
    expect((await RESERVE(request(metadata(), 'POST', 'https://other.example'))).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
    mocks.admin.mockReturnValueOnce(null)
    expect((await RESERVE(request(metadata()))).status).toBe(503)
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await RESERVE(request(metadata()))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('reserves only for the verified owners saved draft, ignoring body-owned state and paths', async () => {
    const response = await RESERVE(request({ ...metadata(), ownerId: 'forged', storageKey: 'someone-else/image.png', verifiedAt: stamp, section: 'workshop' }))
    expect(response.status).toBe(201)
    expect(mocks.eq).toHaveBeenCalledWith('owner_id', owner)
    expect(mocks.rpc).toHaveBeenCalledWith('community_reserve_upload', { p_post_id: post, p_expected_version: stamp, p_name: 'sprite.png', p_mime: 'image/png', p_kind: 'image', p_extension: 'png', p_bytes: png.length })
    expect((await response.json()).upload).toMatchObject({ storageKey: ticket().storage_key, state: 'reserved' })
    expect(mocks.trustedRpc).not.toHaveBeenCalled()
  })
  it('rejects uploads into an imported evidence snapshot before reserving storage', async () => {
    mocks.saved.mockResolvedValueOnce({ data: { id: post, section: 'workshop', experiment_id: 'existing-record' }, error: null })
    expect((await RESERVE(request(metadata()))).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not reserve inaccessible drafts or unsupported metadata and stops at storage limits', async () => {
    mocks.saved.mockResolvedValueOnce({ data: null, error: null })
    expect((await RESERVE(request(metadata()))).status).toBe(404)
    expect((await RESERVE(request({ ...metadata(), bytes: 45000001 }))).status).toBe(400)
    expect((await RESERVE(request({ ...metadata(), name: 'C:/Users/private.png' }))).status).toBe(400)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '53000' } })
    expect((await RESERVE(request(metadata()))).status).toBe(507)
  })
  it('inspects the actual stored PNG before committing trusted metadata', async () => {
    const response = await VERIFY(request({ sha256: 'forged', ownerId: 'forged', bytes: 1 }), context)
    expect(response.status).toBe(200)
    expect(mocks.download).toHaveBeenCalledWith(ticket().storage_key)
    expect(mocks.trustedRpc).toHaveBeenCalledWith('community_commit_upload', expect.objectContaining({ p_owner: owner, p_upload_id: upload, p_bytes: png.length, p_kind: 'image', p_width: 32, p_height: 24, p_frames: 1, p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }))
    expect((await response.json()).upload).toEqual({ id: upload, state: 'complete', mediaId: upload })
  })
  it('returns an existing receipt without downloading or verifying again', async () => {
    mocks.lookup.mockResolvedValueOnce({ data: { ...ticket(), state: 'complete', media_id: upload }, error: null })
    expect((await VERIFY(request(), context)).status).toBe(200)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.trustedRpc).not.toHaveBeenCalled()
  })
  it('rejects a foreign ticket before any privileged storage operation', async () => {
    mocks.lookup.mockResolvedValueOnce({ data: null, error: null })
    expect((await VERIFY(request(), context)).status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('rejects mismatched bytes, cleans the temporary object and never registers it', async () => {
    mocks.download.mockResolvedValueOnce({ data: new Blob(['not an image'], { type: 'image/png' }), error: null })
    const response = await VERIFY(request(), context)
    expect(response.status).toBe(422)
    expect((await response.json()).cleanupPending).toBe(false)
    expect(mocks.remove).toHaveBeenCalledWith([ticket().storage_key])
    expect(mocks.trustedRpc.mock.calls.some(([name]) => name === 'community_commit_upload')).toBe(false)
    expect(mocks.trustedRpc).toHaveBeenCalledWith('community_finish_upload_delete', expect.objectContaining({ p_owner: owner, p_failure_code: 'TYPE_MISMATCH' }))
  })
  it('does not pretend cleanup succeeded when stored bytes could not be removed', async () => {
    mocks.remove.mockResolvedValueOnce({ data: null, error: { statusCode: '503' } })
    expect((await CANCEL(request({}, 'DELETE'), context)).status).toBe(503)
    expect(mocks.trustedRpc).not.toHaveBeenCalled()
  })
  it('reconciles a lost commit response without deleting a completed attachment', async () => {
    mocks.lookup.mockResolvedValueOnce({ data: ticket(), error: null }).mockResolvedValueOnce({ data: { state: 'complete', media_id: upload }, error: null })
    mocks.trustedRpc.mockResolvedValueOnce({ data: null, error: { code: 'NETWORK' } })
    expect((await VERIFY(request(), context)).status).toBe(200)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.trustedRpc.mock.calls.filter(([name]) => name === 'community_commit_upload')).toHaveLength(1)
  })
  it('preserves ambiguous verification status instead of replaying or claiming a known failure', async () => {
    mocks.trustedRpc.mockResolvedValueOnce({ data: null, error: { code: 'NETWORK' } })
    const response = await VERIFY(request(), context)
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('VERIFY_STATUS_UNKNOWN')
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('lists the verified callers uploads only', async () => {
    expect((await LIST()).status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('owner_id', owner)
    expect(mocks.list).toHaveBeenCalledWith(50)
  })
  it('keeps older unfinished uploads visible alongside recent receipts without duplicate IDs', async () => {
    mocks.list.mockResolvedValueOnce({ data: [{ id: 'recent', state: 'complete' }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'old', state: 'reserved' }, { id: 'recent', state: 'complete' }], error: null })
    const response = await LIST()
    expect((await response.json()).uploads.map((item: { id: string }) => item.id)).toEqual(['old', 'recent'])
    expect(mocks.eq).toHaveBeenCalledWith('state.in.(reserved,verifying,deleting),and(state.eq.complete,post_id.is.null)')
  })
})
