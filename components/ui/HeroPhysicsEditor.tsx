'use client'

import { Button, Collapse, InputNumber, Space, Switch } from 'antd'
import type { GameSpec, HeroPhysicsSpec } from '@/types'
import { useUiLocale } from './LanguageSwitcher'

const DEFAULTS: HeroPhysicsSpec = { acceleration: 0, gravity: 0.82, airControl: 1, jumpCount: 1, releaseJumpSpeed: 15, runUpBoost: 0, runUpLimit: 0 }
const FIELDS: Array<{ key: keyof HeroPhysicsSpec; label: string; en: string; min: number; max: number; step: number }> = [
  { key: 'acceleration', label: '水平加速度（0为立即响应）', en: 'Acceleration (0: immediate)', min: 0, max: 30, step: 0.1 },
  { key: 'gravity', label: '重力', en: 'Gravity', min: 0.05, max: 5, step: 0.05 },
  { key: 'airControl', label: '空中控制比例', en: 'Air control', min: 0, max: 1, step: 0.1 },
  { key: 'jumpCount', label: '连续跳跃次数', en: 'Jump count', min: 1, max: 8, step: 1 },
  { key: 'releaseJumpSpeed', label: '松开跳跃后的最大上升速度', en: 'Jump release speed limit', min: 0, max: 60, step: 0.5 },
  { key: 'runUpBoost', label: '每帧助跑的起跳增益', en: 'Run-up boost per frame', min: 0, max: 2, step: 0.1 },
  { key: 'runUpLimit', label: '最大助跑帧数', en: 'Run-up frame limit', min: 0, max: 100, step: 1 },
]

export default function HeroPhysicsEditor({ spec, onChange, disabled }: { spec: GameSpec; onChange: (next: GameSpec) => void; disabled: boolean }) {
  const en = useUiLocale() === 'en', value = spec.hero.physics
  const change = (physics: HeroPhysicsSpec | undefined, hero = spec.hero) => onChange({ ...spec, hero: { ...hero, physics } })
  return <div data-no-ui-translation><Collapse size="small" items={[{ key: 'physics', label: en ? 'Hero movement · browser & offline' : '角色物理 · 网页与离线共用', children: <Space direction="vertical" style={{ width: '100%' }}>
    <p>{en ? 'Opt in to advanced controls. Changes require a new approval. Existing games keep legacy controls until enabled. Values use 60 Hz reference frames.' : '开启后使用可调物理，修改后需重新批准。未开启的旧作品继续使用原有操作。数值以60Hz参考帧为单位。'}</p>
    <label><Switch aria-label={en ? 'Advanced hero physics' : '启用可调角色物理'} checked={!!value} disabled={disabled} onChange={checked => change(checked ? { ...DEFAULTS, releaseJumpSpeed: spec.hero.jumpPower } : undefined)} /> {en ? 'Advanced controls' : '启用可调物理'}</label>
    {value && <>
      <label>{en ? 'Maximum speed' : '最大移动速度'} <InputNumber aria-label={en ? 'Maximum speed' : '最大移动速度'} disabled={disabled} min={0.1} max={20} step={0.5} value={spec.hero.moveSpeed} onChange={v => { if (v !== null) change(value, { ...spec.hero, moveSpeed: v }) }} /></label>
      <label>{en ? 'Initial jump speed' : '初始起跳速度'} <InputNumber aria-label={en ? 'Initial jump speed' : '初始起跳速度'} disabled={disabled} min={1} max={60} step={0.5} value={spec.hero.jumpPower} onChange={v => { if (v !== null) change(value, { ...spec.hero, jumpPower: v }) }} /></label>
      <label>{en?'Target jump height without run-up (approximate px)':'无助跑目标跳高（理论像素）'} <InputNumber aria-label="Target jump height" disabled={disabled} min={1/(2*value.gravity)} max={3600/(2*value.gravity)} precision={1} value={spec.hero.jumpPower**2/(2*value.gravity)} onChange={v=>{if(v!==null&&v>0)change(value,{...spec.hero,jumpPower:Math.max(1,Math.min(60,Math.sqrt(2*value.gravity*v)))})}}/></label>
      {spec.hero.roster&&<small>{en?'Characters in the pool use their own movement and collision settings.':'角色池启用时，各角色优先使用自己的移动、跳跃和碰撞配置。'}</small>}
      {FIELDS.map(field => <label key={field.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{en ? field.en : field.label}</span><InputNumber aria-label={en ? field.en : field.label} disabled={disabled} min={field.min} max={field.max} step={field.step} precision={field.key === 'jumpCount' || field.key === 'runUpLimit' ? 0 : undefined} value={value[field.key]} onChange={v => { if (v !== null) change({ ...value, [field.key]: v }) }} /></label>)}
      <p>{en ? 'Approximate jump height without run-up: ' : '无助跑时理论跳高约：'}{(spec.hero.jumpPower ** 2 / (2 * value.gravity)).toFixed(1)} px{en ? ' (collision and discrete time affect actual height).' : '（实际高度受碰撞与离散时间影响）。'}</p>
    </>}
    <Button disabled={disabled} onClick={() => change({ acceleration: 0, gravity: 0.4, airControl: 1, jumpCount: 2, releaseJumpSpeed: 4, runUpBoost: 0.5, runUpLimit: 50 }, { ...spec.hero, moveSpeed: 5, jumpPower: 9 })}>{en ? 'Use IWBTZ regular-character reference values' : '采用IWBTZ普通角色参考参数'}</Button>
    <p>{en ? 'Reference values were read from obj_charReg Create/Step. This does not restore the original collision map, enemies or special effects.' : '参考参数来自obj_charReg的Create/Step源码；应用参数不代表原作地图、碰撞、敌人和状态效果已还原。'}</p>
  </Space> }]} /></div>
}
