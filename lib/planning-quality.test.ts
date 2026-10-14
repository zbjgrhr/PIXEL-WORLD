import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec, normalizeGameSpec, serializeGameSpec } from './game-spec'
import { deterministicAgentResponse, prepareAgentRequest } from './agents/execution'
import { replaceAnimationClip } from './asset-catalog'
import { assetMetadataForReview } from './asset-db'
import { inspectVisualAssets } from './agents/validation'
import { compactThemeForStorage } from './theme-migration'
import type { Theme } from '@/types'
import type { AgentExecuteRequest } from '@/types'

describe('planning improvements reach image production', () => {
  it('updates generic asset prompts from improved hero, boss and level fields', () => {
    const base = createFallbackGameSpec('游戏标题：灯塔救援', '灯塔救援', 1)
    const next = normalizeGameSpec({ hero: { appearance: 'A blue-caped mapmaker' }, boss: { appearance: 'A broken brass lighthouse keeper' }, levels: [{ ...base.levels[0], environment: 'A stormy floating lighthouse' }] }, base)
    expect(next.assets.find(a => a.category === 'hero')?.prompt).toBe('A blue-caped mapmaker')
    expect(next.assets.find(a => a.category === 'boss')?.prompt).toBe('A broken brass lighthouse keeper')
    expect(next.assets.find(a => a.category === 'levelBackground')?.prompt).toBe('A stormy floating lighthouse')
  })
  it('keeps explicit per-asset requests and optional creative fields through serialization', () => {
    const base = createFallbackGameSpec('主角目标（可选）：点亮灯塔\n难度偏好（可选）：简单\n角色一致性要求（可选）：蓝披风不能变色', '灯塔救援', 1)
    const hero = base.assets.find(a => a.category === 'hero')!
    const next = normalizeGameSpec({ hero: { appearance: 'new appearance' }, assets: [{ ...hero, prompt: 'Player-requested blue cloak' }] }, base)
    expect(next.assets.find(a => a.category === 'hero')?.prompt).toBe('Player-requested blue cloak')
    expect(serializeGameSpec(next)).toContain('点亮灯塔')
    expect(serializeGameSpec(next)).toContain('蓝披风不能变色')
  })
  it('accepts optional fields after a level and fills unspecified creative goals', () => {
    const base = createFallbackGameSpec('关卡 1：灯塔\n主角目标（可选）：找回船队', 'Test', 1)
    expect(base.creativeBrief?.heroGoal).toBe('找回船队')
    const next = normalizeGameSpec({creativeBrief:{heroGoal:'Changed goal',difficulty:'新手友好'}}, base)
    expect(next.creativeBrief?.heroGoal).toBe('找回船队')
    expect(next.creativeBrief?.difficulty).toBe('新手友好')
  })
  it('checks engine rules and avoids an unnecessary paid revision', () => {
    const request: AgentExecuteRequest = { runId: 'r', taskId: 'engineQa-r1', role: 'engineQa', round: 1, provider: 'openrouter', model: 'test', apiKey: '', sourcePrompt: '', projectName: 'Test', levelCount: 1, baseSpec: createFallbackGameSpec('', 'Test', 1), artifacts: {} }
    expect(deterministicAgentResponse(request)?.data?.usage.totalTokens).toBe(0)
    expect(deterministicAgentResponse({ ...request, role: 'revision' })?.data?.artifact.spec).toBeDefined()
    expect(deterministicAgentResponse({ ...request, role: 'revision', artifacts: { reviewIssues: [{ id:'problem',source:'consistencyCritic',severity:'warning',path:'world',message:'Story mismatch',suggestion:'Repair it' }] } })).toBeNull()
  })
  it('invalidates old actions only after a new identity succeeds', () => {
    const hero = createFallbackGameSpec('', 'Test', 1).assets.find(a => a.category === 'hero')!
    hero.animation!.clips!.idle = { ...hero.animation!.clips!.idle!, url: 'old-idle', status: 'success' }
    hero.animation!.clips!.walk = { ...hero.animation!.clips!.walk!, url: 'old-walk', status: 'success' }
    const hit = replaceAnimationClip(hero, 'hit', { ...hero.animation!.clips!.hit!, url: 'new-hit', status: 'success' })
    expect(hit.animation!.clips!.walk!.url).toBe('old-walk')
    const changed = replaceAnimationClip(hero, 'idle', { ...hero.animation!.clips!.idle!, url: 'new-idle', status: 'success' })
    expect(changed.animation!.clips!.walk!.url).toBeUndefined()
    expect(changed.animation!.clips!.walk!.status).toBe('pending')
    expect(hero.animation!.clips!.walk!.url).toBe('old-walk')
  })
  it('passes bounded cached image data to visual review without exposing arbitrary URLs', () => {
    const request: AgentExecuteRequest = { runId:'r', taskId:'v', role:'visualQa', round:1, provider:'openrouter', model:'test', apiKey:'', sourcePrompt:'', projectName:'Test', levelCount:1, artifacts:{}, imageUrls:['data:image/png;base64,YQ==', 'file:///private.png'] }
    expect(prepareAgentRequest(request).imageUrls).toEqual(['data:image/png;base64,YQ=='])
  })
  it('preserves image readiness during review without embedding binary URLs in text', () => {
    const spec = createFallbackGameSpec('', 'Test', 1)
    for (const asset of spec.assets) {
      if (asset.kind === 'image') { asset.url = 'data:image/png;base64,YQ=='; asset.status = 'success' }
      if (asset.animation?.clips) for (const clip of Object.values(asset.animation.clips)) if (clip) { clip.url = 'data:image/png;base64,YQ=='; clip.status = 'success' }
    }
    const metadata = assetMetadataForReview(spec)
    expect(JSON.stringify(metadata)).not.toContain('base64')
    expect(inspectVisualAssets(normalizeGameSpec(metadata, spec))).toEqual([])
    const hero = metadata.assets.find(a => a.category === 'hero')!
    hero.animation!.clips!.walk!.status = 'failed'
    expect(inspectVisualAssets(normalizeGameSpec(metadata, spec)).some(issue => issue.path.includes('walk'))).toBe(true)
  })
  it('keeps theme metadata small enough to save after a full image batch', () => {
    const spec = createFallbackGameSpec('', 'Test', 1)
    spec.assets[0].url = 'data:image/png;base64,' + 'x'.repeat(6_000_000)
    const theme: Theme = {id:'custom-test',name:'Test',description:'Story',spec,characterImage:spec.assets[0].url,backgroundImage:'/existing-background.png',groundImage:'',obstacleImage:''}
    const compact = compactThemeForStorage(theme)
    expect(JSON.stringify(compact).length).toBeLessThan(100_000)
    expect(compact.backgroundImage).toBe('/existing-background.png')
    expect(theme.characterImage.length).toBeGreaterThan(6_000_000)
  })
})
