import {beforeEach,describe,expect,it,vi} from 'vitest'
import sharp from 'sharp'
import {createHash} from 'node:crypto'
import {GET} from './route'
const mock=vi.hoisted(()=>({client:vi.fn(),admin:vi.fn(),profile:vi.fn(),media:vi.fn(),download:vi.fn(),eq:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({communityServerClient:mock.client}))
vi.mock('@/lib/supabase/admin.server',()=>({communityAdminClient:mock.admin}))
const id='11111111-1111-4111-8111-111111111111', mediaId='22222222-2222-4222-8222-222222222222'
const call=(userId=id)=>GET(new Request(`http://localhost:3005/api/community/profiles/${userId}/avatar`),{params:Promise.resolve({id:userId})})
beforeEach(()=>{
  vi.clearAllMocks()
  const query=(result:typeof mock.profile)=>{const chain={select:vi.fn(),eq:mock.eq,maybeSingle:result};chain.select.mockReturnValue(chain);mock.eq.mockReturnValue(chain);return chain}
  const userQuery=query(mock.profile)
  const mediaQuery={select:vi.fn(),eq:vi.fn(),maybeSingle:mock.media}
  mediaQuery.select.mockReturnValue(mediaQuery);mediaQuery.eq.mockReturnValue(mediaQuery)
  mock.client.mockResolvedValue({from:()=>userQuery})
  mock.admin.mockReturnValue({from:()=>mediaQuery,storage:{from:()=>({download:mock.download})}})
  mock.profile.mockResolvedValue({data:{avatar_media_id:mediaId},error:null})
})
describe('public consented avatar thumbnails',()=>{
  it('never accepts an arbitrary media ID or source path from the browser',async()=>{
    expect((await call('../private-file')).status).toBe(404)
    expect(mock.client).not.toHaveBeenCalled()
    mock.profile.mockResolvedValue({data:null,error:null})
    expect((await call()).status).toBe(404)
    expect(mock.media).not.toHaveBeenCalled();expect(mock.download).not.toHaveBeenCalled()
  })
  it('rejects another owner or invalid private path before downloading',async()=>{
    mock.media.mockResolvedValue({data:{owner_id:'other',kind:'image',storage_key:'other/image.png',bytes:10,sha256:'a'.repeat(64),verified_at:'now',frame_count:1},error:null})
    expect((await call()).status).toBe(404)
    expect(mock.download).not.toHaveBeenCalled()
  })
  it('returns only verified, metadata-free thumbnails and hides a changed original',async()=>{
    const bytes=await sharp({create:{width:300,height:200,channels:3,background:'green'}}).png().withMetadata().toBuffer()
    mock.media.mockResolvedValue({data:{owner_id:id,kind:'image',storage_key:`${id}/private/original.png`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),verified_at:'now',frame_count:1},error:null})
    mock.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes)]),error:null})
    const response=await call()
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    const thumbnail=Buffer.from(await response.arrayBuffer()),meta=await sharp(thumbnail).metadata()
    expect(meta).toMatchObject({width:256,height:256,format:'webp'});expect(meta.exif).toBeUndefined()
    expect(thumbnail.equals(bytes)).toBe(false)
    mock.download.mockResolvedValue({data:new Blob([new Uint8Array(Buffer.alloc(bytes.length))]),error:null})
    expect((await call()).status).toBe(404)
  })
})
