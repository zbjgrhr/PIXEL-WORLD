import { animationClipPoses, normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AnimationClipPose, AssetDefinition } from '@/types'

export interface AssetGenerationJob { id: string; assetId: string; pose?: AnimationClipPose; dependencies: string[] }

export function createGenerationJobs(assets: AssetDefinition[]): AssetGenerationJob[] {
  const jobs: AssetGenerationJob[] = assets.filter(asset => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet')).flatMap(asset => {
    if (asset.kind === 'image') return !asset.url || ['failed', 'cancelled'].includes(asset.status) ? [{ id: asset.id, assetId: asset.id, dependencies: [] }] : []
    const animation = normalizeAnimationSpec(asset.animation)
    const identityMissing = !animation.clips?.idle?.url || ['failed', 'cancelled'].includes(animation.clips?.idle?.status || '')
    return animationClipPoses(asset).filter(pose => identityMissing || !animation.clips?.[pose]?.url || ['failed', 'cancelled'].includes(animation.clips?.[pose]?.status || '')).map(pose => ({ id: `${asset.id}:${pose}`, assetId: asset.id, pose, dependencies: [] }))
  })
  const ids = new Set(jobs.map(job => job.id))
  for (const job of jobs) {
    if (!job.pose || job.pose === 'idle') continue
    const idle = `${job.assetId}:idle`
    if (ids.has(idle)) job.dependencies.push(idle)
    if (job.pose !== 'meleeAttack' && job.pose !== 'rangedAttack') continue
    const asset = assets.find(item => item.id === job.assetId)!
    const categories = asset.category === 'hero'
      ? job.pose === 'meleeAttack' ? ['meleeWeapon', 'meleeAttackEffect'] : ['rangedWeapon', 'rangedProjectile', 'rangedAttackEffect']
      : [`${asset.category}AttackEffect`]
    for (const category of categories) {
      const reference = assets.find(item => item.enabled && item.category === category)
      if (reference && ids.has(reference.id)) job.dependencies.push(reference.id)
    }
  }
  return jobs
}

/** Start each action as soon as its own references are ready; never wait for unrelated backgrounds. */
export async function runGenerationJobs(jobs: AssetGenerationJob[], concurrency: number, execute: (job: AssetGenerationJob) => Promise<void>, onBlocked: (job: AssetGenerationJob, reason: string) => void, signal?: AbortSignal): Promise<void> {
  const waiting = new Map(jobs.map(job => [job.id, job]))
  const complete = new Set<string>(), failed = new Set<string>(), running = new Set<Promise<void>>()
  while (waiting.size || running.size) {
    for (const [id, job] of waiting) {
      if (signal?.aborted || job.dependencies.some(dependency => failed.has(dependency))) {
        waiting.delete(id); failed.add(id)
        onBlocked(job, signal?.aborted ? '生成已取消。' : '所需站立图或配套素材未准备好，这个动作未调用图片模型。')
      }
    }
    for (const [id, job] of waiting) {
      if (running.size >= Math.max(1, concurrency)) break
      if (!job.dependencies.every(dependency => complete.has(dependency))) continue
      waiting.delete(id)
      const work = Promise.resolve().then(() => execute(job)).then(() => { complete.add(id) }, () => { failed.add(id) }).finally(() => { running.delete(work) })
      running.add(work)
    }
    if (running.size) await Promise.race(running)
    else if (waiting.size) {
      for (const job of waiting.values()) onBlocked(job, '素材依赖无法满足，请检查站立图与配套素材。')
      break
    }
  }
}
