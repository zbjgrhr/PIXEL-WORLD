import {describe,it,expect} from 'vitest'
import type {CommunityMedia,ExperimentRecord} from './community-types'
import {qualifyReviewedTemplate,type TemplatePost,type TemplateExperiment,type TrustedTemplateReview} from './community-template-catalog.server'
const owner='11111111-1111-4111-8111-111111111111',postId='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333',now='2026-10-31T00:00:00Z'
function fixture(){
  const media:CommunityMedia[]=(['game-spec','game-zip','video','image'] as const).map((kind,i)=>({id:`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`,ownerId:owner,runId,kind,storageKey:`${owner}/fixture-${i}.${kind==='video'?'mp4':kind==='image'?'png':kind==='game-zip'?'zip':'json'}`,bytes:1000,sha256:'a'.repeat(64),durationSeconds:kind==='video'?45:null,verifiedAt:now}))
  const checks={storyFidelity:{state:'passed' as const,note:'Synthetic test only',evidenceIds:[media[3].id]},artQuality:{state:'passed' as const,note:'Synthetic test only',evidenceIds:[media[3].id]},webPlaythrough:{state:'passed' as const,note:'Synthetic test only',evidenceIds:[media[2].id]},offlinePlaythrough:{state:'passed' as const,note:'Synthetic test only',evidenceIds:[media[2].id]}}
  const record:ExperimentRecord={id:runId,ownerId:owner,pairId:'fixture',language:'en',tier:'low',outcome:'completed',title:'Fixture only',story:'A penguin finds its mother.',levelCount:3,projectCommit:'unknown',dirtyWorktree:true,promptVersion:'fixture',models:{textProvider:'fixture',textModelId:'test-text',imageProvider:'fixture',imageModelId:'test-image'},timing:[],usage:{budgetUsd:2,costUsd:null,costSource:'unknown',calls:null,tokens:null},fallback:{totalImageTasks:45,supplementedTasks:1,items:[{assetId:'obstacle',pose:null,source:'builtin',reason:'Synthetic fallback'}]},checks,issues:[],mediaIds:media.map(file=>file.id),templateReview:{state:'not-reviewed',reviewerId:null,reviewedAt:null}}
  const post:TemplatePost={id:postId,owner_id:owner,section:'workshop',language:'en',moderation:'published',reuse:'remix-with-credit',experiment_id:runId,updated_at:now}
  const experiment:TemplateExperiment={id:runId,owner_id:owner,language:'en',outcome:'completed',validated_at:now,record}
  const review:TrustedTemplateReview={post_id:postId,experiment_id:runId,post_version:now,decision:'accepted',checks,note:'Synthetic moderator fixture',reviewer_id:'44444444-4444-4444-8444-444444444444',reviewed_at:now}
  return {post,experiment,review,media}
}
describe('reviewed template qualification',()=>{
  it('retains the real author, models, language and fallback details without storage paths',()=>{
    const {post,experiment,review,media}=fixture()
    const result=qualifyReviewedTemplate(post,experiment,review,media,{id:owner,display_name:'Fixture author',is_official:false,avatar_media_id:null,updated_at:now})
    expect(result?.template).toMatchObject({postId,language:'en',levelCount:3,models:{textModelId:'test-text'},fallback:{supplementedTasks:1,totalImageTasks:45},author:{id:owner,displayName:'Fixture author'}})
    expect(JSON.stringify(result?.template)).not.toContain('storageKey')
    expect(result?.record.templateReview.state).toBe('not-reviewed')
  })
  it('never falls back to an old acceptance after rejection, editing, hiding or withdrawing adaptation permission',()=>{
    const {post,experiment,review,media}=fixture()
    expect(qualifyReviewedTemplate(post,experiment,{...review,decision:'rejected'},media)).toBeNull()
    expect(qualifyReviewedTemplate({...post,updated_at:'2026-10-31T01:00:00Z'},experiment,review,media)).toBeNull()
    expect(qualifyReviewedTemplate({...post,moderation:'pending'},experiment,review,media)).toBeNull()
    expect(qualifyReviewedTemplate({...post,reuse:'view-only'},experiment,review,media)).toBeNull()
    expect(qualifyReviewedTemplate(post,experiment,undefined,media)).toBeNull()
  })
  it('rejects changed evidence, cross-run files, false completion and incomplete quality reviews',()=>{
    const {post,experiment,review,media}=fixture()
    expect(qualifyReviewedTemplate(post,experiment,review,media.slice(1))).toBeNull()
    expect(qualifyReviewedTemplate(post,experiment,review,media.map(file=>({...file,runId:'old'})))).toBeNull()
    expect(qualifyReviewedTemplate(post,{...experiment,outcome:'partial'},review,media)).toBeNull()
    expect(qualifyReviewedTemplate(post,{...experiment,validated_at:null},review,media)).toBeNull()
    expect(qualifyReviewedTemplate(post,experiment,{...review,checks:{}},media)).toBeNull()
    expect(qualifyReviewedTemplate(post,experiment,review,media.map(file=>file.kind==='video'?{...file,durationSeconds:61}:file))).toBeNull()
  })
})
