import { NextRequest, NextResponse } from 'next/server'
import { formatGenerationError, mapUpstreamHttpStatus } from '@/lib/format-generation-error'
import { buildGamePrompt, getCutoutMode, getNegativeTemplate } from '@/lib/game-prompts'
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
import type { AssetType, GameSpec, LevelData, ProviderId, SpawnPoint } from '@/types'

interface GenerateRequest {
  theme: string
  prompt: string
  provider?: ProviderId
  model?: string
  types?: AssetType[]
  levelCount?: number
  apiKey?: string
  spec?: GameSpec
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
): Promise<string> {
  const cutoutMode = getCutoutMode(providerId, type, model)
  if (!cutoutMode) return imageUrl

  try {
    const response = await fetch(
      `${baseUrl}/api/process-image`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, type, cutoutMode }),
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
