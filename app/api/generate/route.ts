import { NextRequest, NextResponse } from 'next/server'
import { formatGenerationError, mapUpstreamHttpStatus } from '@/lib/format-generation-error'
import { buildAnimationClipPrompt, buildGamePrompt, buildModerationSafeAnimationClipPrompt, buildModerationSafePlannedAssetPrompt, buildPlannedAssetPrompt, getCutoutMode, getNegativeTemplate } from '@/lib/game-prompts'
import { animationClipPoses, createActionStripAnimation, generationTypeForAsset, normalizeAnimationSpec } from '@/lib/asset-catalog'
import { createFallbackGameSpec, normalizeGameSpec } from '@/lib/game-spec'
import {
  getImageProvider,
  normalizeProviderRequest,
  ProviderApiKeyError,
  ProviderValidationError,
  resolveApiKey,
  UpstreamApiError,
} from '@/lib/image-providers'
import { ASSET_TYPES } from '@/types'
import type { AnimationClipPose, AssetDefinition, AssetType, GameSpec, LevelData, ProviderId, SpawnPoint } from '@/types'

interface GenerateRequest {
  theme: string
  prompt: string
  provider?: ProviderId
  model?: string
  types?: AssetType[]
  levelCount?: number
  apiKey?: string
  spec?: GameSpec
  asset?: AssetDefinition
  animationPose?: AnimationClipPose
  referenceImages?: string[]
  levelIndex?: number
}

const GLOBAL_ASSET_TYPES: AssetType[] = [
  'character', 'enemy', 'weapon', 'projectile', 'attackEffect', 'collectible', 'boss',
]
const LEVEL_ASSET_TYPES: AssetType[] = ['background', 'ground', 'obstacle']

async function processImageCutout(
  imageUrl: string,
  type: AssetType,
  providerId: ProviderId,
  model: string,
  baseUrl: string,
  preserveCanvas = false,
  gridColumns?: number,
  gridRows = 1,
): Promise<string> {
  const cutoutMode = getCutoutMode(providerId, type, model)
  if (!cutoutMode) return imageUrl

  try {
    const response = await fetch(
      `${baseUrl}/api/process-image`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, type, cutoutMode, preserveCanvas, gridColumns, gridRows }),
      },
    )
    const result = await response.json()
    return result.success ? result.data.processedUrl : imageUrl
  } catch {
    return imageUrl
  }
}

async function generateAsset(
  providerId: ProviderId,
  model: string,
  apiKey: string,
  type: AssetType,
  theme: string,
  spec: GameSpec,
  levelIndex: number,
  baseUrl: string,
): Promise<string> {
  const provider = getImageProvider(providerId)
  const prompt = buildGamePrompt(type, theme, spec, levelIndex, providerId, model)
  const originalUrl = await provider.generateImage({
    prompt,
    negativePrompt: getNegativeTemplate(type, providerId, model),
    assetType: type,
    apiKey,
    model,
  })
  return processImageCutout(originalUrl, type, providerId, model, baseUrl)
}

function isRetryable(error: unknown): boolean {
  return error instanceof UpstreamApiError && (
    error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500
  )
}

function isModerationError(error: unknown): boolean {
  if (!(error instanceof UpstreamApiError)) return false
  const detail = error.message.toLowerCase()
  return error.status === 400 && (
    detail.includes('protected content')
    || detail.includes('request moderated')
    || detail.includes('content policy')
    || detail.includes('content_policy')
    || detail.includes('moderation')
  )
}

async function validateGeneratedImage(url: string, providerId: ProviderId, model: string): Promise<void> {
  const dataMatch = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i)
  if (dataMatch) {
    const bytes = Buffer.from(dataMatch[2], 'base64')
    if (bytes.length < 1024) throw new UpstreamApiError(providerId, model, 502, 'The provider returned empty or truncated image data.')
    if (dataMatch[1].toLowerCase() === 'image/png' && bytes.length >= 24) {
      const signature = bytes.subarray(0, 8).toString('hex')
      const width = bytes.readUInt32BE(16)
      const height = bytes.readUInt32BE(20)
      if (signature !== '89504e470d0a1a0a' || width < 64 || height < 64) {
        throw new UpstreamApiError(providerId, model, 502, `Invalid PNG result (${width}x${height}).`)
      }
    }
    return
  }
  if (!/^https?:\/\//i.test(url)) throw new UpstreamApiError(providerId, model, 502, 'The provider returned an invalid image URL.')
  let response = await fetch(url, { headers: { Range: 'bytes=0-2047' }, cache: 'no-store' })
  if (!response.ok) response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new UpstreamApiError(providerId, model, 502, `The generated image is not accessible (${response.status}).`)
  const contentType = response.headers.get('content-type') || ''
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!contentType.startsWith('image/') || bytes.length < 64) {
    throw new UpstreamApiError(providerId, model, 502, 'The generated URL did not return valid image data.')
  }
}

async function generatePlannedAsset(
  providerId: ProviderId,
  model: string,
  apiKey: string,
  asset: AssetDefinition,
  theme: string,
  spec: GameSpec,
  levelIndex: number,
  baseUrl: string,
  animationPose?: AnimationClipPose,
  referenceImages: string[] = [],
): Promise<string> {
  const type = generationTypeForAsset(asset)
  if (!type || (asset.kind !== 'image' && asset.kind !== 'spriteSheet')) {
    throw new ProviderValidationError(`Asset ${asset.id} does not require image generation.`, providerId)
  }
  const provider = getImageProvider(providerId)
  const animation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : undefined
  const clip = animationPose && animation?.layoutVersion === 3 ? animation.clips?.[animationPose] : undefined
  const frameCount = clip?.frameCount || (animationPose ? createActionStripAnimation().clips?.[animationPose]?.frameCount : undefined) || 1
  let prompt = animationPose
    ? buildAnimationClipPrompt(asset, animationPose, theme, spec, providerId, model)
    : buildPlannedAssetPrompt(asset, type, theme, spec, levelIndex, providerId, model)
  const negativePrompt = asset.kind === 'spriteSheet'
    ? getNegativeTemplate(type, providerId, model).replace(
      'multiple subjects, duplicate subject',
      'unrelated second character, inconsistent identity between animation cells',
    )
    : getNegativeTemplate(type, providerId, model)
  const safeReferenceImages = referenceImages.filter((url) => (
    /^https?:\/\//i.test(url) || /^data:image\/(?:png|jpe?g|webp);base64,/i.test(url)
  )).slice(0, 4)
  const referenceGuidance = safeReferenceImages.length
    ? ` Reference image 1 is the exact character identity and proportions. ${safeReferenceImages.length > 1 ? 'The remaining references are exact project-made weapon, projectile or effect assets; reproduce and physically align them with the character, do not redesign them.' : 'Keep this exact identity in the new action strip.'}`
    : ''
  prompt += referenceGuidance
  let usedModerationRewrite = false
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const originalUrl = await provider.generateImage({
        prompt,
        negativePrompt,
        assetType: type,
        apiKey,
        model,
        layout: animationPose ? 'animation-strip' : asset.kind === 'spriteSheet' ? 'sprite-sheet' : 'single',
        frameCount,
        referenceImages: safeReferenceImages,
      })
      await validateGeneratedImage(originalUrl, providerId, model)
      const processedUrl = await processImageCutout(
        originalUrl, type, providerId, model, baseUrl, asset.kind === 'spriteSheet',
        animationPose ? frameCount : asset.kind === 'spriteSheet' ? 6 : undefined,
        animationPose ? 1 : asset.kind === 'spriteSheet' ? 6 : 1,
      )
      if (processedUrl !== originalUrl) await validateGeneratedImage(processedUrl, providerId, model)
      return processedUrl
    } catch (error) {
      lastError = error
      if (isModerationError(error) && !usedModerationRewrite) {
        prompt = animationPose
          ? buildModerationSafeAnimationClipPrompt(asset, animationPose, providerId, model) + referenceGuidance
          : buildModerationSafePlannedAssetPrompt(asset, type, providerId, model)
        usedModerationRewrite = true
        continue
      }
      if (!isRetryable(error) || attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt))
    }
  }
  throw lastError
}

function spreadSpawns(prefix: string, count: number, start = 260, end = 850, y = 352): SpawnPoint[] {
  const safeCount = Math.max(0, count)
  if (!safeCount) return []
  const step = (end - start) / Math.max(1, safeCount - 1)
  return Array.from({ length: safeCount }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    x: Math.round(start + step * index),
    y: y - (index % 2) * 45,
    kind: prefix,
  }))
}

function generateObstacleLayout(levelId: string, levelIndex: number) {
  const count = Math.min(8, 3 + levelIndex)
  return Array.from({ length: count }, (_, index) => ({
    id: `${levelId}-obstacle-${index + 1}`,
    x: 190 + index * Math.max(75, Math.floor(600 / count)),
    y: 352,
    width: 48,
    height: 48,
    type: 'obstacle',
  }))
}

function errorResponse(error: unknown, provider?: ProviderId, model?: string) {
  if (error instanceof ProviderApiKeyError || error instanceof ProviderValidationError) {
    return NextResponse.json(
      { success: false, error: error.message, provider, timestamp: new Date().toISOString() },
      { status: 400 },
    )
  }
  if (error instanceof UpstreamApiError) {
    return NextResponse.json(
      {
        success: false,
        error: formatGenerationError(error.message),
        provider: error.provider,
        model: error.model,
        timestamp: new Date().toISOString(),
      },
      { status: mapUpstreamHttpStatus(error.status, error.message) },
    )
  }
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : 'Generation failed.', provider, model },
    { status: 500 },
  )
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let providerId: ProviderId | undefined
  let modelId: string | undefined

  try {
    const body = await request.json() as GenerateRequest
    const theme = body.theme?.trim()
    const requestedPrompt = body.prompt?.trim()
    const levelCount = Math.min(10, Math.max(1, body.levelCount || body.spec?.levels?.length || 1))
    const types = body.types?.length ? body.types : [...ASSET_TYPES]

    if (!theme) {
      return NextResponse.json({ success: false, error: 'Theme is required.' }, { status: 400 })
    }
    const prompt = requestedPrompt
      || `A cohesive 2D side-scrolling pixel action world inspired by ${theme}, with isolated reusable game assets.`
    const invalidTypes = types.filter((type) => !ASSET_TYPES.includes(type))
    if (invalidTypes.length) {
      return NextResponse.json(
        { success: false, error: `Invalid asset types: ${invalidTypes.join(', ')}` },
        { status: 400 },
      )
    }

    const normalized = normalizeProviderRequest(body.provider, body.model)
    providerId = normalized.provider
    modelId = normalized.model
    const apiKey = resolveApiKey(providerId, body.apiKey)
    const fallback = createFallbackGameSpec(prompt, theme, levelCount)
    const spec = normalizeGameSpec(body.spec || fallback, fallback, levelCount)
    const baseUrl = request.nextUrl.origin

    if (body.asset) {
      const asset = spec.assets.find((candidate) => candidate.id === body.asset?.id) || body.asset
      const animationPose = body.animationPose || (asset.kind === 'spriteSheet' ? 'idle' : undefined)
      const levelIndex = Math.min(levelCount - 1, Math.max(0, body.levelIndex || 0))
      const url = await generatePlannedAsset(
        providerId, modelId, apiKey, asset, theme, spec, levelIndex, baseUrl, animationPose, body.referenceImages,
      )
      const animation = asset.kind === 'spriteSheet' ? (
        normalizeAnimationSpec(asset.animation).layoutVersion === 3
          ? normalizeAnimationSpec(asset.animation)
          : createActionStripAnimation()
      ) : undefined
      const completedAnimation = animationPose && animation?.clips ? {
        ...animation,
        clips: {
          ...animation.clips,
          [animationPose]: {
            ...animation.clips[animationPose],
            url,
            status: 'success' as const,
            error: undefined,
          },
        },
      } : animation
      const completedClipUrls = completedAnimation?.layoutVersion === 3 && completedAnimation.clips
        ? animationClipPoses({ ...asset, animation: completedAnimation }).every((pose) => Boolean(completedAnimation.clips?.[pose]?.url))
        : false
      const completedAsset: AssetDefinition = {
        ...asset,
        url: completedAnimation?.clips?.idle?.url || (asset.kind === 'spriteSheet' ? undefined : url),
        status: asset.kind === 'spriteSheet' ? completedClipUrls ? 'success' : 'pending' : 'success',
        error: undefined,
        animation: completedAnimation,
      }
      const completedSpec: GameSpec = {
        ...spec,
        assets: spec.assets.map((candidate) => candidate.id === completedAsset.id ? completedAsset : candidate),
      }
      return NextResponse.json({
        success: true,
        data: { asset: completedAsset, spec: completedSpec },
        generationId: `asset_${asset.id}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        metadata: { generationTime: (Date.now() - startedAt) / 1000, assetCount: 1, provider: providerId, model: modelId },
      })
    }

    const assets: Record<string, string> = {
      characterUrl: '', enemyUrl: '', weaponUrl: '', projectileUrl: '',
      attackEffectUrl: '', collectibleUrl: '', bossUrl: '',
    }

    const requestedGlobalTypes = GLOBAL_ASSET_TYPES.filter((type) => types.includes(type))
    for (let index = 0; index < requestedGlobalTypes.length; index++) {
      const type = requestedGlobalTypes[index]
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 500))
      assets[`${type}Url`] = await generateAsset(
        providerId, modelId, apiKey, type, theme, spec, 0, baseUrl,
      )
    }

    const levels: LevelData[] = []
    for (let levelIndex = 0; levelIndex < levelCount; levelIndex++) {
      const levelSpec = spec.levels[levelIndex]
      const levelId = `level-${levelIndex + 1}`
      const level: LevelData = {
        id: levelId,
        backgroundUrl: '',
        groundUrl: '',
        obstacleUrl: '',
        obstacles: generateObstacleLayout(levelId, levelIndex),
        enemySpawns: spreadSpawns(`${levelId}-enemy`, levelSpec.enemyCount),
        collectibleSpawns: spreadSpawns(`${levelId}-collectible`, levelSpec.collectibleCount, 210, 820, 300),
        bossSpawn: levelSpec.hasBoss
          ? { id: `${levelId}-boss`, x: 780, y: 320, kind: 'boss' }
          : undefined,
      }

      const requestedLevelTypes = LEVEL_ASSET_TYPES.filter((type) => types.includes(type))
      for (let typeIndex = 0; typeIndex < requestedLevelTypes.length; typeIndex++) {
        if (levelIndex > 0 || typeIndex > 0 || requestedGlobalTypes.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        const type = requestedLevelTypes[typeIndex]
        level[`${type}Url` as 'backgroundUrl' | 'groundUrl' | 'obstacleUrl'] = await generateAsset(
          providerId, modelId, apiKey, type, theme, spec, levelIndex, baseUrl,
        )
      }
      levels.push(level)
    }

    return NextResponse.json({
      success: true,
      data: { ...assets, levels, spec },
      generationId: `gen_${Date.now()}`,
      timestamp: new Date().toISOString(),
      metadata: {
        generationTime: (Date.now() - startedAt) / 1000,
        levelCount,
        assetCount: requestedGlobalTypes.length + LEVEL_ASSET_TYPES.filter((type) => types.includes(type)).length * levelCount,
        provider: providerId,
        model: modelId,
      },
    })
  } catch (error) {
    return errorResponse(error, providerId, modelId)
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
