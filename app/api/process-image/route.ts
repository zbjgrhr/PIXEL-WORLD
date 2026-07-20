import { NextRequest, NextResponse } from 'next/server'
import type { CutoutMode } from '@/lib/game-prompts'
import {
  padImageToGrid,
  removeCheckerboardBackground,
  removeChromaGreenBackground,
} from '@/lib/image-cutout'
import sharp from 'sharp'
import { ASSET_TYPES } from '@/types'
import type { AssetType } from '@/types'

interface ProcessImageRequest {
  imageUrl: string
  type: AssetType
  cutoutMode?: CutoutMode
  preserveCanvas?: boolean
  gridColumns?: number
  gridRows?: number
}

async function downloadImage(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1]
    if (!base64) {
      throw new Error('Invalid data URL')
    }
    return Buffer.from(base64, 'base64')
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function applyCutout(imageBuffer: Buffer, cutoutMode: CutoutMode, preserveCanvas: boolean): Promise<Buffer> {
  if (cutoutMode === 'chroma-green') {
    return removeChromaGreenBackground(imageBuffer, preserveCanvas)
  }
  return removeCheckerboardBackground(imageBuffer, preserveCanvas)
}

export async function POST(request: NextRequest) {
  try {
    const body: ProcessImageRequest = await request.json()
    const { imageUrl, type, cutoutMode = 'checkerboard', preserveCanvas = false, gridColumns, gridRows = 1 } = body

    if (!imageUrl || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: imageUrl and type' },
        { status: 400 },
      )
    }

    if (!ASSET_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type: ${type}` },
        { status: 400 },
      )
    }

    console.log(`Processing ${type} image with cutoutMode=${cutoutMode}`)

    const originalImageBuffer = await downloadImage(imageUrl)

    let processedImageBuffer: Buffer
    if (type !== 'background' && type !== 'ground') {
      processedImageBuffer = await applyCutout(originalImageBuffer, cutoutMode, preserveCanvas)
    } else {
      processedImageBuffer = await sharp(originalImageBuffer).png().toBuffer()
    }
    if (preserveCanvas && gridColumns && Number.isInteger(gridColumns) && gridColumns >= 1 && gridColumns <= 12 && Number.isInteger(gridRows) && gridRows >= 1 && gridRows <= 12) {
      processedImageBuffer = await padImageToGrid(processedImageBuffer, gridColumns, gridRows)
    }

    const base64Image = processedImageBuffer.toString('base64')
    const dataUrl = `data:image/png;base64,${base64Image}`

    return NextResponse.json({
      success: true,
      data: {
        originalUrl: imageUrl,
        processedUrl: dataUrl,
        type,
        cutoutMode,
        preserveCanvas,
        gridColumns,
        gridRows,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Image processing error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
