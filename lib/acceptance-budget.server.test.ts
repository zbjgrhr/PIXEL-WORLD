import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptanceFetch, acceptanceReservation } from './acceptance-budget.server'

let directory = ''
afterEach(() => { delete process.env.PIXEL_WORLD_ACCEPTANCE_LEDGER; vi.unstubAllGlobals(); if (directory) rmSync(directory, { recursive: true, force: true }) })
it('reserves all output tokens including reasoning and rejects unbounded vision', () => {
  expect(acceptanceReservation({ messages: [], max_tokens: 4000 }, false, 'anthropic/claude-sonnet-5.5')).toBeGreaterThan(0.04)
  expect(() => acceptanceReservation({ messages: [{ image_url: 'x' }], max_tokens: 1 }, false, 'openai/gpt-4.1-mini')).toThrow('vision')
})
it('prevents concurrent and failed image attempts from exceeding the image budget', async () => {
  directory = mkdtempSync(join(tmpdir(), 'pixel-budget-'))
  const path = join(directory, 'ledger.json')
  process.env.PIXEL_WORLD_ACCEPTANCE_LEDGER = path
  writeFileSync(path, JSON.stringify({code:'M-CN',textModel:'openai/gpt-4.1-mini',imageModel:'bytedance-seed/seedream-4.5',textCeilingUsd:0.6,imageCeilingUsd:0.04,maxImageRequestsIncludingFailures:1}))
  const upstream = vi.fn(async () => new Response('{"error":"failed"}', {status: 500}))
  vi.stubGlobal('fetch', upstream)
  const request = { method: 'POST', body: JSON.stringify({model:'bytedance-seed/seedream-4.5',n:1}) }
  await acceptanceFetch('https://openrouter.ai/api/v1/images', request)
  await expect(acceptanceFetch('https://openrouter.ai/api/v1/images', request)).rejects.toThrow('ceiling')
  expect(upstream).toHaveBeenCalledTimes(1)
  expect(JSON.parse(readFileSync(path, 'utf8')).calls[0].chargedUpperUsd).toBe(0.04)
})
it('rejects another model before sending a request', async () => {
  directory = mkdtempSync(join(tmpdir(), 'pixel-budget-'))
  const path = join(directory, 'ledger.json'); process.env.PIXEL_WORLD_ACCEPTANCE_LEDGER = path
  writeFileSync(path, JSON.stringify({textModel:'openai/gpt-4.1-mini',calls:[]}))
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream)
  await expect(acceptanceFetch('https://openrouter.ai/api/v1/chat/completions', {body:JSON.stringify({model:'other'})})).rejects.toThrow('model differs')
  expect(upstream).not.toHaveBeenCalled()
})
