import {describe,it,expect} from 'vitest'
import {createFallbackGameSpec,normalizeGameSpec} from './game-spec'
import {prepareTemplateReuse} from './community-template-reuse.server'
import {buildStructuredPrompt,createActionStripAnimation} from './asset-catalog'
import {readTemplateAttributions,templateAttributionHtml} from './template-attribution'
import {buildGameDataFromSpec} from './virtual-levels'
import {migrateGameData} from './store'
import type {ReviewedTemplate} from './community-template'
const postId='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',revision='2026-10-31T00:00:00Z'
describe('reviewed template reuse without inherited approval or pictures',()=>{
  for(const language of ['zh-CN','en'] as const){
    const title=language==='en'?'A Penguin Finds Its Mother':'小企鹅找妈妈',story=language==='en'?'A penguin explores rural Japan, defeats a panda Boss and finds its mother.':'小企鹅在日本世界打败怪物和熊猫Boss，最后找到妈妈。'
    const source=createFallbackGameSpec(`背景故事：${story}`,title,3,language)
    source.hero.moveSpeed=6;source.hero.jumpPower=17;source.weapon.meleeDamage=41
    source.assets=source.assets.map(asset=>({...asset,enabled:false,url:'https://private.example/old.png',status:'success',animation:asset.kind==='spriteSheet'?{...createActionStripAnimation(),clips:{idle:{frameCount:1,fps:1,loop:true,enabled:true,status:'success',url:'https://private.example/idle.png'}}}:undefined}))
    const template:ReviewedTemplate={postId,revision,experimentId:'33333333-3333-4333-8333-333333333333',title,story,language,levelCount:3,models:{textProvider:'fixture',textModelId:'text',imageProvider:'fixture',imageModelId:'image'},tier:'low',fallback:{totalImageTasks:45,supplementedTasks:1,items:[{assetId:'obstacle',pose:null,source:'builtin',reason:'Fixture only'}]},author:{id:owner,displayName:'Template author',isOfficial:false,avatarUrl:null},reviewedAt:revision}
    it(`clears detailed settings in story-only mode while retaining attribution in ${language}`,()=>{
      const result=prepareTemplateReuse(template,JSON.stringify(source),'story')
      expect(result).toMatchObject({title,story,language,levelCount:3,spec:null,prompt:buildStructuredPrompt(3)})
      expect(result.templateSources).toEqual([{postId,revision,authorId:owner,authorName:'Template author',license:'remix-with-credit'}])
      expect(result).not.toHaveProperty('approved')
    })
    it(`preserves planning parameters and clears even disabled images and clips in ${language}`,()=>{
      const earlier={postId:'55555555-5555-4555-8555-555555555555',revision,authorId:owner,authorName:'Earlier template author',license:'remix-with-credit' as const}
      const result=prepareTemplateReuse(template,JSON.stringify({...source,templateSources:[earlier]}),'complete')
      expect(result.templateSources).toHaveLength(2)
      expect(result.templateSources[0]).toEqual(earlier)
      expect(result.spec?.creationLanguage).toBe(language)
      expect(result.spec?.hero).toMatchObject({moveSpeed:6,jumpPower:17})
      expect(result.spec?.weapon.meleeDamage).toBe(41)
      expect(result.spec?.narrative?.ending).toBe(source.narrative?.ending)
      expect(result.spec?.narrative?.source.origin).toBe('player')
      expect(JSON.stringify(result)).not.toContain('private.example')
      expect(result.spec?.assets.filter(asset=>['image','spriteSheet'].includes(asset.kind)).every(asset=>asset.status==='pending' && !asset.url)).toBe(true)
      expect(source.assets[0].url).toBe('https://private.example/old.png')
      const normalized=normalizeGameSpec(result.spec,result.spec!,3)
      expect(normalized.templateSources).toEqual(result.templateSources)
      expect(migrateGameData(buildGameDataFromSpec(normalized)).data?.spec?.templateSources).toEqual(result.templateSources)
    })
    it(`rejects a mismatched language, round size or malformed inherited credit in ${language}`,()=>{
      expect(()=>prepareTemplateReuse({...template,language:language==='en'?'zh-CN':'en'},JSON.stringify(source),'complete')).toThrow()
      expect(()=>prepareTemplateReuse({...template,levelCount:2},JSON.stringify(source),'complete')).toThrow()
      expect(()=>prepareTemplateReuse(template,JSON.stringify({...source,templateSources:[{authorName:'A missing source'}]}),'story')).toThrow()
    })
  }
  it('retains earlier attribution and escapes names when rendering offline credits',()=>{
    const credit={postId,revision,authorId:owner,authorName:'<img src=x onerror=alert(1)>',license:'remix-with-credit'}
    const html=templateAttributionHtml([credit],'en')
    expect(html).toContain('&lt;img');expect(html).not.toContain('<img')
    expect(readTemplateAttributions([{...credit,postId:'../../private'}])).toBeUndefined()
    expect(readTemplateAttributions([credit,credit])).toHaveLength(1)
  })
})
