import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), post: vi.fn(), media: vi.fn(), list: vi.fn(), eq: vi.fn(), sign: vi.fn(), role: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const postId = '11111111-1111-4111-8111-111111111111'
const mediaId = '22222222-2222-4222-8222-222222222222'
const owner = '33333333-3333-4333-8333-333333333333'
const value = { id: mediaId, owner_id: owner, kind: 'image', storage_key: `${owner}/sprite.png`, bytes: 1000, duration_seconds: null, sha256: 'a'.repeat(64), verified_at: '2026-10-31T00:00:00Z' }
const context = { params: Promise.resolve({ id: postId }) }
function request(sign = false) { return new Request(`http://localhost:3000/api/community/posts/${postId}/media${sign ? `?mediaId=${mediaId}` : ''}`) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })
  mocks.eq.mockReturnThis()
  mocks.post.mockResolvedValue({ data: { id: postId, owner_id: owner, moderation: 'published', reuse: 'view-only' }, error: null })
  mocks.role.mockResolvedValue({ data: false, error: null })
  mocks.media.mockResolvedValue({ data: { media_id: mediaId, media: value }, error: null })
  mocks.list.mockResolvedValue({ data: [{ media_id: mediaId, media: value }], error: null })
  mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://example.supabase.co/test-only-preview-url' }, error: null })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.role, from: (table: string) => ({ select: () => table === 'community_posts' ? { eq: mocks.eq, maybeSingle: mocks.post } : { eq: mocks.eq, maybeSingle: mocks.media, limit: mocks.list } }), storage: { from: () => ({ createSignedUrl: mocks.sign }) } })
})
describe('post-scoped protected media preview', () => {
  it('does not fabricate media when the backend is unconfigured', async () => {
    mocks.client.mockResolvedValueOnce(null)
    expect((await GET(request(), context)).status).toBe(503)
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it('hides inaccessible posts before looking up or signing attachments', async () => {
    mocks.post.mockResolvedValueOnce({ data: null, error: null })
    expect((await GET(request(true), context)).status).toBe(404)
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.media).not.toHaveBeenCalled()
  })
  it('does not silently treat an invalid user token as an anonymous session', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: { name: 'InvalidToken' } })
    expect((await GET(request(true), context)).status).toBe(401)
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('lists metadata without exposing storage paths, hashes or signed links', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ media: [{ id: mediaId, kind: 'image', bytes: 1000, durationSeconds: null, verified: true, canDownload: false }] })
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })
  it('signs only verified media linked to the requested accessible post', async () => {
    expect((await GET(request(true), context)).status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('post_id', postId)
    expect(mocks.eq).toHaveBeenCalledWith('media_id', mediaId)
    expect(mocks.sign).toHaveBeenCalledWith(value.storage_key, 300)
  })
  it('does not preview unverified, inaccessible, malformed or local-path media', async () => {
    for (const media of [null, { ...value, verified_at: null }, { ...value, sha256: null }, { ...value, storage_key: 'C:/Users/private.png' }, { ...value, storage_key: `${owner}/../other.png` }]) {
      mocks.media.mockResolvedValueOnce({ data: { media_id: mediaId, media }, error: null })
      expect((await GET(request(true), context)).status).toBe(404)
    }
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it('does not serve executable or downloadable game attachments as image previews', async () => {
    for (const media of [{ ...value, storage_key: `${owner}/script.svg` }, { ...value, kind: 'game-zip', storage_key: `${owner}/game.zip` }]) {
      mocks.media.mockResolvedValueOnce({ data: { media_id: mediaId, media }, error: null })
      expect((await GET(request(true), context)).status).toBe(400)
    }
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it('surfaces unreadable or excessive attachment lists rather than dropping entries', async () => {
    mocks.list.mockResolvedValueOnce({ data: Array(31).fill({ media_id: mediaId, media: value }), error: null })
    expect((await GET(request(), context)).status).toBe(400)
    mocks.sign.mockResolvedValueOnce({ data: null, error: { message: 'Provider details must not be echoed' } })
    const response = await GET(request(true), context)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Provider details')
  })
  it('denies view-only downloads while permitting ordinary public image preview', async () => {
    const download = new Request(request(true).url + '&download=1')
    expect((await GET(download, context)).status).toBe(403)
    expect(mocks.sign).not.toHaveBeenCalled()
    expect((await GET(request(true), context)).status).toBe(200)
  })
  it('lets the owner and a verified moderator download private attachments for inspection', async () => {
    mocks.post.mockResolvedValue({ data: { id: postId, owner_id: owner, moderation: 'pending', reuse: 'view-only' }, error: null })
    mocks.media.mockResolvedValue({ data: { media_id: mediaId, media: { ...value, kind: 'game-zip', storage_key: `${owner}/game.zip` } }, error: null })
    mocks.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null })
    const response = await GET(new Request(request(true).url + '&download=1'), context)
    expect(response.status).toBe(200)
    expect(mocks.sign).toHaveBeenCalledWith(`${owner}/game.zip`, 300, { download: `pixel-world-${mediaId}.zip` })
    expect((await response.json()).sha256).toBe(value.sha256)
    mocks.user.mockResolvedValueOnce({ data: { user: { id: 'reviewer' } }, error: null })
    mocks.role.mockResolvedValueOnce({ data: true, error: null })
    expect((await GET(new Request(request(true).url + '&download=1'), context)).status).toBe(200)
  })
  it('permits public downloads only after publication and explicit author permission', async () => {
    mocks.post.mockResolvedValue({ data: { id: postId, owner_id: owner, moderation: 'published', reuse: 'download' }, error: null })
    for (const [kind, extension] of [['game-zip','zip'], ['game-spec','json'], ['report','md']]) {
      mocks.media.mockResolvedValueOnce({ data: { media_id: mediaId, media: { ...value, kind, storage_key: `${owner}/file.${extension}` } }, error: null })
      expect((await GET(new Request(request(true).url + '&download=1'), context)).status).toBe(200)
    }
    mocks.sign.mockClear()
    mocks.post.mockResolvedValueOnce({ data: { id: postId, owner_id: owner, moderation: 'pending', reuse: 'download' }, error: null })
    expect((await GET(new Request(request(true).url + '&download=1'), context)).status).toBe(403)
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it('never downloads unverified content or uses the download branch for arbitrary executable formats', async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null })
    mocks.media.mockResolvedValueOnce({ data: { media_id: mediaId, media: { ...value, verified_at: null } }, error: null })
    expect((await GET(new Request(request(true).url + '&download=1'), context)).status).toBe(404)
    mocks.media.mockResolvedValueOnce({ data: { media_id: mediaId, media: { ...value, kind: 'report', storage_key: `${owner}/script.html` } }, error: null })
    expect((await GET(new Request(request(true).url + '&download=1'), context)).status).toBe(400)
    expect(mocks.sign).not.toHaveBeenCalled()
  })
})
