import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { exportGameZip } from '@/lib/export-game'
import { ANIMATION_CLIP_POSES } from '@/lib/asset-catalog'
import { withUploadedClip, withUploadedStatic } from '@/lib/uploaded-asset'

afterEach(() => vi.unstubAllGlobals())

describe('offline export with uploaded art', () => {
  it('packages a browser-uploaded image into the game ZIP', async () => {
    const spec = createFallbackGameSpec('A pixel adventure', 'Upload Test', 1)
    const hero = spec.assets.find((asset) => asset.category === 'hero')!
    spec.assets = [withUploadedStatic(hero, 'data:image/png;base64,VEVTVA==')]
    let downloaded: Blob | undefined
    const click = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:upload-test' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    await exportGameZip(spec)

    expect(click).toHaveBeenCalledOnce()
    expect(downloaded).toBeDefined()
    const archive = new TextDecoder().decode(await downloaded!.arrayBuffer())
    expect(archive).toContain(`assets/${hero.id}.png`)
    expect(archive).toContain('TEST')
    expect(archive).toContain('project.json')
  })

  it('packages each uploaded character action strip', async () => {
    const spec = createFallbackGameSpec('A pixel adventure', 'Action Test', 1)
    const hero = spec.assets.find((asset) => asset.category === 'hero')!
    spec.assets = [ANIMATION_CLIP_POSES.reduce((asset, pose) => withUploadedClip(asset, pose, 'data:image/png;base64,VEVTVA=='), hero)]
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:actions' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    await exportGameZip(spec)

    const archive = new TextDecoder().decode(await downloaded!.arrayBuffer())
    for (const pose of ANIMATION_CLIP_POSES) expect(archive).toContain(`assets/${hero.id}-${pose.toLowerCase()}.png`)
  })
})
