import type { CreationLanguage } from '@/types'
import type { PublicAuthor } from './community-profile'
import type { ExperimentRecord } from './community-types'

export interface ReviewedTemplate {
  postId:string; revision:string; experimentId:string; title:string; story:string; language:CreationLanguage; levelCount:number;
  models:ExperimentRecord['models']; tier:ExperimentRecord['tier']; fallback:ExperimentRecord['fallback'];
  author:PublicAuthor; reviewedAt:string;
}
