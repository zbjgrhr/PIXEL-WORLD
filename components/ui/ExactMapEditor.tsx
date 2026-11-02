'use client'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Collapse, Input, InputNumber, Select, Space } from 'antd'
import type { AuthoredLevelMap, GameSpec, MapRect, MapMechanism } from '@/types'
import { authoredMapRules } from '@/lib/authored-map'
import { useUiLocale } from './LanguageSwitcher'
import GameMakerMapImport from './GameMakerMapImport'

function seedMap(level: GameSpec['levels'][number]): AuthoredLevelMap {
  const width = Math.max(1600, level.enemyCount * 100 + 800, level.collectibleCount * 80 + 400)
  return { version: 1, width, height: 720, groundY: 550, player: { x: 60, y: 486, width: 54, height: 64 }, exit: { x: width - 110, y: 454, width: 64, height: 96 },
    obstacles: [], enemies: Array.from({ length: level.enemyCount }, (_, i) => ({ id: `enemy-${i + 1}`, kind: 'groundEnemy', x: 350 + i * 100, y: 496, width: 52, height: 54 })),
    collectibles: Array.from({ length: level.collectibleCount }, (_, i) => ({ id: `item-${i + 1}`, kind: 'collectible', x: 220 + i * 80, y: 420, width: 34, height: 34 })),
    boss: level.hasBoss ? { id: 'boss-1', kind: 'boss', x: width - 350, y: 456, width: 94, height: 94 } : undefined }
}
export default function ExactMapEditor({ spec, onChange, disabled }: { spec: GameSpec; onChange: (next: GameSpec) => void; disabled: boolean }) {
  const en = useUiLocale() === 'en'
  const [index, setIndex] = useState(0)
  const level = spec.levels[Math.min(index, spec.levels.length - 1)]
  const [draft, setDraft] = useState<AuthoredLevelMap>(() => level.map || seedMap(level))
  const [json, setJson] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState('player'), [snap, setSnap] = useState(8)
  const [addKind, setAddKind] = useState('platform')
  const drag = useRef<{ key: string; x: number; y: number; base: MapRect } | null>(null)
  const fileGeneration = useRef(0)
  useEffect(() => { fileGeneration.current++; drag.current = null; const next = level.map || seedMap(level); setDraft(next); setJson(JSON.stringify(next, null, 2)); setError(''); setNotice(''); setSelected('player') }, [level.id, level.map, level.enemyCount, level.collectibleCount, level.hasBoss])
  const update = (next: AuthoredLevelMap) => { fileGeneration.current++; setDraft(next); setJson(JSON.stringify(next, null, 2)); setError(''); setNotice('') }
  const objects = [{ key: 'player', value: draft.player, color: '#398a70' }, { key: 'exit', value: draft.exit, color: '#a3892c' },
    ...(draft.checkpoints || []).map(o => ({ key: 'checkpoints:' + o.id, value: o, color: '#399f61' })),
    ...(draft.mechanisms || []).map(o => ({ key: 'mechanisms:' + o.id, value: o, color: o.kind === 'movingPlatform' ? '#608f95' : o.kind === 'freeze' ? '#71bad0' : o.kind === 'reverse' ? '#9970af' : '#c15359' })),
    ...draft.obstacles.map(o => ({ key: 'obstacles:' + o.id, value: o, color: o.type === 'deathObstacle' ? '#c15359' : o.type === 'bounceObstacle' ? '#6588bc' : '#8d765d' })),
    ...draft.enemies.map(o => ({ key: 'enemies:' + o.id, value: o, color: '#bc7254' })), ...draft.collectibles.map(o => ({ key: 'collectibles:' + o.id, value: o, color: '#e5c14e' })),
    ...(draft.boss ? [{ key: 'boss', value: draft.boss, color: '#8c486c' }] : [])]
  const current = objects.find(o => o.key === selected)
  const edit = (key: string, patch: Partial<MapRect>) => {
    if (disabled) return
    if (key === 'player' || key === 'exit') update({ ...draft, [key]: { ...draft[key], ...patch } })
    else if (key === 'boss' && draft.boss) update({ ...draft, boss: { ...draft.boss, ...patch } })
    else { const [group, id] = key.split(':') as ['obstacles' | 'enemies' | 'collectibles' | 'mechanisms' | 'checkpoints', string]; update({ ...draft, [group]: (draft[group] || []).map(o => o.id === id ? { ...o, ...patch } : o) }) }
  }
  const apply = () => {
    try { const map = authoredMapRules.validate(draft); onChange({ ...spec, levels: spec.levels.map((l, i) => i === Math.min(index, spec.levels.length - 1) ? { ...l, map, enemyCount: map.enemies.length, collectibleCount: map.collectibles.length, hasBoss: !!map.boss } : l) }); setNotice(en ? 'Map applied. Review any affected story objectives and approve again.' : '地图已应用。请核对受影响的剧情任务，并重新审核批准。'); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid map') }
  }
  const load = (text: string) => { try { update(authoredMapRules.validate(JSON.parse(text))); setNotice(en ? 'Loaded into editor; apply to save.' : '已加载到编辑器；点击应用后才会保存到作品。') } catch (e) { setError(e instanceof Error ? e.message : 'Invalid map JSON') } }
  return <div data-no-ui-translation><Collapse size="small" items={[{ key: 'map', label: en ? 'Exact level map · visual editor & JSON' : '精确关卡地图 · 可视编辑与JSON', children: <Space direction="vertical" style={{ width: '100%' }}>
    <p>{en ? 'Coordinates are world pixels, with the origin at the top left. Authored maps bypass automatic layout. Drag a rectangle or edit its dimensions; apply after checking. Moving platforms carry and push; blocked movement crushes. Zones trigger on entry and require leaving to rearm. Timers pause with gameplay; retry resets mechanisms. Checkpoints keep the last touched respawn position. Retry restores full health and resets this level’s score, tasks, enemies, collectibles and mechanisms.' : '坐标以世界像素计，左上角为原点。精确地图绕过自动排布。可拖动矩形或填写尺寸，检查后再应用。移动平台可承载、推挤，挤压受阻会死亡。状态区在进入时触发，离开后才可重新触发；暂停停止计时，重试重置机关。存档点保留最近触碰的复活位置；重试恢复满血，并重置本关分数、任务、敌人、收集品及机关。'}</p>
    <GameMakerMapImport player={draft.player} exit={draft.exit} disabled={disabled} onLoad={map=>{update(map);setNotice(en?'Converted into editor; apply and review to save.':'已转换到编辑器，请应用并重新审核后保存。')}} />
    <Select aria-label={en ? 'Map level' : '编辑关卡地图'} disabled={disabled} value={Math.min(index, spec.levels.length - 1)} onChange={setIndex} options={spec.levels.map((l, i) => ({ value: i, label: l.name }))} style={{ width: '100%' }} />
    <p>{level.map ? en ? 'Using an authored map' : '当前使用精确地图' : en ? 'Using automatic layout; preview below is not applied yet' : '当前使用自动布局；下方预览尚未应用'}</p>
    <Space wrap>{(['width','height'] as const).map(k => <label key={k}>{k === 'width' ? en ? 'World width' : '世界宽度' : en ? 'World height' : '世界高度'} <InputNumber aria-label={k === 'width' ? 'Map width' : 'Map height'} disabled={disabled} min={k === 'width' ? 320 : 240} max={32768} value={draft[k]} onChange={v => { if (v !== null) update({ ...draft, [k]: v }) }} /></label>)}</Space>
    <Space wrap><label>{en ? 'Ground Y (empty: pits allowed)' : '连续地面Y（留空可做深坑）'} <InputNumber aria-label="Ground Y" disabled={disabled} min={0} max={draft.height} value={draft.groundY} onChange={v => update({ ...draft, groundY: v })} /></label><label>{en ? 'Snap grid' : '对齐网格'} <InputNumber aria-label="Map snap grid" min={1} max={128} value={snap} onChange={v => setSnap(v || 1)} /></label></Space>
    <svg role="img" aria-label={en ? 'Editable world map' : '可编辑世界地图'} viewBox={`0 0 ${draft.width} ${draft.height}`} preserveAspectRatio="none" style={{ width: '100%', height: 260, background: '#edf4e7', border: '1px solid #aac6b4', touchAction: 'none' }}
      onPointerMove={e => { const d = drag.current; if (!d || disabled) return; const bounds = e.currentTarget.getBoundingClientRect(); edit(d.key, { x: Math.max(0, Math.min(draft.width - d.base.width, Math.round((d.base.x + (e.clientX - d.x) / bounds.width * draft.width) / snap) * snap)), y: Math.max(0, Math.min(draft.height - d.base.height, Math.round((d.base.y + (e.clientY - d.y) / bounds.height * draft.height) / snap) * snap)) }) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      {draft.groundY !== null && <rect x={0} y={draft.groundY} width={draft.width} height={Math.max(0, draft.height - draft.groundY)} fill="#b3c49a" />}
      {objects.map(o => <rect key={o.key} data-map-object={o.key} x={o.value.x} y={o.value.y} width={o.value.width} height={o.value.height} fill={o.color} stroke={selected === o.key ? '#163f33' : '#ffffff'} strokeWidth={selected === o.key ? 5 : 1} vectorEffect="non-scaling-stroke" style={{ cursor: disabled ? 'default' : 'move' }} onPointerDown={e => { if (disabled) return; setSelected(o.key); drag.current = { key: o.key, x: e.clientX, y: e.clientY, base: { ...o.value } }; e.currentTarget.setPointerCapture(e.pointerId) }}><title>{o.key}</title></rect>)}
    </svg>
    <Select aria-label={en ? 'Selected map object' : '选中地图对象'} value={current ? selected : undefined} onChange={setSelected} options={objects.map(o => ({ value: o.key, label: o.key }))} style={{ width: '100%' }} />
    {current && <Space wrap>{(['x','y','width','height'] as const).map(k => <label key={k}>{k} <InputNumber aria-label={`Map object ${k}`} disabled={disabled} min={k === 'width' || k === 'height' ? 1 : 0} max={k === 'x' || k === 'width' ? draft.width : draft.height} value={current.value[k]} onChange={v => { if (v !== null) edit(current.key, { [k]: v }) }} /></label>)}</Space>}
    <Space wrap>
      <Select aria-label={en ? 'New map object type' : '新增地图对象类型'} disabled={disabled} value={addKind} onChange={setAddKind} options={[['platform',en?'Platform':'平台'],['normalObstacle',en?'Solid block':'实体障碍'],['bounceObstacle',en?'Bounce pad':'弹跳障碍'],['deathObstacle',en?'Lethal hazard':'致命陷阱'],['enemy',en?'Enemy':'敌人'],['collectible',en?'Collectible':'收集品'],['boss','Boss'],['movingPlatform',en?'Moving platform':'移动平台'],['trap',en?'Triggered trap':'触发陷阱'],['freeze',en?'Freeze zone':'冰冻区域'],['reverse',en?'Reverse zone':'方向反转区域'],['checkpoint',en?'Checkpoint':'存档点']].map(([value,label])=>({value,label}))} />
      <Button disabled={disabled || objects.length >= 512 || addKind === 'boss' && !!draft.boss} onClick={() => {
        const id = crypto.randomUUID(), floor = draft.groundY ?? draft.height
        if (addKind === 'checkpoint') { update({ ...draft, version: 2, checkpoints: [...(draft.checkpoints || []), { id, x: 240, y: Math.max(0, floor - 96), width: 40, height: 96, respawn: { x: 240, y: Math.max(0, floor - draft.player.height) } }] }); setSelected('checkpoints:' + id) }
        else if (['movingPlatform','trap','freeze','reverse'].includes(addKind)) { const base = { id, x: 240, y: Math.min(400, draft.height - 80), width: 96, height: addKind === 'movingPlatform' ? 16 : 80 }; const mechanism = (addKind === 'movingPlatform' ? { ...base, kind: addKind, axis: 'x', distance: Math.min(200, draft.width - 336), speed: 2 } : { ...base, kind: addKind, durationMs: 1500, cooldownMs: 1000, ...(addKind === 'trap' ? { delayMs: 500 } : {}) }) as MapMechanism; update({ ...draft, version: 2, mechanisms: [...(draft.mechanisms || []), mechanism] }); setSelected('mechanisms:' + id) }
        else if (addKind === 'enemy') { update({ ...draft, enemies: [...draft.enemies, { id, kind: 'groundEnemy', x: 200, y: Math.max(0, floor - 54), width: 52, height: 54 }] }); setSelected('enemies:' + id) }
        else if (addKind === 'collectible') { update({ ...draft, collectibles: [...draft.collectibles, { id, kind: 'collectible', x: 200, y: Math.max(0, floor - 120), width: 34, height: 34 }] }); setSelected('collectibles:' + id) }
        else if (addKind === 'boss') { update({ ...draft, boss: { id, kind: 'boss', x: 200, y: Math.max(0, floor - 94), width: 94, height: 94 } }); setSelected('boss') }
        else { update({ ...draft, obstacles: [...draft.obstacles, { id, type: addKind, x: 200, y: Math.min(350, draft.height - 20), width: Math.min(160, draft.width - 200), height: 20 }] }); setSelected('obstacles:' + id) }
      }}>{en ? 'Add object' : '新增对象'}</Button>
      <Button disabled={disabled || !selected.includes(':') && selected !== 'boss'} onClick={() => { if (selected === 'boss') update({ ...draft, boss: undefined }); else { const [group, id] = selected.split(':') as ['obstacles' | 'enemies' | 'collectibles' | 'mechanisms' | 'checkpoints', string]; update({ ...draft, [group]: (draft[group] || []).filter(o => o.id !== id) }) } setSelected('player') }}>{en ? 'Remove selected object' : '移除选中对象'}</Button></Space>
    {current && selected.startsWith('obstacles:') && <Select aria-label={en ? 'Obstacle kind' : '障碍类型'} disabled={disabled} value={draft.obstacles.find(o => 'obstacles:' + o.id === selected)?.type} onChange={type => update({ ...draft, obstacles: draft.obstacles.map(o => 'obstacles:' + o.id === selected ? { ...o, type } : o) })} options={['platform','normalObstacle','bounceObstacle','deathObstacle'].map(v => ({ value: v, label: ({ platform: en ? 'Platform' : '平台', normalObstacle: en ? 'Solid block' : '实体障碍', bounceObstacle: en ? 'Bounce pad' : '弹跳障碍', deathObstacle: en ? 'Lethal hazard' : '致命陷阱' })[v] }))} />}
    {selected.startsWith('checkpoints:') && (() => {
      const checkpoint = draft.checkpoints?.find(c => 'checkpoints:' + c.id === selected)
      return checkpoint && <Space wrap>{(['x','y'] as const).map(k => <label key={k}>{en ? 'Respawn ' : '复活坐标 '}{k} <InputNumber aria-label={'Checkpoint respawn ' + k} disabled={disabled} value={checkpoint.respawn[k]} onChange={v => { if(v !== null) update({ ...draft, checkpoints: draft.checkpoints!.map(c => c.id === checkpoint.id ? { ...c, respawn: { ...c.respawn, [k]:v } } : c) }) }} /></label>)}</Space>
    })()}
    {selected.startsWith('mechanisms:') && (() => {
      const mechanism = draft.mechanisms?.find(m => 'mechanisms:' + m.id === selected)
      if (!mechanism) return null
      const change = (patch: Record<string, number | string>) => update({ ...draft, version: 2, mechanisms: draft.mechanisms!.map(m => m.id === mechanism.id ? { ...m, ...patch } as MapMechanism : m) })
      return <Space wrap>
        {mechanism.kind === 'movingPlatform' && <Select aria-label="Platform axis" disabled={disabled} value={mechanism.axis} onChange={axis => change({ axis })} options={[{value:'x',label:en?'Horizontal':'横向'},{value:'y',label:en?'Vertical':'纵向'}]} />}
        {(mechanism.kind === 'movingPlatform' ? ['distance','speed'] : mechanism.kind === 'trap' ? ['delayMs','durationMs','cooldownMs'] : ['durationMs','cooldownMs']).map(key => <label key={key}>{({distance:en?'Signed travel (px)':'往返位移（像素，可负）',speed:en?'Speed (px/frame)':'速度（像素/帧）',delayMs:en?'Warning (ms)':'预警（毫秒）',durationMs:en?'Duration (ms)':'持续（毫秒）',cooldownMs:en?'Cooldown (ms)':'冷却（毫秒）'} as Record<string,string>)[key]} <InputNumber aria-label={'Mechanism ' + key} disabled={disabled} value={Number((mechanism as unknown as Record<string,unknown>)[key])} onChange={v => { if(v !== null) change({ [key]:v }) }} /></label>)}
      </Space>
    })()}
    <Space wrap><Button type="primary" disabled={disabled} onClick={apply}>{en ? 'Apply map & require review' : '应用地图并重新审核'}</Button><Button disabled={disabled || !level.map} onClick={() => onChange({ ...spec, levels: spec.levels.map(l => l.id === level.id ? { ...l, map: undefined } : l) })}>{en ? 'Return to automatic layout' : '改回自动布局'}</Button></Space>
    {error && <Alert type="error" message={error} />}{notice && <Alert type="info" message={notice} />}
    <Collapse size="small" items={[{ key: 'json', label: en ? 'Map JSON import / export' : '地图JSON导入 / 导出', children: <Space direction="vertical" style={{ width: '100%' }}>
      <p>{en ? 'Pixel-world map versions 1 and 2 are accepted; mechanisms require version 2. Raw GameMaker reference metadata needs conversion and is not a playable map.' : '接受此编辑器的version 1和2地图结构，机关使用version 2。原始GameMaker参考元数据仍需转换，不能直接当成可玩地图。'}</p>
      <Input.TextArea aria-label="Map JSON" disabled={disabled} rows={8} value={json} onChange={e => setJson(e.target.value)} />
      <Button disabled={disabled} onClick={() => load(json)}>{en ? 'Load JSON into editor' : '将JSON载入编辑器'}</Button>
      <label>{en ? 'Import map JSON' : '导入地图JSON'}<input aria-label="Import map JSON" type="file" accept=".json,application/json" disabled={disabled} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 512000) { setError(en ? 'Map JSON must be under 512 KB.' : '地图JSON不得超过512KB。'); return } const generation = ++fileGeneration.current; try { const text = await file.text(); if (generation === fileGeneration.current) load(text) } catch { if (generation === fileGeneration.current) setError(en ? 'Could not read file.' : '无法读取文件。') } e.target.value = '' }} /></label>
      <Button onClick={() => { try { const validated = authoredMapRules.validate(draft), url = URL.createObjectURL(new Blob([JSON.stringify(validated, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'pixel-world-map.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } catch (e) { setError(String(e)) } }}>{en ? 'Download map JSON' : '下载地图JSON'}</Button>
    </Space> }]} />
  </Space> }]} /></div>
}
