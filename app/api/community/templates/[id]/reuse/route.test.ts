import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {createFallbackGameSpec} from '@/lib/game-spec'
import {GET} from './route'
const mock=vi.hoisted(()=>({client:vi.fn(),admin:vi.fn(),load:vi.fn(),download:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({communityServerClient:mock.client}))
vi.mock('@/lib/supabase/admin.server',()=>({communityAdminClient:mock.admin}))
vi.mock('@/lib/community-template-load.server',()=>({loadReviewedTemplates:mock.load}))
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',revision='2026-10-31T00:00:00Z'
const call=(mode='complete',version=revision)=>GET(new Request(`http://localhost:3005/api/community/templates/${id}/reuse?${new URLSearchParams({mode,language:'en',revision:version})}`),{params:Promise.resolve({id})})
function entry(){
  const source=createFallbackGameSpec('背景故事：A penguin finds its mother.','Penguin',3,'en'),bytes=Buffer.from(JSON.stringify(source))
  return {bytes,qualified:{template:{postId:id,revision,experimentId:'run',title:'Penguin',story:'A penguin finds its mother.',language:'en',levelCount:3,author:{id:owner,displayName:'Test author',isOfficial:false,avatarUrl:null}},media:[{id:'spec',kind:'game-spec',storageKey:`${owner}/source.json`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}}
}
beforeEach(()=>{
  vi.clearAllMocks();mock.client.mockResolvedValue({});mock.admin.mockReturnValue({storage:{from:()=>({download:mock.download})}})
  const {bytes,qualified}=entry();mock.load.mockResolvedValue([qualified]);mock.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes)]),error:null})
})
describe('revalidate template reuse before changing any draft',()=>{
  it('returns settings and explicit review requirement, without a source file path',async()=>{
    const response=await call();expect(response.status).toBe(200)
    const body=await response.json();expect(body.requiresReview).toBe(true);expect(body.selection.spec.creationLanguage).toBe('en')
    expect(body.selection.templateSources[0]).toMatchObject({postId:id,authorId:owner})
    expect(JSON.stringify(body)).not.toContain('storageKey');expect(JSON.stringify(body)).not.toContain('source.json')
    expect(mock.load).toHaveBeenCalledTimes(2)
  })
  it('does not download withdrawn or stale templates',async()=>{
    mock.load.mockResolvedValue([]);expect((await call()).status).toBe(409);expect(mock.download).not.toHaveBeenCalled()
    mock.load.mockResolvedValue([entry().qualified]);expect((await call('story','2026-10-30T00:00:00Z')).status).toBe(409)
    expect(mock.download).not.toHaveBeenCalled()
  })
  it('refuses revocation during download and changed original bytes without retrying',async()=>{
    mock.load.mockResolvedValueOnce([entry().qualified]).mockResolvedValueOnce([])
    expect((await call()).status).toBe(409);expect(mock.download).toHaveBeenCalledTimes(1)
    mock.load.mockReset().mockResolvedValue([entry().qualified]);mock.download.mockClear().mockResolvedValue({data:new Blob([new Uint8Array(Buffer.alloc(entry().bytes.length))]),error:null})
    expect((await call()).status).toBe(503);expect(mock.download).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid selections and remains explicit when service configuration is missing',async()=>{
    expect((await call('unsafe')).status).toBe(400);expect(mock.client).not.toHaveBeenCalled()
    mock.client.mockResolvedValue(null);expect((await call()).status).toBe(503);expect(mock.download).not.toHaveBeenCalled()
  })
  it('does not guess which GameSpec is canonical when multiple specifications are attached',async()=>{
    const qualified=entry().qualified
    qualified.media.push({...qualified.media[0],id:'another-spec'})
    mock.load.mockResolvedValue([qualified])
    expect((await call()).status).toBe(409);expect(mock.download).not.toHaveBeenCalled()
  })
  it('rejects oversized settings without silently truncating or returning a partial draft',async()=>{
    const source=createFallbackGameSpec('A penguin finds its mother.','Penguin',3,'en')
    source.world='x'.repeat(520_000)
    const bytes=Buffer.from(JSON.stringify(source)),qualified=entry().qualified
    qualified.media[0]={...qualified.media[0],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
    mock.load.mockResolvedValue([qualified]);mock.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes)]),error:null})
    const response=await call();expect(response.status).toBe(413)
    expect(await response.json()).not.toHaveProperty('selection')
    expect(mock.download).toHaveBeenCalledTimes(1)
  })
})
