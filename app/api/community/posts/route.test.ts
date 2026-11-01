import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), insert: vi.fn(), select: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
const payload = { section: 'workshop', language: 'en', title: 'Homeward', description: 'A failed experiment with movement evidence.', experimentId: null, mediaIds: [], rights: 'ai-generated', licenseNote: '', reuse: 'view-only' }
function request(body: unknown = payload, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/community/posts', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'session-owner' } }, error: null })
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'post-1', moderation: 'draft' }, error: null }) }) })
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, from: () => ({ insert: mocks.insert }) })
})
function listQueries(posts: Array<Record<string, unknown>>, games: Array<Record<string, unknown>> = [], gameError: unknown = null, profiles: Array<Record<string,unknown>> = []) {
  const chain = (data: Array<Record<string, unknown>>, error: unknown = null) => {
    const result = { eq: vi.fn(), order: vi.fn(), limit: vi.fn(), in: vi.fn(), ilike: vi.fn(), then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve,reject) }
    for (const method of [result.eq,result.order,result.limit,result.in,result.ilike]) method.mockReturnValue(result)
    return result
  }
  const listing = chain(posts), related = chain(games,gameError), authors=chain(profiles)
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, from: (table:string) => ({ select: (columns: string) => table==='community_profiles' ? authors : columns === 'id,title,language' ? related : listing }) })
  return { listing, related, authors }
}

describe('community draft endpoint', () => {
  it('batches real author profiles and exposes only public attribution, never an avatar source',async()=>{
    const {authors}=listQueries([{id:'a',owner_id:'alice'},{id:'b',owner_id:'alice'},{id:'c',owner_id:'bob'}],[],null,[{id:'alice',display_name:'An author',is_official:false,avatar_media_id:'private-media',updated_at:'2026-10-31T00:00:00Z'}])
    const response=await GET(new Request('http://localhost:3000/api/community/posts'))
    const body=await response.json()
    expect(authors.in).toHaveBeenCalledWith('id',['alice','bob'])
    expect(authors.limit).toHaveBeenCalledWith(20)
    expect(body.posts[0].author).toMatchObject({id:'alice',displayName:'An author',isOfficial:false})
    expect(body.posts[2].author).toEqual({id:'bob',displayName:null,isOfficial:false,avatarUrl:null})
    expect(JSON.stringify(body)).not.toContain('private-media')
  })
  it('filters artwork and resolves related public games in one bounded caller-scoped query', async () => {
    const gameId = '33333333-3333-4333-8333-333333333333'
    const { listing, related } = listQueries([{ id: 'art', art_kind: 'character', linked_game_id: gameId }], [{ id: gameId, title: 'Public game', language: 'en' }])
    const response = await GET(new Request('http://localhost:3000/api/community/posts?section=art&artKind=character'))
    expect(response.status).toBe(200)
    expect(listing.eq).toHaveBeenCalledWith('art_kind','character')
    expect(related.eq).toHaveBeenCalledWith('moderation','published')
    expect(related.in).toHaveBeenCalledWith('id',[gameId])
    expect(related.limit).toHaveBeenCalledWith(20)
    expect((await response.json()).posts[0].linked_game.title).toBe('Public game')
  })
  it('keeps artwork visible without exposing unavailable/private related game metadata', async () => {
    const gameId = '33333333-3333-4333-8333-333333333333'
    listQueries([{ id: 'art', linked_game_id: gameId }], [{ id: gameId, title: 'Private provider details' }], { message: 'network' })
    const response = await GET(new Request('http://localhost:3000/api/community/posts?section=art'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.posts[0].id).toBe('art'); expect(body.posts[0].linked_game).toBeNull()
    expect(JSON.stringify(body)).not.toContain('Private provider details')
  })
  it('supports public game deep links and literal title search while rejecting invalid references', async () => {
    const gameId = '33333333-3333-4333-8333-333333333333'
    const { listing } = listQueries([])
    expect((await GET(new Request(`http://localhost:3000/api/community/posts?section=workshop&gameId=${gameId}&search=50%25_world`))).status).toBe(200)
    expect(listing.eq).toHaveBeenCalledWith('id',gameId)
    expect(listing.eq).toHaveBeenCalledWith('moderation','published')
    expect(listing.ilike).toHaveBeenCalledWith('title','%50\\%\\_world%')
    expect((await GET(new Request('http://localhost:3000/api/community/posts?section=art&artKind=invalid'))).status).toBe(400)
    expect((await GET(new Request('http://localhost:3000/api/community/posts?section=workshop&gameId=bad'))).status).toBe(400)
  })
  it('is explicitly unconfigured without a backend', async () => {
    mocks.client.mockResolvedValue(null)
    const listing = await GET(new Request('http://localhost:3000/api/community/posts'))
    expect(await listing.json()).toEqual({ configured: false, posts: [] })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('rejects cross-origin requests before touching credentials or the database', async () => {
    expect((await POST(request(payload, 'https://other.example'))).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('requires verified identity and never accepts an owner from the body', async () => {
    const response = await POST(request({ ...payload, ownerId: 'forged-owner', moderation: 'published' }))
    expect(response.status).toBe(201)
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({ owner_id: 'session-owner', title: 'Homeward' })
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('moderation')
    mocks.user.mockResolvedValue({ data: { user: null }, error: { message: 'Bad token' } })
    expect((await POST(request())).status).toBe(401)
  })
  it('rejects credentials and oversized text without returning secret text', async () => {
    const response = await POST(request({ ...payload, description: `api_key=${'example'.repeat(8)}` }))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('example')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect((await POST(request({ ...payload, description: 'x'.repeat(65_000) }))).status).toBe(413)
  })
  it('does not claim unsupported attachments or a client-provided experiment were imported', async () => {
    expect((await POST(request({ ...payload, mediaIds: ['local-file'] }))).status).toBe(400)
    expect((await POST(request({ ...payload, experimentId: 'old-run' }))).status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
