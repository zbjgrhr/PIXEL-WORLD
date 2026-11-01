import type {TemplateAttribution} from '@/types'

export function readTemplateAttributions(value:unknown):TemplateAttribution[]|undefined{
  if(!Array.isArray(value) || value.length>20)return undefined
  const ids=new Set<string>(),result:TemplateAttribution[]=[]
  const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
  for(const raw of value){
    if(!raw || typeof raw!=='object' || !uuid.test(raw.postId) || !uuid.test(raw.authorId) || raw.license!=='remix-with-credit'
      || typeof raw.revision!=='string' || !Number.isFinite(Date.parse(raw.revision)) || typeof raw.authorName!=='string' || !raw.authorName.trim() || raw.authorName.length>80)return undefined
    const key=`${raw.postId}:${raw.revision}`
    if(ids.has(key))continue
    ids.add(key);result.push({postId:raw.postId,revision:raw.revision,authorId:raw.authorId,authorName:raw.authorName.trim(),license:'remix-with-credit'})
  }
  return result
}

export function templateAttributionText(value:unknown,language:unknown):string{
  const sources=readTemplateAttributions(value) || []
  if(!sources.length)return ''
  return (language==='en'?'Template attribution\nAdapted with attribution from:':'模板来源署名\n本作品基于以下允许署名改编的模板：')+'\n'+sources.map(source=>`${source.authorName}\nPost: ${source.postId}\nRevision: ${source.revision}`).join('\n\n')
}

export function templateAttributionHtml(value:unknown,language:unknown):string{
  const text=templateAttributionText(value,language)
  if(!text)return ''
  const escaped=text.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!))
  return `<footer class="template-attribution" style="white-space:pre-wrap;padding:12px 18px;font-size:12px">${escaped}</footer>`
}
