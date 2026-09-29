import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANIMATION_CLIP_POSES, animationIsComplete } from '@/lib/asset-catalog'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { readUploadedImage, withUploadedClip, withUploadedStatic } from '@/lib/uploaded-asset'

afterEach(() => vi.unstubAllGlobals())

describe('uploaded assets', () => {
  it('accepts static pictures and completes character strips only after every action is present', () => {
    const hero = createFallbackGameSpec('A pixel adventure', 'Upload Test', 1).assets.find((asset) => asset.category === 'hero')!
    const still = withUploadedStatic(hero, 'data:image/png;base64,c3RpbGw=')
    expect(still.kind).toBe('image')
    expect(still.animation).toBeUndefined()
    expect(still.status).toBe('success')

    const partial = withUploadedClip(hero, 'idle', 'data:image/png;base64,aWRsZQ==')
    expect(partial.status).toBe('pending')
    expect(animationIsComplete(partial)).toBe(false)
    const complete = ANIMATION_CLIP_POSES.reduce((asset, pose) => withUploadedClip(asset, pose, `data:image/png;base64,${pose}`), hero)
    expect(complete.status).toBe('success')
    expect(animationIsComplete(complete)).toBe(true)
  })

  it('rejects JPEG action strips even when an action uses one frame', async () => {
    await expect(readUploadedImage({ type: 'image/jpeg', size: 100 } as File, 1, true)).rejects.toThrow('动作帧条请上传 PNG 或 WebP')
  })

  it('checks strip width against the selected action frame count', async () => {
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,AA=='
      onload?: () => void
      readAsDataURL() { this.onload?.() }
    })
    vi.stubGlobal('Image', class {
      naturalWidth = 5
      naturalHeight = 2
      onload?: () => void
      set src(_url: string) { this.onload?.() }
    })
    await expect(readUploadedImage({ type: 'image/png', size: 100 } as File, 3, true)).rejects.toThrow('宽度必须能被 3 帧整除')
  })
})
