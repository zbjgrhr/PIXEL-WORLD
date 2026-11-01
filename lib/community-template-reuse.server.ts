import type {GameSpec,TemplateReuseSelection} from '@/types'
import type {ReviewedTemplate} from './community-template'
import {readTemplateAttributions} from './template-attribution'
import {checkSpecText} from './community-file-rules.server'
import {normalizeGameSpec,serializeGameSpec} from './game-spec'
import {buildStructuredPrompt} from './asset-catalog'

export function prepareTemplateReuse(template:ReviewedTemplate,rawText:string,mode:'story'|'complete'):TemplateReuseSelection{
  const metadata=checkSpecText(rawText),raw=JSON.parse(rawText) as GameSpec
  if(raw.version!==3 || metadata.language!==template.language || metadata.levelCount!==template.levelCount || template.levelCount>10)throw new Error('unsupported-template')
  const previous=readTemplateAttributions(raw.templateSources)
  if(raw.templateSources!==undefined && !previous)throw new Error('invalid-attribution')
  const templateSources=readTemplateAttributions([...(previous || []).filter(item=>item.postId!==template.postId || item.revision!==template.revision),{
    postId:template.postId,revision:template.revision,authorId:template.author.id,authorName:template.author.displayName || `Player ${template.author.id.slice(0,8)}`,license:'remix-with-credit',
  }])
  if(!templateSources)throw new Error('attribution-limit')
  if(mode==='story')return {title:template.title,story:template.story,language:template.language,levelCount:template.levelCount,prompt:buildStructuredPrompt(template.levelCount),spec:null,templateSources}
  const normalized=normalizeGameSpec(raw,raw,template.levelCount)
  const spec:GameSpec={...normalized,templateSources,assets:normalized.assets.map(asset=>({...asset,url:undefined,source:undefined,error:undefined,
    status:asset.kind==='image' || asset.kind==='spriteSheet'?'pending':'success',
    animation:asset.animation?{...asset.animation,clips:asset.animation.clips?Object.fromEntries(Object.entries(asset.animation.clips).map(([pose,clip])=>[pose,clip?{...clip,url:undefined,source:undefined,error:undefined,status:'pending'}:clip])):undefined}:undefined,
  }))}
  if(spec.narrative)spec.narrative={...spec.narrative,source:{...spec.narrative.source,originalTitle:template.title,originalStory:template.story,origin:'player'}}
  return {title:template.title,story:template.story,language:template.language,levelCount:template.levelCount,prompt:serializeGameSpec(spec),spec,templateSources}
}
