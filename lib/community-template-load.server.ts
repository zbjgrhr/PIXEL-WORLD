import type {communityServerClient} from './supabase/server'
import type {communityAdminClient} from './supabase/admin.server'
import {profileColumns,type ProfileRow} from './community-profile'
import {qualifyReviewedTemplate,type TemplatePost,type TemplateExperiment,type TrustedTemplateReview} from './community-template-catalog.server'
import type {CommunityMedia} from './community-types'

export async function loadReviewedTemplates(client:NonNullable<Awaited<ReturnType<typeof communityServerClient>>>,admin:NonNullable<ReturnType<typeof communityAdminClient>>,language:string,postId?:string){
  let selectedIds:string[]
  if(postId)selectedIds=[postId]
  else{
    const selected=await admin.rpc('community_public_template_candidates',{p_language:language})
    if(selected.error)throw new Error('selection')
    selectedIds=(selected.data || []).map((item:{post_id:string})=>item.post_id)
  }
  if(!selectedIds.length)return []
  const posts=await client.from('community_posts').select('id,owner_id,section,language,moderation,reuse,experiment_id,updated_at')
    .eq('section','workshop').eq('language',language).eq('moderation','published').eq('reuse','remix-with-credit').in('id',selectedIds).not('experiment_id','is',null).order('created_at',{ascending:false}).limit(20)
  if(posts.error)throw new Error('posts')
  const candidates=(posts.data || []) as TemplatePost[]
  if(!candidates.length)return []
  const ids=candidates.map(post=>post.id),experimentIds=[...new Set(candidates.map(post=>post.experiment_id!))],ownerIds=[...new Set(candidates.map(post=>post.owner_id))]
  const [reviews,runs,files,profiles]=await Promise.all([
    admin.rpc('community_latest_template_reviews',{p_post_ids:ids}),
    admin.from('community_experiments').select('id,owner_id,language,outcome,record,validated_at').in('id',experimentIds).limit(20),
    client.from('community_post_media').select('post_id,media:community_media(id,owner_id,run_id,kind,storage_key,bytes,sha256,duration_seconds,verified_at)').in('post_id',ids).limit(601),
    client.from('community_profiles').select(profileColumns).in('id',ownerIds).limit(20),
  ])
  if(reviews.error || runs.error || files.error || profiles.error || (files.data?.length || 0)>600)throw new Error('evidence')
  const latest=new Map(((reviews.data || []) as TrustedTemplateReview[]).map(review=>[review.post_id,review]))
  const experiments=new Map(((runs.data || []) as TemplateExperiment[]).map(run=>[run.id,run]))
  const authors=new Map(((profiles.data || []) as ProfileRow[]).map(profile=>[profile.id,profile]))
  const attachments=new Map<string,CommunityMedia[]>()
  for(const entry of files.data || []){
    const raw=entry.media as unknown as {id:string;owner_id:string;run_id:string|null;kind:CommunityMedia['kind'];storage_key:string;bytes:number;sha256:string;duration_seconds:number|null;verified_at:string|null}
    if(!raw)throw new Error('media')
    const group=attachments.get(entry.post_id) || []
    group.push({id:raw.id,ownerId:raw.owner_id,runId:raw.run_id,kind:raw.kind,storageKey:raw.storage_key,bytes:raw.bytes,sha256:raw.sha256,durationSeconds:raw.duration_seconds,verifiedAt:raw.verified_at})
    attachments.set(entry.post_id,group)
  }
  return candidates.flatMap(post=>{
    const media=attachments.get(post.id) || []
    const qualified=qualifyReviewedTemplate(post,experiments.get(post.experiment_id!),latest.get(post.id),media,authors.get(post.owner_id))
    return qualified?[{...qualified,media}]:[]
  })
}
