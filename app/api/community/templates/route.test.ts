import {beforeEach,describe,it,expect,vi} from 'vitest'
import {GET} from './route'
const mock=vi.hoisted(()=>({client:vi.fn(),admin:vi.fn(),rpc:vi.fn(),publicFrom:vi.fn(),adminFrom:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({communityServerClient:mock.client}))
vi.mock('@/lib/supabase/admin.server',()=>({communityAdminClient:mock.admin}))
const postId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333'
const call=(language='en')=>GET(new Request(`http://localhost:3005/api/community/templates?language=${language}`))
const chain=(data:unknown[],error:unknown=null)=>{
  const query={select:vi.fn(),eq:vi.fn(),in:vi.fn(),not:vi.fn(),order:vi.fn(),limit:vi.fn(),then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve({data,error}).then(resolve,reject)}
  for(const method of [query.select,query.eq,query.in,query.not,query.order,query.limit])method.mockReturnValue(query)
  return query
}
beforeEach(()=>{
  vi.clearAllMocks()
  mock.client.mockResolvedValue({from:mock.publicFrom})
  mock.admin.mockReturnValue({rpc:mock.rpc,from:mock.adminFrom})
  mock.rpc.mockResolvedValue({data:[],error:null})
})
describe('public reviewed-template catalog boundaries',()=>{
  it('does not fabricate templates when no backend or selected work exists',async()=>{
    mock.client.mockResolvedValue(null);mock.admin.mockReturnValue(null)
    expect(await (await call()).json()).toEqual({configured:false,templates:[]})
    expect(mock.rpc).not.toHaveBeenCalled()
    mock.client.mockResolvedValue({from:mock.publicFrom});mock.admin.mockReturnValue({rpc:mock.rpc,from:mock.adminFrom})
    expect(await (await call()).json()).toEqual({configured:true,templates:[]})
    expect(mock.publicFrom).not.toHaveBeenCalled();expect(mock.adminFrom).not.toHaveBeenCalled()
  })
  it('rechecks public permission with the caller before privileged record reads',async()=>{
    mock.rpc.mockResolvedValue({data:[{post_id:postId}],error:null})
    const posts=chain([]);mock.publicFrom.mockReturnValue(posts)
    expect(await (await call()).json()).toEqual({configured:true,templates:[]})
    expect(posts.in).toHaveBeenCalledWith('id',[postId])
    expect(posts.eq).toHaveBeenCalledWith('moderation','published')
    expect(posts.eq).toHaveBeenCalledWith('reuse','remix-with-credit')
    expect(mock.adminFrom).not.toHaveBeenCalled()
  })
  it('bounds queries to authorized IDs and drops missing or stale evidence instead of exposing raw records',async()=>{
    mock.rpc.mockImplementation(async(name:string)=>({data:name==='community_public_template_candidates'?[{post_id:postId}]:[],error:null}))
    const posts=chain([{id:postId,owner_id:owner,section:'workshop',language:'en',moderation:'published',reuse:'remix-with-credit',experiment_id:runId,updated_at:'2026-10-31T00:00:00Z'}]),files=chain([]),profiles=chain([]),runs=chain([])
    mock.publicFrom.mockImplementation((name:string)=>name==='community_posts'?posts:name==='community_post_media'?files:profiles)
    mock.adminFrom.mockReturnValue(runs)
    const response=await call()
    expect(response.status).toBe(200);expect(await response.json()).toEqual({configured:true,templates:[]})
    expect(mock.rpc).toHaveBeenCalledWith('community_latest_template_reviews',{p_post_ids:[postId]})
    expect(runs.in).toHaveBeenCalledWith('id',[runId]);expect(runs.limit).toHaveBeenCalledWith(20)
    expect(files.in).toHaveBeenCalledWith('post_id',[postId]);expect(files.limit).toHaveBeenCalledWith(601)
  })
  it('fails explicitly on malformed language or a failed trusted selection query',async()=>{
    expect((await call('fr')).status).toBe(400);expect(mock.client).not.toHaveBeenCalled()
    mock.rpc.mockResolvedValue({data:null,error:{message:'private details'}})
    const response=await call();expect(response.status).toBe(503);expect(await response.text()).not.toContain('private details')
  })
})
