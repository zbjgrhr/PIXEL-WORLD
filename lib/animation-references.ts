import type { AnimationClipPose, AssetDefinition, GameSpec } from '@/types'
import { normalizeAnimationSpec } from '@/lib/asset-catalog'

function firstEnabledAssetUrl(spec: GameSpec, category: AssetDefinition['category']): string | undefined {
  return spec.assets.find((candidate) => candidate.enabled && candidate.category === category)?.url
}

/**
 * Reference order is meaningful: identity first, then the exact project weapon,
 * projectile and effect. The prompt generator describes the same order.
 */
export function animationReferenceUrls(
  spec: GameSpec,
  asset: AssetDefinition,
  pose: AnimationClipPose,
): string[] {
  if (pose === 'idle') return []
  const urls: Array<string | undefined> = [normalizeAnimationSpec(asset.animation).clips?.idle?.url || asset.url]

  if (asset.category === 'hero' && pose === 'meleeAttack') {
    urls.push(firstEnabledAssetUrl(spec, 'meleeWeapon'), firstEnabledAssetUrl(spec, 'meleeAttackEffect'))
  } else if (asset.category === 'hero' && pose === 'rangedAttack') {
    urls.push(
      firstEnabledAssetUrl(spec, 'rangedWeapon'),
      firstEnabledAssetUrl(spec, 'rangedProjectile'),
      firstEnabledAssetUrl(spec, 'rangedAttackEffect'),
    )
  } else if (pose === 'meleeAttack' || pose === 'rangedAttack') {
    const effectCategory = asset.category === 'groundEnemy' ? 'groundEnemyAttackEffect'
      : asset.category === 'airEnemy' ? 'airEnemyAttackEffect'
        : asset.category === 'waterEnemy' ? 'waterEnemyAttackEffect'
          : asset.category === 'boss' ? 'bossAttackEffect' : undefined
    if (effectCategory) urls.push(firstEnabledAssetUrl(spec, effectCategory))
  }

  return [...new Set(urls.filter((url): url is string => Boolean(url)))].slice(0, 4)
}

async function compactDataImage(url: string): Promise<string | undefined> {
  if (!url.startsWith('data:image/')) return url
  if (typeof document === 'undefined') return url.length <= 3_000_000 ? url : undefined
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return url.length <= 3_000_000 ? url : undefined
    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.82)
  } catch {
    return url.length <= 3_000_000 ? url : undefined
  }
}

export async function prepareAnimationReferenceImages(
  spec: GameSpec,
  asset: AssetDefinition,
  pose: AnimationClipPose,
): Promise<string[]> {
  const compacted = await Promise.all(animationReferenceUrls(spec, asset, pose).map(compactDataImage))
  return compacted.filter((url): url is string => Boolean(url))
}
