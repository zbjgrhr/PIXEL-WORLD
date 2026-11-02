import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createFallbackGameSpec} from '../game-spec'
import {buildBuiltinGameSpec} from '../builtin-game'
import {applyOriginalMappings,type OriginalMapping} from '../batch-original-import'
import type {AuthoredLevelMap,BehaviorStage,GameSpec} from '@/types'

export const acceptanceMap=():AuthoredLevelMap=>({version:2,width:1600,height:720,groundY:600,player:{x:60,y:536,width:32,height:64},exit:{x:1490,y:504,width:64,height:96},obstacles:[{id:'ledge',type:'platform',x:1000,y:440,width:180,height:20}],enemies:[],collectibles:[],boss:{id:'boss-1',kind:'boss',x:1150,y:536,width:64,height:64},checkpoints:[{id:'save-1',x:60,y:510,width:48,height:90,respawn:{x:80,y:536}}],mechanisms:[
  {id:'horizontal',kind:'movingPlatform',x:250,y:440,width:100,height:18,axis:'x',distance:100,speed:2},
  {id:'vertical',kind:'movingPlatform',x:700,y:400,width:100,height:18,axis:'y',distance:-120,speed:2},
  {id:'ice',kind:'freeze',x:180,y:536,width:50,height:64,durationMs:200,cooldownMs:500},
  {id:'reverse',kind:'reverse',x:320,y:536,width:50,height:64,durationMs:200,cooldownMs:500},
  {id:'warning-trap',kind:'trap',x:510,y:536,width:40,height:64,delayMs:200,durationMs:400,cooldownMs:500},
]})
export async function recreationAcceptanceSpec():Promise<GameSpec>{
  let spec=buildBuiltinGameSpec(createFallbackGameSpec('原图、地图、物理、机关、双角色、阶段与存档的联合验证。','原作还原工作流联合验收',1))
  spec.narrative=undefined
  spec.hero={...spec.hero,maxHealth:100,moveSpeed:5,jumpPower:9,physics:{acceleration:0,gravity:0.4,airControl:1,jumpCount:2,releaseJumpSpeed:4,runUpBoost:0.2,runUpLimit:6}}
  spec.weapon={...spec.weapon,meleeDamage:30,rangedDamage:30,cooldownMs:420,projectileSpeed:12}
  spec.boss={...spec.boss,health:30,damage:1,speed:0,program:{version:1,loop:false,onDefeat:'remove',stages:Array.from({length:6},(_,i):BehaviorStage=>({id:'stage-'+i,label:'阶段 '+(i+1),triggerDistance:0,triggerAbove:false,warningMs:50,activeMs:i===5?120000:100,cooldownMs:50,repeats:1,motion:i===1?'stretch':i===3?'offset':'still',dx:i===3?40:0,dy:i===1?30:0,speed:1,leash:100,attack:'none',attackEveryMs:500,vulnerable:true,transition:'time',healthBelow:0.5}))}}
  const hero=spec.assets.find(a=>a.category==='hero')!
  spec.assets.push({...hero,id:'hero-ball',title:'Ball 参考角色'})
  spec.hero.roster={version:1,initialId:'regular',allowSwitch:true,respawn:'cycle',seed:12345,characters:[
    {id:'regular',name:'Regular 参考',assetId:hero.id,maxHealth:100,moveSpeed:5,jumpPower:9,width:32,height:64,meleeMultiplier:1,rangedMultiplier:1,weight:1,physics:spec.hero.physics},
    {id:'ball',name:'Ball 移动参考',assetId:'hero-ball',maxHealth:100,moveSpeed:4,jumpPower:9,width:32,height:32,meleeMultiplier:0,rangedMultiplier:1,weight:1,physics:{...spec.hero.physics!,gravity:0.5,runUpBoost:0}},
  ]}
  spec.levels[0]={...spec.levels[0],map:acceptanceMap(),enemyCount:0,collectibleCount:0,hasBoss:true}
  spec.reference={version:1,title:'IWBTZ / 可编辑能力联合检查',source:'用户提供的GameMaker工程；仅引用数值和原图，联合测试地图及阶段是明确的验证配置。',requirements:[
    {id:'controls',category:'controls',policy:'creative',description:'双跳、松键截短、助跑及可调物理，使用Regular参考值。',evidence:'objects/obj_charReg/Create_0.gml; Step_0.gml'},
    {id:'maps',category:'map',policy:'creative',description:'联合验收地图用于覆盖所有编辑与恢复能力；不冒称原作房间。',evidence:'GameSpec.levels[0].map'},
    {id:'actors',category:'characters',policy:'creative',description:'双角色独立物理、原图、碰撞框、切换及轮换复活。',evidence:'obj_charReg / obj_charBall；完整原作特殊攻击不在本配置内。'},
    {id:'boss',category:'enemies',policy:'creative',description:'六阶段可编辑状态机；这是阶段系统验收配置。',evidence:'obj_chomper结构参考；未声称等价原作行为。'},
    {id:'source-specials',category:'mechanisms',policy:'unsupported',description:'原作独立头身、圆形头部判定、脚本动态改图及全部特殊攻击尚不自动执行。',evidence:'GameMaker对象事件；需逐项扩展后才可标还原。'},
    {id:'completion',category:'completion',policy:'creative',description:'击败Boss后抵达出口；死亡从最近存档点满血复活，重置本关实体。',evidence:'当前共享机关、角色与行为规则。'},
  ]}
  for(const a of spec.assets)if(a.url?.startsWith('/builtin/'))a.url='data:image/svg+xml;base64,'+(await readFile(join(process.cwd(),'public',a.url))).toString('base64')
  const source=process.env.PIXEL_WORLD_GAMEMAKER_ROOT,reference=process.env.PIXEL_WORLD_GAMEMAKER_REFERENCE
  if(source&&reference){const ref=JSON.parse(await readFile(reference,'utf8')),entries:OriginalMapping[]=[]
    for(const [spriteId,assetId,pose]of [['spr_charReg_idle',hero.id,'idle'],['spr_charReg_walk',hero.id,'walk'],['spr_charBall_idle','hero-ball','idle']] as const){const sprite=ref.sprites.find((s:{id:string})=>s.id===spriteId);for(let i=0;i<sprite.frameIds.length;i++){const file=sprite.frameIds[i]+'.png',bytes=await readFile(join(source,'sprites',spriteId,file));entries.push({assetId,pose,layout:'sequence',sequenceIndex:i,frameCount:1,fps:Math.max(1,Math.min(60,sprite.playbackSpeed)),loop:true,url:'data:image/png;base64,'+bytes.toString('base64'),original:{version:1,fileName:file,width:sprite.width,height:sprite.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})}}
    spec=applyOriginalMappings(spec,entries)
  }
  return spec
}
