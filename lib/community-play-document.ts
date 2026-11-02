import {templateAttributionHtml} from './template-attribution'
import {authoredMapRules} from './authored-map'
import {characterRosterRules} from './character-roster'
import {behaviorProgramRules} from './behavior-program'
import {originalArtRules} from './original-art'
import {heroPhysics} from './hero-physics'

export const GAME_PREVIEW_SANDBOX='allow-scripts'
export const GAME_PREVIEW_CSP="default-src 'none'; script-src 'nonce-__PREVIEW_NONCE__'; style-src 'unsafe-inline'; img-src blob:; media-src blob:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export interface PreviewResource{name:string;bytes:Uint8Array;mime:string}

/** Called only after the Worker verifies ZIP, engine and CSS hashes. Raw HTML is
 * never embedded; only its runtime-data JSON is read. Images are transferred
 * into the opaque iframe, which creates and revokes its own Blob URLs. */
export function buildGamePreviewDocument(files:Array<{name:string;bytes:Uint8Array}>,token:string):{html:string;resources:PreviewResource[]}{
  if(!/^[a-f\d-]{16,80}$/i.test(token))throw new Error('Invalid preview token')
  const decoder=new TextDecoder('utf-8',{fatal:true}),map=new Map(files.map(file=>[file.name,file.bytes]))
  const text=(name:string,max:number)=>{const bytes=map.get(name);if(!bytes || bytes.length>max)throw new Error('Unsupported preview data');return decoder.decode(bytes)}
  const project=JSON.parse(text('project.json',2_000_000))
  const sourceHtml=text('index.html',5_000_000),match=sourceHtml.match(/<script type="application\/json" id="runtime-data">([\s\S]*?)<\/script>/)
  if(!match || match[1].length>2_000_000)throw new Error('No supported runtime layout')
  const runtime=JSON.parse(match[1])
  const number=(value:unknown,min:number,max:number)=>typeof value==='number' && Number.isFinite(value) && value>=min && value<=max
  const count=(value:unknown,max:number)=>number(value,0,max) && Number.isInteger(value)
  if(project.version!==3 || typeof project.title!=='string' || project.title.length>1000 || !Array.isArray(project.assets) || project.assets.length>1000
    || !Array.isArray(project.levels) || !project.levels.length || project.levels.length>10 || !Array.isArray(runtime.levels) || runtime.levels.length!==project.levels.length
    || !project.hero || !project.weapon || !project.boss || !project.collectible || !Array.isArray(project.enemies) || project.enemies.length>8)throw new Error('Unsupported game specification')
  for(const [key,max] of [['maxHealth',1_000_000],['moveSpeed',50],['jumpPower',100]] as const)if(!number(project.hero[key],0,max))throw new Error('Invalid player parameters')
  if(project.hero.roster){project.hero.roster=characterRosterRules.validate(project.hero.roster);for(const character of project.hero.roster.characters)if(character.assetId&&!project.assets.some((a:{id:string;enabled:boolean;kind:string})=>a.id===character.assetId&&a.enabled&&['image','spriteSheet'].includes(a.kind)))throw new Error('Invalid character sprite reference')}
  for(const actor of [...project.enemies,project.boss])if(actor.program)actor.program=behaviorProgramRules.validate(actor.program)
  if(project.hero.physics)project.hero.physics=heroPhysics.validate(project.hero.physics)
  for(const key of ['meleeDamage','rangedDamage','cooldownMs','projectileSpeed'])if(!number(project.weapon[key],0,1_000_000))throw new Error('Invalid weapon parameters')
  for(const enemy of [...project.enemies,project.boss])if(!number(enemy.health,0,1_000_000) || !number(enemy.damage,0,1_000_000))throw new Error('Invalid actor parameters')
  if(!number(project.collectible.value,0,1_000_000))throw new Error('Invalid collectible')
  const assets=new Map<string,PreviewResource>()
  const mime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm'}
  const assetUrl=(value:unknown,required=true):string|undefined=>{
    if(!value)return undefined
    if(typeof value!=='string' || !/^assets\/[a-z\d_/-]+\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|mp4|webm)$/i.test(value) || value.split('/').some(part=>part==='..' || part==='.') || !map.has(value)){
      if(!required)return undefined
      throw new Error('Missing or external game asset')
    }
    if(!assets.has(value))assets.set(value,{name:value,bytes:map.get(value)!,mime:mime[value.split('.').pop()!.toLowerCase()]})
    return value
  }
  for(const asset of project.assets){
    if(!asset || typeof asset.id!=='string' || !Array.isArray(asset.levelIds) || asset.levelIds.length>10)throw new Error('Invalid asset plan')
    asset.url=assetUrl(asset.url,asset.enabled!==false)
    if(asset.animation?.clips && (Object.keys(asset.animation.clips).length>7 || Object.keys(asset.animation.clips).some(pose=>!['idle','walk','jump','meleeAttack','rangedAttack','hit','death'].includes(pose))))throw new Error('Unsupported animation states')
    if(asset.original)asset.original=originalArtRules.validate(asset.original)
    if(asset.animation?.clips)for(const clip of Object.values(asset.animation.clips) as Array<Record<string,unknown>|null>){
      if(!clip)continue
      if(!count(clip.frameCount,64) || !number(clip.frameCount,1,64) || !number(clip.fps,0,60))throw new Error('Invalid animation parameters')
      if(clip.original){const meta=originalArtRules.validate(clip.original);const layout=originalArtRules.layout(clip);if(layout){Object.assign(clip,layout);for(const [i,p] of layout.originalPages.entries())if(i)p.url=assetUrl(p.url,asset.enabled!==false&&clip.enabled!==false)}if(!layout&&!originalArtRules.geometry(meta.width,meta.height,Number(clip.frameCount)))throw new Error('Invalid original strip geometry');originalArtRules.order(clip.frameOrder,Number(clip.frameCount));clip.original=meta}
      clip.url=assetUrl(clip.url,asset.enabled!==false && clip.enabled!==false)
    }
  }
  for(let i=0;i<runtime.levels.length;i++){
    const level=runtime.levels[i],setting=project.levels[i]
    const authored=setting?.map?authoredMapRules.validate(setting.map):undefined
    if(!level || level.id!==setting.id || !count(setting.enemyCount,authored?512:12) || !count(setting.collectibleCount,authored?512:10) || !setting.music || !Array.isArray(setting.music.scale) || setting.music.scale.length>16 || setting.music.scale.some((note:unknown)=>!number(note,-24,24)) || !number(setting.music.tempo,50,220) || !number(setting.music.rootFrequency,55,880) || !number(setting.music.intensity,0,1) || !setting.effects
      || level.worldWidth!==undefined && !number(level.worldWidth,authored?320:1120,authored?32768:10000))throw new Error('Unsupported level layout')
    if(authored){
      if(!level.authoredMap || level.layoutVersion!==3 || level.worldWidth!==authored.width)throw new Error('Authored layout missing or inconsistent')
      const original=authoredMapRules.validate(level.authoredMap),geometry=authoredMapRules.validate({...original,obstacles:level.obstacles,enemies:level.enemySpawns,collectibles:level.collectibleSpawns,boss:level.bossSpawn})
      if(JSON.stringify(original)!==JSON.stringify(authored) || JSON.stringify(geometry)!==JSON.stringify(authored))throw new Error('Authored layout differs from the game specification')
    }else if(level.authoredMap)throw new Error('Unexpected authored layout')
    for(const [key,max] of [['obstacles',1000],['enemySpawns',40],['collectibleSpawns',40]] as const){
      if(!Array.isArray(level[key]) || level[key].length>(authored?512:max))throw new Error('Invalid entity count')
      for(const entity of level[key])if(!entity || !number(entity.x,-10000,100000) || !number(entity.y,-10000,100000))throw new Error('Invalid entity position')
    }
    if(level.obstacles.some((entity:{width:unknown;height:unknown})=>!number(entity.width,1,authored?32768:2048) || !number(entity.height,1,authored?32768:2048)))throw new Error('Invalid obstacle size')
    if(level.bossSpawn && (!number(level.bossSpawn.x,-10000,100000) || !number(level.bossSpawn.y,-10000,100000)))throw new Error('Invalid Boss position')
    for(const key of ['backgroundUrl','groundUrl','obstacleUrl'])level[key]=assetUrl(level[key]) || ''
  }
  const safeJson=(value:unknown)=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`)
  const escape=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!))
  const english=project.creationLanguage==='en',title=escape(project.title)
  const nonce=token.replace(/-/g,'')
  const bridge=`(()=>{
    const token=${JSON.stringify(token)},nonce=${JSON.stringify(nonce)},urls=new Set(),rafs=new Set();let started=false,disposed=false,timer=0;
    const tell=state=>parent.postMessage({type:'pixel-world-preview',token,state},'*');
    const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{if(disposed)return 0;const id=request(time=>{rafs.delete(id);if(!disposed)callback(time)});rafs.add(id);return id};
    const dispose=()=>{if(disposed)return;disposed=true;clearInterval(timer);for(const id of rafs)cancel(id);rafs.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear()};
    const error=()=>{dispose();tell('error')};addEventListener('error',error);addEventListener('unhandledrejection',error);addEventListener('pagehide',dispose);addEventListener('unload',dispose);
    addEventListener('message',event=>{
      if(event.source!==parent || event.data?.token!==token)return;
      if(event.data.type==='pixel-world-preview-dispose'){dispose();tell('disposed');return}
      if(started || disposed || event.data.type!=='pixel-world-preview-resources')return;
      started=true;
      try{
        const resources=new Map();for(const file of event.data.resources){const url=URL.createObjectURL(new Blob([file.bytes],{type:file.mime}));urls.add(url);resources.set(file.name,url)}
        const projectNode=document.getElementById('project-data'),runtimeNode=document.getElementById('runtime-data'),project=JSON.parse(projectNode.textContent),runtime=JSON.parse(runtimeNode.textContent);
        const replace=value=>value?resources.get(value):undefined;
        for(const asset of project.assets){asset.url=replace(asset.url);if(asset.animation?.clips)for(const clip of Object.values(asset.animation.clips))if(clip){clip.url=replace(clip.url);if(clip.originalPages)for(let i=1;i<clip.originalPages.length;i++)clip.originalPages[i].url=replace(clip.originalPages[i].url)}}
        for(const level of runtime.levels)for(const key of ['backgroundUrl','groundUrl','obstacleUrl'])level[key]=replace(level[key]) || '';
        projectNode.textContent=JSON.stringify(project);runtimeNode.textContent=JSON.stringify(runtime);
        const script=document.createElement('script');script.nonce=nonce;script.textContent=JSON.parse(document.getElementById('engine-source').textContent);document.body.append(script);
        timer=setInterval(()=>{if(globalThis.__pixelWorldReadOnlySnapshot?.()){clearInterval(timer);tell('ready')}},100);
        setTimeout(()=>{if(!disposed && !globalThis.__pixelWorldReadOnlySnapshot?.())error()},15000);
      }catch{error()}
    });tell('awaiting-assets');
  })();`
  const styles=text('styles.css',1_000_000).replace(/<\/style/gi,'<\\/style')
  const engine=text('game.js',2_000_000)
  return {resources:[...assets.values()],html:`<!doctype html><html lang="${english?'en':'zh-CN'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${GAME_PREVIEW_CSP.replace('__PREVIEW_NONCE__',nonce)}"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${styles}</style></head><body><main class="shell"><div class="bar"><b>${title}</b><span id="level"></span><span id="score"></span><small class="hint">A/D · Space · J · K · E · Esc</small><button data-pause>${english?'Pause':'暂停'}</button></div><canvas width="1152" height="648"></canvas><div class="controls"><div><button data-key="a">←</button><button data-key="d">→</button><button data-key=" ">${english?'Jump':'跳跃'}</button></div><div><button data-key="slash">${english?'Slash':'近战'}</button><button data-key="shoot">${english?'Shoot':'远程射击'}</button></div></div>${templateAttributionHtml(project.templateSources,project.creationLanguage)}</main><div class="overlay">${english?'Adventure Complete!':'冒险完成！'}</div><script type="application/json" id="project-data">${safeJson(project)}</script><script type="application/json" id="runtime-data">${safeJson(runtime)}</script><script type="application/json" id="engine-source">${safeJson(engine)}</script><script nonce="${nonce}">${bridge}</script></body></html>`}
}
