import { offlineNarrativeRuntimeSource } from './narrative-runtime'
import { offlineEnemyCombatSource } from './enemy-combat'
import { buildGameDataFromSpec } from './virtual-levels'
import { animationClipPoses, normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AssetDefinition, GameSpec } from '@/types'

const encoder = new TextEncoder()

export class ExportValidationError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing enabled assets: ${missing.join(', ')}`)
  }
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'pixel-world'
}

function extensionFor(contentType: string, url: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('gif')) return 'gif'
  const match = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)
  return match?.[1]?.toLowerCase() || 'png'
}

async function readAsset(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (url.startsWith('data:')) {
    const [header, payload] = url.split(',', 2)
    const contentType = header.match(/^data:([^;,]+)/)?.[1] || 'image/png'
    if (header.includes(';base64')) {
      const binary = atob(payload)
      return { bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), contentType }
    }
    return { bytes: encoder.encode(decodeURIComponent(payload)), contentType }
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Asset download failed (${response.status}): ${url}`)
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'image/png' }
}

let crcTable: Uint32Array | undefined
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let value = n
      for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[n] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function makeZip(entries: Array<{ name: string; bytes: Uint8Array }>): Blob {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const stamp = dosDateTime()
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.bytes)
    const local = new Uint8Array(30 + name.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0, true)
    view.setUint16(8, 0, true); view.setUint16(10, stamp.time, true); view.setUint16(12, stamp.date, true)
    view.setUint32(14, crc, true); view.setUint32(18, entry.bytes.length, true); view.setUint32(22, entry.bytes.length, true)
    view.setUint16(26, name.length, true); view.setUint16(28, 0, true); local.set(name, 30)
    chunks.push(local, entry.bytes)

    const directory = new Uint8Array(46 + name.length)
    const centralView = new DataView(directory.buffer)
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true); centralView.setUint16(10, 0, true); centralView.setUint16(12, stamp.time, true); centralView.setUint16(14, stamp.date, true)
    centralView.setUint32(16, crc, true); centralView.setUint32(20, entry.bytes.length, true); centralView.setUint32(24, entry.bytes.length, true)
    centralView.setUint16(28, name.length, true); centralView.setUint16(30, 0, true); centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true); centralView.setUint16(36, 0, true); centralView.setUint32(38, 0, true); centralView.setUint32(42, offset, true)
    directory.set(name, 46); central.push(directory)
    offset += local.length + entry.bytes.length
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0)
  chunks.push(...central)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(4, 0, true); endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true); endView.setUint16(20, 0, true)
  chunks.push(end)
  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}

const OFFLINE_STYLE = `*{box-sizing:border-box}body{margin:0;background:#070b17;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.shell{width:min(1200px,100vw);padding:12px}.bar{display:flex;gap:12px;align-items:center;padding:10px 14px;background:#111a31;border-radius:10px 10px 0 0}.bar b{font-size:20px}.bar span{padding:5px 10px;background:#263757;border-radius:7px}canvas{width:100%;height:auto;display:block;background:#111;image-rendering:pixelated;touch-action:none}.controls{display:flex;justify-content:space-between;gap:8px;padding:10px;background:#111a31}.controls button{font:700 16px system-ui;padding:10px 16px;border:0;border-radius:8px}.hint{opacity:.72;margin-left:auto}.overlay{position:fixed;inset:0;display:none;place-items:center;background:#050816d9;font-size:32px;font-weight:800}.overlay.show{display:grid}`

const OFFLINE_GAME = String.raw`(()=>{const spec=JSON.parse(document.getElementById('project-data').textContent);const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');c.imageSmoothingEnabled=false;const W=1152,H=648,G=555;let level=0,score=0,last=performance.now(),keys={},shots=[],enemies=[],items=[],fx=[],won=false;const imgs={};const active=(cat)=>spec.assets.find(a=>a.enabled&&a.category===cat&&(!a.levelIds.length||a.levelIds.includes(spec.levels[level].id)));const load=()=>Promise.all(spec.assets.filter(a=>a.url).map(a=>new Promise(r=>{const i=new Image;i.onload=()=>{imgs[a.id]=i;r()};i.onerror=r;i.src=a.url})));const reset=()=>{const l=spec.levels[level];player={x:55,y:G-64,vx:0,vy:0,w:54,h:64,hp:spec.hero.maxHealth,face:1,on:true,attack:0};const types=spec.assets.filter(a=>a.enabled&&['groundEnemy','airEnemy','waterEnemy'].includes(a.category)&&a.levelIds.includes(l.id));enemies=Array.from({length:l.enemyCount},(_,i)=>({x:260+i*130,y:G-54,w:52,h:54,hp:55+level*12,id:types[i%Math.max(1,types.length)]?.id,mob:types[i%Math.max(1,types.length)]?.motion?.mobility||'ground',p:i}));if(l.hasBoss){const b=active('boss');if(b)enemies.push({x:860,y:G-100,w:100,h:100,hp:260,id:b.id,mob:'boss',p:0})}items=Array.from({length:l.collectibleCount},(_,i)=>({x:210+i*140,y:G-90,t:false}));shots=[]};const rect=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;const sprite=(id,x,y,w,h,state=1,face=1)=>{const a=spec.assets.find(v=>v.id===id),im=imgs[id];if(!im){c.fillStyle='#ff5';c.fillRect(x,y,w,h);return}if(a?.animation){const col=Math.floor(performance.now()/110)%6,row=a.animation.states[state]??1;c.save();if(face<0){c.translate(x+w,y);c.scale(-1,1);x=0;y=0}else{c.translate(x,y);x=0;y=0}c.drawImage(im,col*im.width/6,row*im.height/5,im.width/6,im.height/5,x,y,w,h);c.restore()}else c.drawImage(im,x,y,w,h)};const shoot=()=>{if(performance.now()<player.attack)return;player.attack=performance.now()+330;shots.push({x:player.face>0?player.x+54:player.x-20,y:player.y+25,w:22,h:12,v:9*player.face,d:spec.weapon.rangedDamage})};const slash=()=>{if(performance.now()<player.attack)return;player.attack=performance.now()+260;const h={x:player.face>0?player.x+45:player.x-75,y:player.y,w:80,h:70};enemies.forEach(e=>{if(rect(h,e))e.hp-=spec.weapon.meleeDamage});fx.push({x:h.x,y:h.y,t:performance.now()+160})};addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=1;if(['k','f'].includes(e.key.toLowerCase()))shoot();if(e.key.toLowerCase()==='j')slash()});addEventListener('keyup',e=>keys[e.key.toLowerCase()]=0);document.querySelectorAll('[data-key]').forEach(b=>{const k=b.dataset.key;b.onpointerdown=e=>{e.preventDefault();keys[k]=1;if(k==='shoot')shoot();if(k==='slash')slash()};b.onpointerup=b.onpointerleave=()=>keys[k]=0});function loop(now){const dt=Math.min(2,(now-last)/16.67);last=now;const l=spec.levels[level],water=l.platformMode==='water';const left=keys.a||keys.arrowleft,right=keys.d||keys.arrowright,jump=keys.w||keys[' ']||keys.arrowup;player.vx=(right-left)*spec.hero.moveSpeed;if(player.vx)player.face=player.vx>0?1:-1;if(jump&&player.on){player.vy=-spec.hero.jumpPower;player.on=false}player.x=Math.max(0,Math.min(W-player.w,player.x+player.vx*dt));player.vy+=(water?.29:.82)*dt;player.y+=player.vy*dt;if(player.y+player.h>=G){player.y=G-player.h;player.vy=0;player.on=true}enemies.forEach((e,i)=>{const dir=Math.sign(player.x-e.x)||1;e.x+=dir*(e.mob==='water'?1:e.mob==='air'?2:1.35)*dt;if(e.mob==='air')e.y=320+Math.sin(now/520+i)*55;if(e.mob==='water')e.y=G-50+Math.sin(now/600+i)*18;if(rect(player,e)){player.hp-=.12*dt;if(player.hp<=0)reset()}});shots.forEach(s=>{s.x+=s.v*dt;const hit=enemies.find(e=>e.hp>0&&rect(s,e));if(hit){hit.hp-=s.d;s.x=-99}});shots=shots.filter(s=>s.x>-50&&s.x<W+50);enemies=enemies.filter(e=>e.hp>0);items.forEach(i=>{if(!i.t&&rect(player,{x:i.x,y:i.y,w:34,h:34})){i.t=true;score+=spec.collectible.value}});if(!enemies.length&&player.x>W-95){if(level<spec.levels.length-1){level++;reset()}else{won=true;document.querySelector('.overlay').classList.add('show')}}c.clearRect(0,0,W,H);const bg=active('levelBackground');if(bg&&imgs[bg.id])c.drawImage(imgs[bg.id],0,0,W,H);else{c.fillStyle='#17304c';c.fillRect(0,0,W,H)}c.fillStyle=water?'#087f9a88':'#36502e';c.fillRect(0,G,W,H-G);items.filter(i=>!i.t).forEach(i=>{const a=active('collectible');a?sprite(a.id,i.x,i.y,34,34):0});enemies.forEach(e=>sprite(e.id,e.x,e.y,e.w,e.h,Math.abs(player.x-e.x)<80?'attack':'move',Math.sign(player.x-e.x)));shots.forEach(s=>{const a=active('rangedProjectile');a?sprite(a.id,s.x,s.y,s.w,s.h):c.fillRect(s.x,s.y,s.w,s.h)});fx.filter(f=>f.t>now).forEach(f=>{c.strokeStyle='#8ff';c.lineWidth=8;c.beginPath();c.arc(f.x+35,f.y+30,30,-1,1);c.stroke()});fx=fx.filter(f=>f.t>now);const hero=active('hero');hero?sprite(hero.id,player.x,player.y,player.w,player.h,performance.now()<player.attack?'attack':Math.abs(player.vx)>.1?'move':'idle',player.face):0;c.fillStyle=enemies.length?'#677084':'#6fffc2';c.fillRect(W-68,G-90,48,90);document.querySelector('#level').textContent='Level '+(level+1)+'/'+spec.levels.length;document.querySelector('#score').textContent='Score '+score;requestAnimationFrame(loop)}load().then(()=>{reset();requestAnimationFrame(loop)})})();`

const OFFLINE_STYLE_V2 = `${OFFLINE_STYLE}.bar button{margin-left:auto;font:700 14px system-ui;padding:7px 12px;border:0;border-radius:7px;cursor:pointer}.paused-label{color:#8bdcff}`

const OFFLINE_GAME_V2 = String.raw`
(() => {
  const spec = JSON.parse(document.getElementById('project-data').textContent)
  const runtimeLevels = JSON.parse(document.getElementById('runtime-data').textContent).levels
  const canvas = document.querySelector('canvas'), c = canvas.getContext('2d'), pauseButton = document.querySelector('[data-pause]')
  c.imageSmoothingEnabled = false
  const W = 1152, H = 648, G = 555, images = {}, keys = {}
  let level = 0, score = 0, sim = 0, lastReal = performance.now(), paused = false, won = false
  let player, enemies = [], shots = [], items = [], effects = [], obstacles = []
  const active = (category) => spec.assets.find((asset) => asset.enabled && asset.category === category && (!asset.levelIds.length || asset.levelIds.includes(spec.levels[level].id)))
  const rect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const setAction = (actor, action, duration = 0) => { if (actor.action !== action) { actor.action = action; actor.actionStart = sim } actor.actionUntil = duration ? sim + duration : 0 }
  const animationFor = (asset) => {
    const raw = asset && asset.animation || {}
    if (raw.layoutVersion === 3 || raw.format === 'action-strips') return { actionStrips: true, clips: raw.clips || {} }
    const legacy = Number(raw.rows) === 5 || !raw.states || raw.states.jump == null
    if (legacy) return { columns: 6, rows: 5, fps: raw.fps || 8, states: { idle: 0, walk: 1, jump: 1, attack: 2, hit: 3, death: 4 } }
    const row = (value, fallback) => Math.max(0, Math.min(5, Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback))
    return { columns: 6, rows: 6, fps: raw.fps || 8, states: { idle: row(raw.states.idle, 0), walk: row(raw.states.walk, 1), jump: row(raw.states.jump, 2), attack: row(raw.states.attack, 3), hit: row(raw.states.hit, 4), death: row(raw.states.death, 5) } }
  }
  const sprite = (id, x, y, w, h, actor, face = 1) => {
    const asset = spec.assets.find((candidate) => candidate.id === id)
    if (asset && asset.animation) {
      const animation = animationFor(asset), requestedState = actor.action || 'idle', state = requestedState === 'attack' ? 'meleeAttack' : requestedState
      if (animation.actionStrips) {
        const clip = animation.clips[state] || animation.clips.idle || {}, image = images[id + ':clip:' + state] || images[id + ':clip:idle'] || images[id]
        if (!image) { c.fillStyle = actor.mobility === 'boss' ? '#c94c8f' : actor.mobility ? '#df7154' : '#5ba5df'; c.fillRect(x, y, w, h); return }
        const count = Math.max(1, Number(clip.frameCount) || 1), elapsed = Math.max(0, sim - (actor.actionStart || 0)), duration = Math.max(1, (actor.actionUntil || 0) - (actor.actionStart || 0))
        const oneShot = state === 'meleeAttack' || state === 'rangedAttack' || state === 'death'
        const frame = state === 'idle' || state === 'hit' ? 0 : state === 'jump' ? Math.min(count - 1, actor.vy < 0 ? 0 : 1) : oneShot ? Math.min(count - 1, Math.floor(elapsed / duration * count)) : Math.floor(elapsed / (1000 / (clip.fps || 5))) % count
        const cellW = image.width / count
        c.save(); if (face < 0) { c.translate(x + w, y); c.scale(-1, 1); x = 0; y = 0 } else { c.translate(x, y); x = 0; y = 0 }
        c.drawImage(image, frame * cellW, 0, cellW, image.height, x, y, w, h); c.restore(); return
      }
    }
    const image = images[id]
    if (!image) { c.fillStyle = actor.mobility === 'boss' ? '#c94c8f' : actor.mobility ? '#df7154' : '#5ba5df'; c.fillRect(x, y, w, h); return }
    if (!asset || !asset.animation) { c.drawImage(image, x, y, w, h); return }
    const animation = animationFor(asset), state = actor.action || 'idle', elapsed = Math.max(0, sim - (actor.actionStart || 0))
    const oneShot = state === 'attack' || state === 'hit' || state === 'death', duration = Math.max(1, (actor.actionUntil || 0) - (actor.actionStart || 0))
    const frame = oneShot ? Math.min(5, Math.floor(elapsed / duration * 6)) : Math.floor(elapsed / (1000 / animation.fps)) % 6
    const cellW = image.width / 6, cellH = image.height / animation.rows, row = animation.states[state] == null ? 0 : animation.states[state]
    c.save(); if (face < 0) { c.translate(x + w, y); c.scale(-1, 1); x = 0; y = 0 } else { c.translate(x, y); x = 0; y = 0 }
    c.drawImage(image, frame * cellW, row * cellH, cellW, cellH, x, y, w, h); c.restore()
  }
  const load = () => Promise.all(spec.assets.flatMap((asset) => {
    const sources = asset.url ? [[asset.id, asset.url]] : []
    if (asset.animation && asset.animation.clips) Object.entries(asset.animation.clips).forEach(([pose, clip]) => { if (clip && clip.url) sources.push([asset.id + ':clip:' + pose, clip.url]) })
    return sources.map(([key, url]) => new Promise((resolve) => { const image = new Image(); image.onload = () => { images[key] = image; resolve() }; image.onerror = resolve; image.src = url }))
  }))
  const reset = (retry = false) => {
    const current = spec.levels[level], layout = runtimeLevels[level]; sim = 0
    if (retry) { score = levelScore; storyState = storyEngine.begin(spec, storyState, current.id, true) }
    else levelScore = score
    player = { x: 55, y: G - 64, vx: 0, vy: 0, w: 54, h: 64, hp: spec.hero.maxHealth, face: 1, on: true, invulnerable: 0, meleeReady: 0, rangedReady: 0, action: 'idle', actionStart: 0, actionUntil: 0 }
    obstacles = (layout.obstacles || []).map((source, index) => { const w = Math.max(42, Math.min(80, source.width || 48)), h = Math.max(42, Math.min(80, source.height || 48)); return { x: Math.max(150, Math.min(W - 230 - w, source.x || 220 + index * 100)), y: G - h, w, h, type: source.type, id: active(source.type)?.id } })
    if (current.platformMode === 'air' && active('airPlatform')) obstacles.push(...Array.from({ length: 3 }, (_, index) => ({ x: 250 + index * 235, y: G - 115 - index % 2 * 65, w: 130, h: 32, type: 'airPlatform', id: active('airPlatform').id })))
    const types = spec.assets.filter((asset) => asset.enabled && ['groundEnemy', 'airEnemy', 'waterEnemy'].includes(asset.category) && (!asset.levelIds.length || asset.levelIds.includes(current.id)))
    const spawns = layout.enemySpawns || []
    enemies = spawns.map((spawn, index) => {
      const asset = spec.assets.find(candidate => candidate.id === spawn.kind) || types[index % Math.max(1, types.length)], mobility = asset && asset.motion && asset.motion.mobility || 'ground'
      const enemySpec = spec.enemies.find(enemy => asset && enemy.assetId === asset.id)
        || spec.enemies.find((enemy, enemyIndex) => asset && (enemy.category || ['groundEnemy', 'airEnemy', 'waterEnemy'][enemyIndex]) === asset.category)
        || spec.enemies[0]
      const y = mobility === 'air' ? G - 190 - index % 2 * 42 : mobility === 'water' ? G - 58 : G - 54
      return { uid: spawn.id, x: spawn.x, patrolMin: Math.max(170, spawn.x - 100), patrolMax: Math.min(W - 120, spawn.x + 100), y, baseY: y, w: 52, h: 54, hp: enemySpec.health + level * 8, damage: enemySpec.damage + level * 2, behavior: enemySpec.behavior, id: asset && asset.id, mobility, face: index % 2 ? -1 : 1, phase: index * 1.15, vy: 0, on: mobility === 'ground', lastAttack: 0, nextJump: 1500 + index * 350, removeAt: 0, action: 'idle', actionStart: 0, actionUntil: 0 }
    })
    if (layout.bossSpawn) { const boss = spec.assets.find(asset => asset.id === layout.bossSpawn.kind); enemies.push({ uid: layout.bossSpawn.id, x: layout.bossSpawn.x, patrolMin: Math.max(600, layout.bossSpawn.x - 180), patrolMax: Math.min(W - 120, layout.bossSpawn.x + 180), y: G - 94, baseY: G - 94, w: 94, h: 94, hp: spec.boss.health, id: boss?.id || layout.bossSpawn.kind, mobility: 'boss', face: -1, phase: 0, vy: 0, on: true, lastAttack: 0, nextJump: 1800, removeAt: 0, action: 'idle', actionStart: 0, actionUntil: 0 }) }
    items = (layout.collectibleSpawns || []).map(spawn => ({ uid: spawn.id, x: spawn.x, y: Math.min(G - 42, spawn.y + (G - 438)), w: 34, h: 34, taken: false })); shots = []; effects = []
  }
  let storyState = storyEngine.fresh(spec), unread = [], levelScore = 0, storyLog = false, bootSave = null
  const saveKey = 'pixel-world-offline-campaign:' + storyEngine.key(spec)
  try { const raw = JSON.parse(localStorage.getItem(saveKey) || 'null'); if (raw && raw.key === storyEngine.key(spec) && spec.levels[raw.level] && raw.player && Array.isArray(raw.enemies) && Array.isArray(raw.items)) bootSave = raw } catch {}
  const storyBox = document.createElement('section'); storyBox.className = 'offline-story'; storyBox.setAttribute('role','dialog'); storyBox.setAttribute('aria-label','冒险剧情')
  const storyTitle = document.createElement('h2'), storyText = document.createElement('div'), storyFooter = document.createElement('footer'), nextStory = document.createElement('button'), skipStory = document.createElement('button')
  nextStory.textContent = '继续冒险'; skipStory.textContent = '跳过剧情'; storyText.className = 'offline-story-text'; storyFooter.append(skipStory,nextStory); storyBox.append(storyTitle,storyText,storyFooter); document.body.append(storyBox)
  const objectivesBox = document.createElement('section'); objectivesBox.className = 'offline-objectives'; objectivesBox.setAttribute('aria-label','当前关卡任务'); document.querySelector('.shell').append(objectivesBox)
  const logButton = document.createElement('button'), interactButton = document.createElement('button'), restartButton = document.createElement('button');logButton.textContent='剧情记录';interactButton.textContent='交互 E';restartButton.textContent='重新开始';document.querySelector('.bar').append(logButton,interactButton,restartButton)
  const blocked = () => unread.length > 0 || storyLog
  const clearKeys = () => Object.keys(keys).forEach(k => keys[k] = false)
  const renderStory = () => {
    storyBox.style.display = blocked() ? 'flex' : 'none'; storyTitle.textContent = storyLog ? '剧情记录' : unread[0]?.title || ''
    storyText.replaceChildren()
    ;(storyLog ? storyState.history : unread.slice(0,1)).forEach(entry => { const article=document.createElement('article'),title=document.createElement('h3'),p=document.createElement('p');title.textContent=entry.title;p.textContent=entry.text;if(storyLog)article.append(title);article.append(p);storyText.append(article) })
    skipStory.style.display=storyLog?'none':'';nextStory.textContent=storyLog?'关闭记录':'继续冒险'
    objectivesBox.replaceChildren();storyEngine.objectives(spec,storyState).forEach(o=>{const row=document.createElement('div');row.dataset.objective=o.id;row.dataset.complete=String(o.complete);row.textContent=(o.complete?'✓ ':o.available?'○ ':'· ')+o.description+(o.count>1?' '+o.current+'/'+o.count:'');objectivesBox.append(row)})
  }
  const commitStory = next => { if(next===storyState)return;const added=next.history.filter(e=>!storyState.history.some(old=>old.id===e.id));storyState=next;unread.push(...added);if(added.length)clearKeys();renderStory() }
  const emitStory = (kind,target,id) => commitStory(storyEngine.emit(spec,storyState,{kind,target,id,levelId:spec.levels[level].id}))
  const beginStory = () => commitStory(storyEngine.begin(spec,storyState,spec.levels[level].id))
  const points = () => spec.narrative?.chapters.find(c=>c.levelId===spec.levels[level].id)?.points || []
  const pointX = point => 120 + (W - 288) * point.position
  const interactStory = () => { if(blocked()||paused||won)return;const available=storyEngine.objectives(spec,storyState);const point=points().filter(p=>p.kind==='interact'&&available.some(task=>task.target===p.id&&task.available&&!task.complete)&&Math.abs(player.x-pointX(p))<95).sort((a,b)=>Math.abs(player.x-pointX(a))-Math.abs(player.x-pointX(b)))[0];if(point)emitStory('interact',point.id,point.id) }
  nextStory.onclick=()=>{if(storyLog)storyLog=false;else unread.shift();clearKeys();renderStory()};skipStory.onclick=()=>{unread=[];clearKeys();renderStory()};logButton.onclick=()=>{storyLog=true;clearKeys();renderStory()};interactButton.onclick=interactStory
  restartButton.onclick=()=>{localStorage.removeItem(saveKey);level=0;score=0;unread=[];storyLog=false;won=false;storyState=storyEngine.fresh(spec);document.querySelector('.overlay').classList.remove('show');reset();beginStory()}
  const completedRestart=document.createElement('button'),completedLog=document.createElement('button'),completedActions=document.createElement('div');completedRestart.textContent='重新开始冒险';completedLog.textContent='回看故事';completedRestart.onclick=()=>restartButton.onclick();completedLog.onclick=()=>logButton.onclick();completedActions.className='offline-completed-actions';completedActions.append(completedRestart,completedLog);document.querySelector('.overlay').append(completedActions)
  const saveStory = () => { if(!player||player.hp<=0)return;try{localStorage.setItem(saveKey,JSON.stringify({key:storyEngine.key(spec),level,levelScore,score,sim,player,enemies,items,story:storyState,unread,won}))}catch{} }
  setInterval(saveStory,750);addEventListener('pagehide',saveStory)
  const bossReady = () => !storyEngine.objectives(spec,storyState).some(task=>task.kind==='boss'&&!task.available)
  const hurtEnemy = (enemy, damage) => { if (enemy.hp <= 0 || enemy.mobility === 'boss' && !bossReady()) return; enemy.hp = Math.max(0, enemy.hp - damage); if (!enemy.hp) { setAction(enemy, 'death', 720); enemy.removeAt = sim + 720; score += enemy.mobility === 'boss' ? 1000 : 150; if(enemy.mobility==='boss')emitStory('boss-approach','boss','approach');emitStory(enemy.mobility==='boss'?'boss':'defeat',enemy.mobility==='boss'?'boss':'enemies',enemy.uid) } else setAction(enemy, 'hit', 260) }
  const hurtPlayer = (damage) => { if (player.hp <= 0 || sim < player.invulnerable) return; player.hp = Math.max(0, player.hp - damage); player.invulnerable = sim + 850; setAction(player, player.hp ? 'hit' : 'death', player.hp ? 260 : 720) }
  const shoot = () => { if (paused || won || blocked() || player.hp <= 0 || sim < player.rangedReady || player.action === 'hit') return; player.rangedReady = sim + Math.max(240, spec.weapon.cooldownMs * 1.2); setAction(player, 'rangedAttack', 320); shots.push({ x: player.face > 0 ? player.x + player.w : player.x - 24, y: player.y + 25, w: 24, h: 14, vx: spec.weapon.projectileSpeed * player.face, damage: spec.weapon.rangedDamage, hostile: false }) }
  const slash = () => { if (paused || won || blocked() || player.hp <= 0 || sim < player.meleeReady || player.action === 'hit') return; player.meleeReady = sim + spec.weapon.cooldownMs; setAction(player, 'meleeAttack', 320); const hitbox = { x: player.face > 0 ? player.x + 44 : player.x - 76, y: player.y, w: 82, h: 70 }; enemies.forEach((enemy) => { if (enemy.hp > 0 && rect(hitbox, enemy)) hurtEnemy(enemy, spec.weapon.meleeDamage) }); effects.push({ x: hitbox.x, y: hitbox.y, expires: sim + 180 }) }
  const togglePause = () => { if (won) return; paused = !paused; Object.keys(keys).forEach((key) => { keys[key] = false }); pauseButton.textContent = paused ? 'Resume' : 'Pause'; pauseButton.classList.toggle('paused-label', paused) }
  const pauseWhenAway = () => { if (!paused && !won) { togglePause(); saveStory() } }
  document.addEventListener?.('visibilitychange', () => { if (document.hidden) pauseWhenAway() })
  addEventListener('blur', pauseWhenAway)
  addEventListener('keydown', (event) => { const key = event.key.toLowerCase(); if (['arrowleft', 'arrowright', 'arrowup', ' ', 'escape'].includes(key)) event.preventDefault(); if(blocked()){if(key==='escape')skipStory.onclick();return} if (key === 'escape') { togglePause(); return } if (paused || won || blocked()) return; if(key==='e'){interactStory();return} keys[key] = true; if (key === 'j') slash(); if (key === 'k' || key === 'f') shoot() })
  addEventListener('keyup', (event) => { keys[event.key.toLowerCase()] = false })
  document.querySelectorAll('[data-key]').forEach((button) => { const key = button.dataset.key; button.onpointerdown = (event) => { event.preventDefault(); if (paused || won || blocked()) return; if(key==='e'){interactStory();return} keys[key] = true; if (key === 'shoot') shoot(); if (key === 'slash') slash() }; button.onpointerup = button.onpointerleave = () => { keys[key] = false } })
  pauseButton.onclick = togglePause
  const update = (delta) => {
    const current = spec.levels[level]
    if (player.hp <= 0) { player.vx = 0; if (sim >= player.actionUntil) { reset(true); unread=storyState.history.filter(e=>e.id===spec.levels[level].id+':arrival');renderStory() } }
    else {
      const locked = (player.action === 'meleeAttack' || player.action === 'rangedAttack' || player.action === 'hit') && sim < player.actionUntil
      const left = keys.a || keys.arrowleft, right = keys.d || keys.arrowright, jump = keys.w || keys[' '] || keys.arrowup
      player.vx = locked ? 0 : ((right ? 1 : 0) - (left ? 1 : 0)) * spec.hero.moveSpeed; if (player.vx) player.face = player.vx > 0 ? 1 : -1
      if (!locked && jump && player.on) { player.vy = -spec.hero.jumpPower; player.on = false }
      let nextX = Math.max(0, Math.min(W - player.w, player.x + player.vx * delta))
      const horizontalHit = obstacles.find(obstacle => rect({ ...player, x: nextX }, obstacle))
      if (horizontalHit?.type === 'deathObstacle') hurtPlayer(player.hp)
      else if (horizontalHit) nextX = player.x
      player.x = nextX
      player.vy += (current.platformMode === 'water' ? .29 : current.platformMode === 'air' ? .56 : .82) * delta
      let nextY = player.y + player.vy * delta
      player.on = false
      if (nextY + player.h >= G) { nextY = G - player.h; player.vy = 0; player.on = true }
      else if (player.vy >= 0) {
        const previousBottom = player.y + player.h
        for (const obstacle of obstacles) {
          if (player.x + player.w <= obstacle.x || player.x >= obstacle.x + obstacle.w || previousBottom > obstacle.y + 7 || nextY + player.h < obstacle.y) continue
          if (obstacle.type === 'deathObstacle') hurtPlayer(player.hp)
          else if (obstacle.type === 'bounceObstacle') { nextY = obstacle.y - player.h; player.vy = -spec.hero.jumpPower * 1.35 }
          else { nextY = obstacle.y - player.h; player.vy = 0; player.on = true }
          break
        }
      }
      player.y = nextY
      if (!locked || sim >= player.actionUntil) setAction(player, !player.on ? 'jump' : Math.abs(player.vx) > .1 ? 'walk' : 'idle')
    }
    enemies.forEach((enemy) => {
      if (enemy.hp <= 0) return
      if (enemy.mobility === 'boss' && !bossReady()) return
      const distance = player.x - enemy.x; enemy.face = distance >= 0 ? 1 : -1
      const locked = (enemy.action === 'meleeAttack' || enemy.action === 'rangedAttack' || enemy.action === 'hit') && sim < enemy.actionUntil, resting = (sim + enemy.phase * 700) % (enemy.mobility === 'boss' ? 3200 : 2600) < 480
      if (!locked && !resting) enemy.x = enemyCombatRules.moveWithinPatrol(enemy.x, enemy.face, (enemy.mobility === 'air' ? 2 : enemy.mobility === 'water' ? 1 : 1.35) * delta, enemy.patrolMin ?? 170, enemy.patrolMax ?? W - 120)
      if (!locked) {
        if (enemy.mobility === 'air') { const dive = (sim + enemy.phase * 900) % 3200 > 2380; enemy.y = enemy.baseY + Math.sin(sim / 520 + enemy.phase) * 34 + (dive ? 58 : 0); setAction(enemy, dive ? 'jump' : resting ? 'idle' : 'walk') }
        else if (enemy.mobility === 'water') { const rise = (sim + enemy.phase * 1000) % 3400 > 2550; enemy.y = enemy.baseY + Math.sin(sim / 630 + enemy.phase) * 20 + (rise ? -28 : 0); setAction(enemy, rise ? 'jump' : resting ? 'idle' : 'walk') }
        else { if (enemy.on && sim >= enemy.nextJump && Math.abs(distance) < 340) { enemy.vy = enemy.mobility === 'boss' ? -10.5 : -7.5; enemy.on = false; enemy.nextJump = sim + (enemy.mobility === 'boss' ? 2200 : 3000) } if (!enemy.on) { enemy.vy += .72 * delta; enemy.y += enemy.vy * delta; if (enemy.y + enemy.h >= G) { enemy.y = G - enemy.h; enemy.vy = 0; enemy.on = true } } setAction(enemy, !enemy.on ? 'jump' : resting ? 'idle' : 'walk') }
      }
      const boss = enemy.mobility === 'boss', ranged = enemyCombatRules.restoredRanged(enemy, enemy.behavior || spec.enemies[0].behavior)
      const verticalOverlap = player.y < enemy.y + enemy.h && player.y + player.h > enemy.y
      const attack = enemyCombatRules.attackKind(ranged, boss, distance, enemy.w, sim - enemy.lastAttack, locked, verticalOverlap)
      const damage = boss ? spec.boss.damage : enemy.damage || spec.enemies[0].damage + level * 2
      if (attack === 'ranged') { enemy.lastAttack = sim; setAction(enemy, 'rangedAttack', 320); shots.push({ x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h * .4, w: boss ? 28 : 20, h: boss ? 22 : 16, vx: enemy.face * (boss ? 7 : 5), damage: enemyCombatRules.projectileDamage(damage, boss), hostile: true }) }
      else if (attack === 'melee') { enemy.lastAttack = sim; setAction(enemy, 'meleeAttack', 320); hurtPlayer(damage) }
    })
    shots.forEach((shot) => { shot.x += shot.vx * delta; if (shot.hostile) { if (rect(shot, player)) { hurtPlayer(shot.damage); shot.x = -9999 } } else { const target = enemies.find((enemy) => enemy.hp > 0 && rect(shot, enemy)); if (target) { hurtEnemy(target, shot.damage); shot.x = -9999 } } if (obstacles.some(obstacle => rect(shot, obstacle))) shot.x = -9999 })
    shots = shots.filter((shot) => shot.x > -100 && shot.x < W + 100); enemies = enemies.filter((enemy) => enemy.hp > 0 || sim < enemy.removeAt); effects = effects.filter((effect) => effect.expires > sim)
    items.forEach((item) => { if (!item.taken && rect(player, item)) { item.taken = true; score += spec.collectible.value;emitStory('collect','collectible',item.uid) } })
    points().filter(p=>p.kind==='reach'&&Math.abs(player.x-pointX(p))<70).forEach(p=>emitStory('reach',p.id,p.id))
    const liveBoss=enemies.find(e=>e.mobility==='boss'&&e.hp>0);if(liveBoss&&Math.abs(player.x-liveBoss.x)<360)emitStory('boss-approach','boss','approach')
    if (player.hp > 0 && !blocked() && storyEngine.exitReady(spec,storyState,enemies.length) && player.x > W - 95) {
      emitStory('reach','exit','exit');commitStory(storyEngine.finish(spec,storyState));
      if(level===spec.levels.length-1 && (!spec.narrative || storyState.endingSeen)){won=true;document.querySelector('.overlay').classList.add('show')}
      else if(level < spec.levels.length-1 && (!spec.narrative||storyState.completedLevels.includes(spec.levels[level].id))){pendingLevel=true}
    }
  }
  const render = () => {
    const current = spec.levels[level], background = active('levelBackground'); c.clearRect(0, 0, W, H)
    if (background && images[background.id]) c.drawImage(images[background.id], 0, 0, W, H); else { c.fillStyle = '#17304c'; c.fillRect(0, 0, W, H) }
    c.fillStyle = current.platformMode === 'water' ? '#087f9a88' : '#36502e'; c.fillRect(0, G, W, H - G)
    obstacles.forEach(obstacle => { if (obstacle.id) sprite(obstacle.id, obstacle.x, obstacle.y, obstacle.w, obstacle.h, { action: 'idle', actionStart: 0, actionUntil: 0 }); else { c.fillStyle = obstacle.type === 'deathObstacle' ? '#cf5362' : obstacle.type === 'bounceObstacle' ? '#6bdcc5' : '#ad8157'; c.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h) } })
    const collectible = active('collectible'); items.filter((item) => !item.taken).forEach((item) => { if (collectible) sprite(collectible.id, item.x, item.y, item.w, item.h, { action: 'idle', actionStart: 0, actionUntil: 0 }); else { c.fillStyle = '#ffd84d'; c.fillRect(item.x, item.y, item.w, item.h) } })
    enemies.forEach((enemy) => sprite(enemy.id, enemy.x, enemy.y, enemy.w, enemy.h, enemy, enemy.face))
    const projectile = active('rangedProjectile'); shots.forEach((shot) => { if (projectile) sprite(projectile.id, shot.x, shot.y, shot.w, shot.h, { action: 'idle', actionStart: 0, actionUntil: 0 }, shot.vx < 0 ? -1 : 1); else { c.fillStyle = shot.hostile ? '#ff4567' : '#75e9ff'; c.fillRect(shot.x, shot.y, shot.w, shot.h) } })
    effects.forEach((effect) => { c.strokeStyle = '#8ff'; c.lineWidth = 8; c.beginPath(); c.arc(effect.x + 35, effect.y + 30, 30, -1, 1); c.stroke() })
    const hero = active('hero'); sprite(hero?.id || 'hero', player.x, player.y, player.w, player.h, player, player.face)
    const heldWeapon = player.action === 'rangedAttack' ? active('rangedWeapon') : player.action === 'meleeAttack' ? active('meleeWeapon') : null
    if (heldWeapon && images[heldWeapon.id]) { c.save(); if (player.face < 0) { c.translate(player.x + player.w, player.y); c.scale(-1, 1); c.drawImage(images[heldWeapon.id], -16, 22, 52, 26) } else c.drawImage(images[heldWeapon.id], player.x + 34, player.y + 22, 52, 26); c.restore() }
    const availablePoints = storyEngine.objectives(spec,storyState);points().filter(p=>availablePoints.some(task=>task.target===p.id&&(task.available||task.complete))).forEach(p=>{c.fillStyle='#ffe292';c.fillRect(pointX(p),G-60,26,55);c.fillStyle='#fff';c.font='14px sans-serif';c.fillText(p.name+' · E',pointX(p)-30,G-72)});
    c.fillStyle = storyEngine.exitReady(spec,storyState,enemies.length) ? '#6fffc2' : '#677084'; c.fillRect(W - 68, G - 90, 48, 90)
    if (paused) { c.fillStyle = '#030610aa'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.font = '700 54px system-ui'; c.textAlign = 'center'; c.fillText('Paused', W / 2, H / 2) }
    document.querySelector('#level').textContent = 'Level ' + (level + 1) + '/' + spec.levels.length; document.querySelector('#score').textContent = 'Score ' + score
  }
  let pendingLevel=false
  const loop = (realNow) => { const elapsed = Math.min(34, Math.max(0, realNow - lastReal)); lastReal = realNow; if(pendingLevel&&!blocked()){pendingLevel=false;level++;reset();beginStory()} if (!paused && !won && !blocked()) { sim += elapsed; update(Math.min(2, elapsed / 16.67)) } render(); requestAnimationFrame(loop) }
  // Canvas actors have no DOM nodes. Return copies for read-only playtest and
  // accessibility tooling; callers cannot mutate the running actors.
  globalThis.__pixelWorldReadOnlySnapshot = () => player ? JSON.parse(JSON.stringify({ level, levelScore, score, sim, player, enemies, items, story: storyState, won })) : null
  load().then(() => { if(bootSave){level=bootSave.level;score=bootSave.score;reset();player=bootSave.player;enemies=bootSave.enemies;items=bootSave.items;sim=bootSave.sim;levelScore=bootSave.levelScore;storyState=storyEngine.restore(spec,bootSave.story);unread=bootSave.unread||[];won=Boolean(bootSave.won);if(won)document.querySelector('.overlay').classList.add('show');renderStory()}else{reset();beginStory()} requestAnimationFrame(loop) })
})()
`

export function offlineGameRuntimeSource(): string {
  return offlineNarrativeRuntimeSource() + '\n' + offlineEnemyCombatSource() + '\n' + OFFLINE_GAME_V2
}

export async function exportGameZip(spec: GameSpec): Promise<void> {
  const missing = spec.assets.flatMap((asset) => {
    if (!asset.enabled || (asset.kind !== 'image' && asset.kind !== 'spriteSheet')) return []
    if (asset.kind !== 'spriteSheet') return asset.url ? [] : [asset.title]
    const animation = normalizeAnimationSpec(asset.animation)
    if (animation.layoutVersion !== 3 || !animation.clips) return asset.url ? [] : [asset.title]
    return animationClipPoses(asset).filter((pose) => !animation.clips?.[pose]?.url || animation.clips[pose]?.status !== 'success').map((pose) => `${asset.title} · ${pose}`)
  })
  if (missing.length) throw new ExportValidationError(missing)
  const exported: GameSpec = JSON.parse(JSON.stringify(spec)) as GameSpec
  const entries: Array<{ name: string; bytes: Uint8Array }> = []
  for (const asset of exported.assets) {
    const sourceAsset = spec.assets.find((item) => item.id === asset.id)
    if (sourceAsset?.url) {
      const downloaded = await readAsset(sourceAsset.url)
      const filename = `assets/${safeName(asset.id)}.${extensionFor(downloaded.contentType, sourceAsset.url)}`
      entries.push({ name: filename, bytes: downloaded.bytes })
      asset.url = filename
    }
    const sourceAnimation = sourceAsset?.kind === 'spriteSheet' ? normalizeAnimationSpec(sourceAsset.animation) : undefined
    const exportedAnimation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : undefined
    if (sourceAnimation?.layoutVersion === 3 && sourceAnimation.clips && exportedAnimation?.layoutVersion === 3 && exportedAnimation.clips) {
      for (const pose of animationClipPoses(sourceAsset!)) {
        const source = sourceAnimation.clips[pose]?.url
        if (!source) continue
        const downloaded = await readAsset(source)
        const filename = `assets/${safeName(asset.id)}-${safeName(pose)}.${extensionFor(downloaded.contentType, source)}`
        entries.push({ name: filename, bytes: downloaded.bytes })
        exportedAnimation.clips[pose] = { ...exportedAnimation.clips[pose]!, url: filename }
      }
      asset.animation = exportedAnimation
      asset.url = exportedAnimation.clips.idle?.url
    }
  }
  const json = JSON.stringify(exported, null, 2)
  const safeJson = json.replace(/<\//g, '<\\/')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${spec.title.replace(/[<>&"]/g, '')}</title><link rel="stylesheet" href="styles.css"></head><body><main class="shell"><div class="bar"><b>${spec.title.replace(/[<>&"]/g, '')}</b><span id="level"></span><span id="score"></span><small class="hint">A/D 移动 · 空格跳跃 · J 近战 · K 远程 · E 交互 · ESC 暂停</small><button data-pause>Pause</button></div><canvas width="1152" height="648"></canvas><div class="controls"><div><button data-key="a">←</button><button data-key="d">→</button><button data-key=" ">Jump</button></div><div><button data-key="slash">Slash</button><button data-key="shoot">Shoot</button></div></div></main><div class="overlay">冒险完成！</div><script type="application/json" id="project-data">${safeJson}</script><script src="game.js"></script></body></html>`
  const runtimeJson = JSON.stringify({ levels: buildGameDataFromSpec(exported).data?.levels || [] }).replace(/<\//g, '<\\/')
  const htmlWithRuntime = html.replace('<script src="game.js"></script>', `<script type="application/json" id="runtime-data">${runtimeJson}</script><script src="game.js"></script>`)
  entries.push(
    { name: 'index.html', bytes: encoder.encode(htmlWithRuntime) },
    { name: 'styles.css', bytes: encoder.encode(OFFLINE_STYLE_V2 + '\n' + OFFLINE_STORY_STYLE + '\n.offline-completed-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:18px}.offline-completed-actions button{padding:10px 15px;border:1px solid #acd0b9;border-radius:8px;background:#398a70;color:#fffdf3;font:inherit;cursor:pointer}') },
    { name: 'game.js', bytes: encoder.encode(offlineGameRuntimeSource()) },
    { name: 'project.json', bytes: encoder.encode(json) },
  )
  const blob = makeZip(entries)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName(spec.title)}.zip`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const OFFLINE_STORY_STYLE = `.offline-story{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(700px,calc(100vw - 24px));max-height:min(76vh,640px);box-sizing:border-box;z-index:80;background:#fffdf3;color:#28594e;border:2px solid #9dbfae;border-radius:15px;padding:24px;flex-direction:column;box-shadow:0 0 0 100vmax #102c22aa}.offline-story h2{margin:0 0 12px}.offline-story-text{overflow:auto;min-height:0;flex:0 1 auto;line-height:1.85;white-space:pre-wrap}.offline-story footer{display:flex;justify-content:flex-end;gap:10px;padding-top:16px}.offline-story button,.bar button{cursor:pointer;padding:8px 12px;background:#398a70;color:white;border:1px solid #8fbaa7;border-radius:8px}.offline-objectives{padding:12px 18px;background:#f0f7ed;color:#28594e;font-size:13px;line-height:1.7}.offline-objectives [data-complete=true]{color:#608674}`
