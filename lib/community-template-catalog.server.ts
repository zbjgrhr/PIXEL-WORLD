import type { CommunityMedia,ExperimentRecord } from './community-types'
import type { ReviewedTemplate } from './community-template'
import { importExperimentRecord } from './community-experiment.server'
import {templateEligibility} from './community-validation'
import {templateReviewInput} from './community-template-review'
import {publicAuthor,type ProfileRow} from './community-profile'

export interface TemplatePost {id:string;owner_id:string;section:string;language:string;moderation:string;reuse:string;experiment_id:string|null;updated_at:string}
export interface TemplateExperiment {id:string;owner_id:string;language:string;outcome:string;validated_at:string|null;record:unknown}
export interface TrustedTemplateReview {post_id:string;experiment_id:string;post_version:string;decision:string;checks:unknown;note:string;reviewer_id:string;reviewed_at:string}

/** The caller must pass only the latest trusted decision, even if rejected. */
export function qualifyReviewedTemplate(post:TemplatePost,experiment:TemplateExperiment|undefined,review:TrustedTemplateReview|undefined,media:CommunityMedia[],profile?:ProfileRow):{template:ReviewedTemplate;record:ExperimentRecord}|null{
  if(post.section!=='workshop' || post.moderation!=='published' || post.reuse!=='remix-with-credit' || !experiment?.validated_at
    || experiment.owner_id!==post.owner_id || experiment.id!==post.experiment_id || experiment.language!==post.language || experiment.outcome!=='completed'
    || !review || review.decision!=='accepted' || review.post_id!==post.id || review.experiment_id!==experiment.id || review.post_version!==post.updated_at
    || !review.reviewer_id || !Number.isFinite(Date.parse(review.reviewed_at)) || media.some(file=>file.runId!==experiment.id || !file.storageKey.startsWith(`${post.owner_id}/`) || file.storageKey.includes('..')))return null
  try{
    const record=importExperimentRecord(experiment.record,experiment.owner_id,experiment.id,media.map(file=>({...file,runId:null})))
    if(record.language!==post.language || record.outcome!==experiment.outcome)return null
    const checked=templateReviewInput({decision:'accepted',updatedAt:review.post_version,note:review.note,reviewedMediaIds:media.map(file=>file.id),checks:review.checks})
    // Use the moderator's explicit checks, not author pass flags, for selection.
    const reviewed={...record,checks:checked.checks,templateReview:{state:'accepted' as const,reviewerId:review.reviewer_id,reviewedAt:review.reviewed_at}}
    if(!templateEligibility(reviewed,media).eligible)return null
    return {record,template:{postId:post.id,revision:post.updated_at,experimentId:experiment.id,title:record.title,story:record.story,language:record.language,levelCount:record.levelCount,
      models:record.models,tier:record.tier,fallback:record.fallback,author:publicAuthor(post.owner_id,profile),reviewedAt:review.reviewed_at}}
  }catch{return null}
}
