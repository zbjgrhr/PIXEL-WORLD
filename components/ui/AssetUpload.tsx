'use client'

import { useRef, useState } from 'react'
import { Button, Select, Space, Typography, message } from 'antd'
import { Upload } from 'lucide-react'
import { ANIMATION_CLIP_POSES, animationClipDefaults, animationClipPoses, normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AnimationClipPose, AssetDefinition } from '@/types'

const POSE_LABELS: Record<AnimationClipPose, string> = {
  idle: '站立', walk: '行走', jump: '跳跃', meleeAttack: '近战', rangedAttack: '远程', hit: '受击', death: '死亡',
}

export default function AssetUpload({ asset, onUpload, disabled = false }: {
  asset: AssetDefinition
  onUpload: (file: File, pose?: AnimationClipPose) => Promise<void>
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const character = asset.kind === 'spriteSheet' || ['hero', 'groundEnemy', 'airEnemy', 'waterEnemy', 'boss'].includes(asset.category)
  const [mode, setMode] = useState<'static' | 'strips'>(asset.kind === 'spriteSheet' ? 'strips' : 'static')
  const [pose, setPose] = useState<AnimationClipPose>('idle')
  const [uploading, setUploading] = useState(false)
  const animation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : null
  const missing = animation ? animationClipPoses(asset).filter((item) => !animation.clips?.[item]?.url) : []
  const frameCount = animation?.clips?.[pose]?.frameCount || animationClipDefaults(pose).frameCount

  const choose = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try { await onUpload(file, character && mode === 'strips' ? pose : undefined); message.success(`${asset.title}已应用上传图片。`) }
    catch (error) { message.error(error instanceof Error ? error.message : '图片上传失败。') }
    finally { setUploading(false); if (input.current) input.current.value = '' }
  }

  return <div className="asset-upload">
    {character && <div className="asset-upload-mode" role="group" aria-label={`${asset.title}图片类型`}>
      <button type="button" className={mode === 'static' ? 'active' : ''} onClick={() => setMode('static')}>单张静态图</button>
      <button type="button" className={mode === 'strips' ? 'active' : ''} onClick={() => setMode('strips')}>逐动作帧条</button>
    </div>}
    {character && mode === 'strips' && <Select<AnimationClipPose> value={pose} onChange={setPose} style={{ width: '100%' }} options={ANIMATION_CLIP_POSES.map((item) => ({ value: item, label: `${POSE_LABELS[item]} · ${animation?.clips?.[item]?.frameCount || animationClipDefaults(item).frameCount} 帧${animation?.clips?.[item]?.url ? ' ✓' : ''}` }))} />}
    {character && mode === 'strips' && animation?.clips?.[pose]?.url && <img className="asset-upload-preview" src={animation.clips[pose].url} alt={`${asset.title}的${POSE_LABELS[pose]}动作帧条`} />}
    <Space wrap size={6}>
      <input ref={input} type="file" hidden accept={character && mode === 'strips' ? 'image/png,image/webp' : 'image/png,image/jpeg,image/webp'} onChange={(event) => { void choose(event.target.files?.[0]) }} />
      <Button size="small" icon={<Upload size={13} />} loading={uploading} disabled={disabled} onClick={() => input.current?.click()}>{mode === 'strips' ? animation?.clips?.[pose]?.url ? '替换帧条' : '上传帧条' : asset.url ? '替换图片' : '上传图片'}</Button>
      {character && mode === 'strips' && <Typography.Text type="secondary" className="asset-upload-hint">{POSE_LABELS[pose]}：横向 {frameCount} 帧</Typography.Text>}
    </Space>
    {character && mode === 'static' && <small>单张图可试玩；角色不会有逐动作动画。</small>}
    {character && mode === 'strips' && missing.length > 0 && <small>待补动作：{missing.map((item) => POSE_LABELS[item]).join('、')}</small>}
  </div>
}
