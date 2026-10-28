import { describe, expect, it } from 'vitest'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { buildAgentPrompts } from '@/lib/agents/prompts'
import { createFallbackGameSpec } from '@/lib/game-spec'
import type { AgentExecuteRequest } from '@/types'

describe('role-scoped Agent context', () => {
  it('does not send the asset schema for one-click creative completion', () => {
    const spec = createFallbackGameSpec('', '星潮群岛', 3)
    const prompts = buildAgentPrompts({ runId:'prompt-optimize-123', taskId:'integrator', role:'integrator', round:1, provider:'openrouter', model:'test', apiKey:'unused', sourcePrompt:'主角：蓝披风地图师\n地面敌人：\n背景：',projectName:'星潮群岛',levelCount:3,baseSpec:spec,artifacts:{} })
    expect(prompts.user).toContain('蓝披风地图师')
    expect(prompts.user).not.toContain('地面敌人：')
    expect(prompts.user).not.toContain('frameCount')
    expect(prompts.system).toContain('local compiler')
  })
  it('does not repeat unrelated history for the asset coordinator', () => {
    const template = PROMPT_TEMPLATES[0]
    const spec = createFallbackGameSpec(template.prompt, template.themeName, 5)
    const request: AgentExecuteRequest = {
      runId: 'run', taskId: 'assetCoordinator-1', role: 'assetCoordinator', round: 1,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: 'unused',
      sourcePrompt: template.prompt, projectName: template.themeName, levelCount: 5,
      baseSpec: spec,
      artifacts: {
        brief: { title: template.themeName, playerFantasy: 'knight', audience: 'players', pillars: ['combat'], explicitRequirements: ['five levels'], constraints: [], levelCount: 5 },
        mechanics: { intentionallyLargeAndIrrelevantHistory: 'DO_NOT_SEND_THIS_TO_COORDINATOR' },
        artDirection: { artDirection: 'cohesive 16-bit pixel art' },
      },
    }
    const prompts = buildAgentPrompts(request)
    expect(prompts.user).toContain('Current asset identity and visual plan')
    expect(prompts.user).not.toContain('DO_NOT_SEND_THIS_TO_COORDINATOR')
    expect(prompts.system).toMatch(/do not repeat the complete GameSpec/i)
  })

  it('keeps the Integrator request compact and asks for a partial patch', () => {
    const template = PROMPT_TEMPLATES[0]
    const spec = createFallbackGameSpec(template.prompt, template.themeName, 5)
    const request: AgentExecuteRequest = {
      runId: 'run', taskId: 'integrator-1', role: 'integrator', round: 1,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: 'unused',
      sourcePrompt: template.prompt.repeat(5), projectName: template.themeName, levelCount: 5,
      baseSpec: spec,
      artifacts: {
        brief: { title: template.themeName, playerFantasy: 'knight', audience: 'players', pillars: ['combat'], explicitRequirements: ['five levels'], constraints: [], levelCount: 5 },
        narrative: { backgroundStory: 'A concise story.' },
        mechanics: { combatMode: 'hybrid' },
        artDirection: { artDirection: 'cohesive 16-bit pixel art' },
        levelPlan: { levels: spec.levels },
      },
    }
    const prompts = buildAgentPrompts(request)
    expect(prompts.system).toMatch(/compact partial GameSpec V3 patch/i)
    expect(prompts.user.length).toBeLessThan(65000)
  })
})
