import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec } from './game-spec'
import { hydrateSpecAssetsWithUrls, stripLargeAssetUrls } from './asset-db'

describe('draft media cache identity', () => {
  it('does not attach images from an earlier story with reused asset IDs', () => {
    const fresh = createFallbackGameSpec('小企鹅找妈妈', '小企鹅在日本世界寻找妈妈', 3)
    const hero = fresh.assets.find(asset => asset.category === 'hero')!
    const oldUrls = { [hero.id]: 'data:image/png;base64,b2xk', [`${hero.id}:clip:walk`]: 'data:image/png;base64,b2xk' }
    const restored = hydrateSpecAssetsWithUrls(fresh, oldUrls).assets.find(asset => asset.id === hero.id)!
    expect(restored.url).toBeUndefined()
    expect(restored.animation?.clips?.walk?.url).toBeUndefined()
    expect(restored.status).toBe('pending')
  })

  it('hydrates only media explicitly marked as cached by this saved draft', () => {
    const spec = createFallbackGameSpec('小企鹅找妈妈', '小企鹅在日本世界寻找妈妈', 3)
    const hero = spec.assets.find(asset => asset.category === 'hero')!
    const image = 'data:image/png;base64,b2xk'
    hero.url = image
    hero.animation!.clips!.idle!.url = image
    hero.animation!.clips!.idle!.status = 'success'
    const saved = stripLargeAssetUrls(spec)
    expect(saved.assets.find(asset => asset.id === hero.id)?.animation?.clips?.idle?.url).toBe(`cached-image:${hero.id}:clip:idle`)
    const restored = hydrateSpecAssetsWithUrls(saved, { [hero.id]: image, [`${hero.id}:clip:idle`]: image })
    expect(restored.assets.find(asset => asset.id === hero.id)?.animation?.clips?.idle?.url).toBe(image)
  })
})
