import {describe,it,expect} from 'vitest'
import {templateReviewInput,TEMPLATE_CHECKS} from './community-template-review'
const proof='11111111-1111-4111-8111-111111111111'
const input=()=>({decision:'accepted',updatedAt:'2026-10-31T00:00:00Z',note:'Checked the actual results.',reviewedMediaIds:[proof],checks:Object.fromEntries(TEMPLATE_CHECKS.map(key=>[key,{state:'passed',note:'I checked the evidence.',evidenceIds:[proof]}]))})
describe('separate template quality review',()=>{
  it('requires an explicit note and evidence for every criterion',()=>{
    expect(templateReviewInput(input()).checks.offlinePlaythrough.evidenceIds).toEqual([proof])
    const missing=input();delete (missing.checks as Record<string,unknown>).offlinePlaythrough
    expect(()=>templateReviewInput(missing)).toThrow()
    for(const check of [{state:'failed',note:'Failed',evidenceIds:[proof]},{state:'passed',note:'',evidenceIds:[proof]},{state:'passed',note:'No evidence',evidenceIds:[]}])expect(()=>templateReviewInput({...input(),checks:{...input().checks,artQuality:check}})).toThrow()
  })
  it('rejects evidence substitutions, duplicate IDs and credentials',()=>{
    expect(()=>templateReviewInput({...input(),reviewedMediaIds:[proof,proof]})).toThrow()
    expect(()=>templateReviewInput({...input(),reviewedMediaIds:[]})).toThrow()
    expect(()=>templateReviewInput({...input(),note:`api_key=${'sample'.repeat(10)}`})).toThrow()
    expect(()=>templateReviewInput({...input(),checks:{...input().checks,offlinePlaythrough:{state:'passed',note:'Other run',evidenceIds:['22222222-2222-4222-8222-222222222222']}}})).toThrow()
  })
  it('records rejection without inventing passing checks or taking reviewer identity from the request',()=>{
    const result=templateReviewInput({...input(),decision:'rejected',checks:{},reviewedMediaIds:[],reviewerId:'forged'})
    expect(result.checks).toEqual({});expect(result).not.toHaveProperty('reviewerId')
  })
})
