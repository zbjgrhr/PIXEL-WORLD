import {NextResponse} from 'next/server'
import {communityServerClient} from '@/lib/supabase/server'
import {communitySameOrigin,readCommunityJson,communityResponseHeaders as headers} from '@/lib/community-http'
import {templateReviewInput} from '@/lib/community-template-review'
export const dynamic='force-dynamic'
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  if(!communitySameOrigin(request))return NextResponse.json({error:'Invalid request origin.'},{status:403,headers})
  if(!request.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'Expected JSON.'},{status:415,headers})
  try{
    const {id}=await context.params
    if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id))return NextResponse.json({error:'Invalid post.'},{status:400,headers})
    const client=await communityServerClient()
    if(!client)return NextResponse.json({error:'Community is not configured.'},{status:503,headers})
    const {data:{user},error:identity}=await client.auth.getUser()
    if(identity || !user)return NextResponse.json({error:'Sign in before reviewing.'},{status:401,headers})
    const role=await client.rpc('community_is_moderator')
    if(role.error)return NextResponse.json({error:'Could not verify review permissions.'},{status:503,headers})
    if(role.data!==true)return NextResponse.json({error:'Moderator required.'},{status:403,headers})
    let body
    try{body=templateReviewInput(await readCommunityJson(request))}catch{return NextResponse.json({error:'Check the decision, four quality checks, notes and reviewed evidence.'},{status:400,headers})}
    const result=await client.rpc('community_review_template',{p_post_id:id,p_expected:body.updatedAt,p_decision:body.decision,p_checks:body.checks,p_note:body.note,p_media_ids:body.reviewedMediaIds})
    if(result.error)return NextResponse.json({error:'Template review was not saved. Check the current version, completion evidence and adaptation permission.'},{status:result.error.code==='40001'?409:result.error.code==='42501'?403:result.error.code==='22023'?400:503,headers})
    return NextResponse.json({review:{id:result.data.id,decision:result.data.decision,reviewedAt:result.data.reviewed_at}},{headers})
  }catch{return NextResponse.json({error:'Template review is unavailable.'},{status:503,headers})}
}
