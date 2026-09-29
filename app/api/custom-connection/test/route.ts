import { NextRequest, NextResponse } from 'next/server'
import { customImageResult, CustomEndpointError, validateCustomBaseUrl } from '@/lib/custom-endpoint.server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { baseUrl?: string; model?: string; apiKey?: string }
    if (!body.baseUrl?.trim() || !body.model?.trim() || !body.apiKey?.trim()) {
      return NextResponse.json({ success: false, error: '需要接口地址、模型 ID 和 API Key。' }, { status: 400 })
    }
    const baseUrl = validateCustomBaseUrl(body.baseUrl)
    await customImageResult(baseUrl, body.apiKey.trim(), {
      model: body.model.trim(), prompt: 'A small blue pixel star on a plain white background.', n: 1, size: '256x256',
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof CustomEndpointError) return NextResponse.json({ success: false, error: error.message }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 })
    return NextResponse.json({ success: false, error: '图片测试失败，请检查接口地址、模型 ID 和服务状态。' }, { status: 502 })
  }
}
