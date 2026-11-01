import { beforeEach,describe,expect,it,vi } from 'vitest'
import { GET,PATCH } from './route'
const mock=vi.hoisted(()=>({client:vi.fn(),user:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({communityServerClient:mock.client}))
const id='11111111-1111-4111-8111-111111111111'
const request=(body:unknown,origin='http://localhost:3005')=>new Request('http://localhost:3005/api/community/profile',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{
  vi.clearAllMocks()
  mock.user.mockResolvedValue({data:{user:{id}},error:null})
  mock.rpc.mockResolvedValue({data:{id,display_name:'Name',avatar_media_id:null,is_official:false,updated_at:'2026-10-31T00:00:00Z'},error:null})
  mock.client.mockResolvedValue({auth:{getUser:mock.user},rpc:mock.rpc,from:mock.from})
})
describe('versioned account profile endpoint',()=>{
  it('requires same-origin and a verified session before writes',async()=>{
    const input={name:'Name',avatarMediaId:null,updatedAt:null}
    expect((await PATCH(request(input,'https://other.example'))).status).toBe(403)
    expect(mock.client).not.toHaveBeenCalled()
    mock.user.mockResolvedValue({data:{user:null},error:null})
    expect((await PATCH(request(input))).status).toBe(401)
    expect(mock.rpc).not.toHaveBeenCalled()
    mock.client.mockResolvedValue(null)
    expect((await GET()).status).toBe(503)
  })
  it('ignores forged identity and official status, and returns stale-version errors without retrying',async()=>{
    expect((await PATCH(request({name:'Name',avatarMediaId:null,updatedAt:null,id:'other',isOfficial:true}))).status).toBe(200)
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('community_save_profile',{p_name:'Name',p_avatar:null,p_expected:null,p_public_consent:false})
    mock.rpc.mockResolvedValue({data:null,error:{code:'40001'}})
    const response=await PATCH(request({name:'Name',avatarMediaId:null,updatedAt:'2026-10-31T00:00:00Z'}))
    expect(response.status).toBe(409)
    expect(mock.rpc).toHaveBeenCalledTimes(2)
  })
  it('limits avatar choices to the verified account and eligible images',async()=>{
    const chain={select:vi.fn(),eq:vi.fn(),not:vi.fn(),lte:vi.fn(),order:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn()}
    for(const method of [chain.select,chain.eq,chain.not,chain.lte,chain.order])method.mockReturnValue(chain)
    chain.maybeSingle.mockResolvedValue({data:null,error:null});chain.limit.mockResolvedValue({data:[],error:null})
    mock.from.mockReturnValue(chain)
    expect((await GET()).status).toBe(200)
    expect(chain.eq).toHaveBeenCalledWith('owner_id',id)
    expect(chain.eq).toHaveBeenCalledWith('frame_count',1)
    expect(chain.not).toHaveBeenCalledWith('verified_at','is',null)
    expect(chain.lte).toHaveBeenCalledWith('bytes',5_000_000)
    expect(chain.limit).toHaveBeenCalledWith(100)
  })
})
