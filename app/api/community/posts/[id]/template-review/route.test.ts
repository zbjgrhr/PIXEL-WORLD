import {beforeEach,describe,it,expect,vi} from 'vitest'
import {POST} from './route'
import {TEMPLATE_CHECKS} from '@/lib/community-template-review'
const mock=vi.hoisted(()=>({client:vi.fn(),user:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({communityServerClient:mock.client}))
const id='11111111-1111-4111-8111-111111111111',proof='22222222-2222-4222-8222-222222222222'
const body=()=>({decision:'accepted',updatedAt:'2026-10-31T00:00:00Z',note:'Actual evidence reviewed.',reviewedMediaIds:[proof],checks:Object.fromEntries(TEMPLATE_CHECKS.map(key=>[key,{state:'passed',note:'Checked this result.',evidenceIds:[proof]}]))})
const call=(payload:unknown=body(),origin='http://localhost:3005')=>POST(new Request(`http://localhost:3005/api/community/posts/${id}/template-review`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}),{params:Promise.resolve({id})})
beforeEach(()=>{
  vi.clearAllMocks();mock.user.mockResolvedValue({data:{user:{id:'actual-reviewer'}},error:null})
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='community_is_moderator'?true:{id:'review',decision:'accepted',reviewed_at:'2026-10-31T00:00:00Z'},error:null}))
  mock.client.mockResolvedValue({auth:{getUser:mock.user},rpc:mock.rpc})
})
describe('template review authorization',()=>{
  it('requires same-origin, verified login and moderator role',async()=>{
    expect((await call(body(),'https://other.example')).status).toBe(403);expect(mock.client).not.toHaveBeenCalled()
    mock.user.mockResolvedValue({data:{user:null},error:null})
    expect((await call()).status).toBe(401)
    mock.user.mockResolvedValue({data:{user:{id:'author'}},error:null});mock.rpc.mockResolvedValue({data:false,error:null})
    expect((await call()).status).toBe(403)
    expect(mock.rpc).not.toHaveBeenCalledWith('community_review_template',expect.anything())
  })
  it('passes only reviewed evidence and structured checks, not a forged reviewer or publication state',async()=>{
    const response=await call({...body(),reviewerId:'forged',moderation:'published'})
    expect(response.status).toBe(200)
    expect(mock.rpc).toHaveBeenCalledWith('community_review_template',{p_post_id:id,p_expected:body().updatedAt,p_decision:'accepted',p_checks:body().checks,p_note:body().note,p_media_ids:[proof]})
    expect(await response.json()).toEqual({review:{id:'review',decision:'accepted',reviewedAt:'2026-10-31T00:00:00Z'}})
  })
  it('rejects incomplete checks before writing and returns stale-version failure without retry',async()=>{
    expect((await call({...body(),checks:{}})).status).toBe(400)
    mock.rpc.mockImplementation(async(name:string)=>name==='community_is_moderator'?{data:true,error:null}:{data:null,error:{code:'40001'}})
    expect((await call()).status).toBe(409)
    expect(mock.rpc.mock.calls.filter(([name])=>name==='community_review_template')).toHaveLength(1)
  })
})
