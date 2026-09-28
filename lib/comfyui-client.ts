import { safeLocalBaseUrl } from '@/lib/agents/local-client'

export interface ComfySettings { endpoint: string; checkpoint: string }
export const DEFAULT_COMFY_SETTINGS: ComfySettings = { endpoint: 'http://127.0.0.1:8188', checkpoint: '' }

export async function discoverComfyCheckpoints(endpoint: string): Promise<string[]> {
  const base = safeLocalBaseUrl(endpoint)
  const response = await fetch(`${base}/object_info/CheckpointLoaderSimple`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`ComfyUI 服务未就绪（HTTP ${response.status}）。`)
  const data = await response.json() as { CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } } }
  return data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || []
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取 ComfyUI 图片。'))
    reader.readAsDataURL(blob)
  })
}

/** Uses the standard ComfyUI API workflow; all requests go from the browser to loopback. */
export async function generateComfyImage(settings: ComfySettings, prompt: string, signal?: AbortSignal): Promise<string> {
  const base = safeLocalBaseUrl(settings.endpoint)
  if (!settings.checkpoint) throw new Error('请先检测并选择 ComfyUI 检查点模型。')
  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: settings.checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: `${prompt}, pixel art, crisp sprite, clean silhouette`, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, photographic, text, watermark, multiple panels', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 2 ** 32), steps: 24, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'PixelWorld', images: ['6', 0] } },
  }
  const queued = await fetch(`${base}/prompt`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }) })
  const queuedData = await queued.json() as { prompt_id?: string; error?: string }
  if (!queued.ok || !queuedData.prompt_id) throw new Error(`ComfyUI 未接受工作流：${queuedData.error || queued.status}`)
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const historyResponse = await fetch(`${base}/history/${encodeURIComponent(queuedData.prompt_id)}`, { signal, cache: 'no-store' })
    if (!historyResponse.ok) continue
    const history = await historyResponse.json() as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>; status?: { status_str?: string } }>
    const record = history[queuedData.prompt_id]
    if (!record) continue
    if (record.status?.status_str === 'error') throw new Error('ComfyUI 工作流失败，请检查检查点是否与工作流兼容。')
    const image = record.outputs?.['7']?.images?.[0]
    if (!image) continue
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' })
    const output = await fetch(`${base}/view?${query}`, { signal })
    if (!output.ok) throw new Error(`ComfyUI 图片读取失败（HTTP ${output.status}）。`)
    return blobDataUrl(await output.blob())
  }
  throw new Error('ComfyUI 生成超时（3 分钟）。')
}
