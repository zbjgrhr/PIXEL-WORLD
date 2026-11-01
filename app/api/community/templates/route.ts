import {NextResponse} from 'next/server'
import {communityServerClient} from '@/lib/supabase/server'
import {communityAdminClient} from '@/lib/supabase/admin.server'
import {communityResponseHeaders as headers} from '@/lib/community-http'
import {loadReviewedTemplates} from '@/lib/community-template-load.server'

export const dynamic='force-dynamic'
export async function GET(request:Request){
  try{
    const language=new URL(request.url).searchParams.get('language') || 'zh-CN'
    if(!['zh-CN','en'].includes(language))return NextResponse.json({error:'Invalid work language.'},{status:400,headers})
    const client=await communityServerClient(),admin=communityAdminClient()
    if(!client || !admin)return NextResponse.json({configured:false,templates:[]},{headers})
    const entries=await loadReviewedTemplates(client,admin,language)
    return NextResponse.json({configured:true,templates:entries.map(entry=>entry.template)},{headers})
  }catch{return NextResponse.json({error:'Reviewed templates are unavailable.'},{status:503,headers})}
}
