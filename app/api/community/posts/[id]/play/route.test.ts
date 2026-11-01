import {beforeEach,describe,it,expect,vi} from 'vitest'
import {GET} from './route'
import engine from '@/configs/offline-engine-source.json'
const mock=vi.hoisted(()=>({media:vi.fn()}))
vi.mock('../media/route',()=>({GET:mock.media}))
const id='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222'
const call=(query='')=>GET(new Request(`http://localhost:3005/api/community/posts/${id}/play${query}`),{params:Promise.resolve({id})})
beforeEach(()=>{
  vi.clearAllMocks()
  mock.media.mockImplementation(async(request:Request)=>new URL(request.url).searchParams.get('download')==='1'
    ?Response.json({id:fileId,kind:'game-zip',url:'https://storage.example/authorized-download',sha256:'a'.repeat(64),bytes:1000,storage_key:'never-return-this'})
    :Response.json({media:[{id:fileId,kind:'game-zip',verified:true,canDownload:true}]}))
})
describe('authorized game playback manifest',()=>{
  it('reuses caller-scoped media authorization and returns only the short-lived archive and vetted hashes',async()=>{
    const response=await call();expect(response.status).toBe(200)
    expect(await response.json()).toEqual({archive:{id:fileId,url:'https://storage.example/authorized-download',sha256:'a'.repeat(64),bytes:1000},engine:{format:engine.format,sha256:engine.sha256,styleSha256:engine.styleSha256},expiresInSeconds:300})
    expect(mock.media).toHaveBeenCalledTimes(2)
    expect(new URL(mock.media.mock.calls[1][0].url).searchParams.get('mediaId')).toBe(fileId)
  })
  it('does not turn a denied/private or view-only attachment into a playable archive',async()=>{
    mock.media.mockResolvedValue(Response.json({error:'Not found'},{status:404}))
    expect((await call()).status).toBe(404);expect(mock.media).toHaveBeenCalledTimes(1)
    mock.media.mockClear().mockResolvedValue(Response.json({media:[{id:fileId,kind:'game-zip',verified:true,canDownload:false}]}))
    expect((await call()).status).toBe(403);expect(mock.media).toHaveBeenCalledTimes(1)
  })
  it('does not guess among multiple or unverified archives',async()=>{
    mock.media.mockResolvedValue(Response.json({media:[{id:fileId,kind:'game-zip',verified:true,canDownload:true},{id:'another',kind:'game-zip',verified:true,canDownload:true}]}))
    expect((await call()).status).toBe(409)
    mock.media.mockResolvedValue(Response.json({media:[{id:fileId,kind:'game-zip',verified:false,canDownload:true}]}))
    expect((await call()).status).toBe(409)
  })
  it('rechecks signing permission and propagates revocation instead of issuing a manifest',async()=>{
    mock.media.mockResolvedValueOnce(Response.json({media:[{id:fileId,kind:'game-zip',verified:true,canDownload:true}]})).mockResolvedValueOnce(Response.json({error:'Permission changed'},{status:403}))
    expect((await call()).status).toBe(403)
  })
})
