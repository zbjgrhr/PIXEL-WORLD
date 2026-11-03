import { NextResponse } from 'next/server'
import { normalizeTextCatalog } from '@/lib/text-model-catalog'

export async function GET() {
  try {
    // Public metadata only: fixed upstream, no credentials, no inference call.
    const response = await fetch('https://openrouter.ai/api/v1/models', { next: { revalidate: 900 }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('upstream unavailable')
    const models = normalizeTextCatalog(await response.json())
    if (!models.length) throw new Error('empty catalog')
    return NextResponse.json({ models, source: 'https://openrouter.ai/api/v1/models', checkedAt: new Date().toISOString() })
  } catch {
    return NextResponse.json({ error: '模型目录暂不可用。可保留当前模型，或手动填写模型 ID；没有发起生成请求。' }, { status: 502 })
  }
}
