import { assertPublicText } from './community-validation'

export const TEMPLATE_CHECKS = ['storyFidelity','artQuality','webPlaythrough','offlinePlaythrough'] as const
export type TemplateCheck = typeof TEMPLATE_CHECKS[number]
export interface TemplateReviewInput {
  updatedAt:string; decision:'accepted'|'rejected'; note:string; reviewedMediaIds:string[];
  checks:Record<TemplateCheck,{state:'passed';note:string;evidenceIds:string[]}>
}
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
/** A separate moderator attestation, not a copy of author-reported pass flags. */
export function templateReviewInput(value:unknown):TemplateReviewInput {
  const raw=value as Record<string,unknown> | null
  if(!raw || !['accepted','rejected'].includes(String(raw.decision)) || typeof raw.updatedAt!=='string' || !Number.isFinite(Date.parse(raw.updatedAt))
    || typeof raw.note!=='string' || !raw.note.trim() || raw.note.length>2000)throw new Error('review')
  const media=raw.reviewedMediaIds
  if(!Array.isArray(media) || media.length>30 || media.some(id=>typeof id!=='string' || !uuid.test(id)) || new Set(media).size!==media.length)throw new Error('media')
  const checks={} as TemplateReviewInput['checks']
  if(raw.decision==='accepted'){
    if(!media.length || !raw.checks || typeof raw.checks!=='object')throw new Error('checks')
    for(const key of TEMPLATE_CHECKS){
      const check=(raw.checks as Record<string,Record<string,unknown>>)[key]
      if(!check || check.state!=='passed' || typeof check.note!=='string' || !check.note.trim() || check.note.length>2000
        || !Array.isArray(check.evidenceIds) || !check.evidenceIds.length || check.evidenceIds.length>30 || new Set(check.evidenceIds).size!==check.evidenceIds.length
        || check.evidenceIds.some(id=>typeof id!=='string' || !media.includes(id)))throw new Error('checks')
      checks[key]={state:'passed',note:check.note.trim(),evidenceIds:check.evidenceIds}
    }
  }
  const result={updatedAt:raw.updatedAt,decision:raw.decision as TemplateReviewInput['decision'],note:raw.note.trim(),reviewedMediaIds:media,checks}
  assertPublicText(JSON.stringify(result))
  return result
}
