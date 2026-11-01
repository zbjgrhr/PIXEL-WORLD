import {NextResponse} from 'next/server'
import {createHash} from 'node:crypto'
import {communityServerClient} from '@/lib/supabase/server'
import {communityAdminClient} from '@/lib/supabase/admin.server'
import {communityResponseHeaders as headers} from '@/lib/community-http'
import {loadReviewedTemplates} from '@/lib/community-template-load.server'
import {prepareTemplateReuse} from '@/lib/community-template-reuse.server'

export const dynamic='force-dynamic'
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params,url=new URL(request.url),mode=url.searchParams.get('mode'),language=url.searchParams.get('language'),revision=url.searchParams.get('revision')
    if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id) || !['story','complete'].includes(mode || '') || !['zh-CN','en'].includes(language || '') || !revision || revision.length>50 || !Number.isFinite(Date.parse(revision)))return NextResponse.json({error:'Invalid template selection.'},{status:400,headers})
    const client=await communityServerClient(),admin=communityAdminClient()
    if(!client || !admin)return NextResponse.json({error:'Template reuse is not configured.'},{status:503,headers})
    const entry=(await loadReviewedTemplates(client,admin,language!,id))[0]
    if(!entry || entry.template.revision!==revision)return NextResponse.json({error:'This template changed or is no longer available for reuse. Refresh the library.'},{status:409,headers})
    const specs=entry.media.filter(file=>file.kind==='game-spec')
    if(specs.length!==1)return NextResponse.json({error:'One verified GameSpec is required for unambiguous template reuse.'},{status:409,headers})
    const file=specs[0],download=await admin.storage.from('community-media').download(file.storageKey)
    if(download.error || !download.data || download.data.size!==file.bytes)throw new Error('file')
    const bytes=Buffer.from(await download.data.arrayBuffer())
    if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('hash')
    let selection
    try{selection=prepareTemplateReuse(entry.template,new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''),mode as 'story'|'complete')}
    catch{return NextResponse.json({error:'This GameSpec cannot be reused by the current editor. The current draft has not changed.'},{status:409,headers})}
    if(new TextEncoder().encode(JSON.stringify(selection)).byteLength>512_000)return NextResponse.json({error:'These settings exceed the editor import limit. No settings were truncated or applied.'},{status:413,headers})
    // A revocation/version change during object retrieval must not apply a stale
    // template. No original file path, image bytes or expiring URLs are returned.
    const current=(await loadReviewedTemplates(client,admin,language!,id))[0]
    if(!current || current.template.revision!==revision || !current.media.some(item=>item.id===file.id && item.sha256===file.sha256))return NextResponse.json({error:'Template permission or evidence changed. Refresh the library.'},{status:409,headers})
    return NextResponse.json({selection,requiresReview:true},{headers})
  }catch{return NextResponse.json({error:'Template reuse could not be confirmed. The current draft has not changed.'},{status:503,headers})}
}
