import { describe, expect, it } from 'vitest'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { agentCreationLanguage, buildAgentPrompts } from '@/lib/agents/prompts'
import { assertAgentOutputLanguage, deterministicAgentResponse, prepareAgentRequest } from './execution'
import { PROFESSIONAL_AGENT_ROLES, SYSTEM_AGENT_ROLES } from './config'
import { createFallbackGameSpec } from '@/lib/game-spec'
import type { AgentExecuteRequest } from '@/types'

describe('role-scoped Agent context', () => {
  const englishRequest: AgentExecuteRequest = { runId: 'english-run', taskId: 'narrative-r1', role: 'narrative', round: 1, provider: 'openrouter', model: 'test', apiKey: '', creationLanguage: 'en', sourcePrompt: 'A penguin in Japan defeats a panda boss and finds its mother.', projectName: 'Penguin Reunion', levelCount: 3, artifacts: {} }

  it('uses the project language for every specialist without Chinese-only length limits', () => {
    for (const role of [...PROFESSIONAL_AGENT_ROLES, ...SYSTEM_AGENT_ROLES]) {
      const { system } = buildAgentPrompts({ ...englishRequest, role })
      expect(system, role).toContain('Project creation language: English (en)')
      expect(system, role).not.toMatch(/natural (?:Simplified )?Chinese|Chinese characters|Chinese sentence|Chinese for names|its Chinese description/)
      expect(system, role).toContain('Image prompts remain concise English')
      expect(system, role).toContain('stable IDs')
    }
  })

  it('applies the same English policy to the one-click optimizer Agent', () => {
    const { system } = buildAgentPrompts({ ...englishRequest, runId: 'prompt-optimize-en', role: 'integrator' })
    expect(system).toContain('idiomatic English for names and story')
    expect(system).not.toContain('natural Chinese')
  })

  it('preserves Chinese defaults for older requests and derives language from the GameSpec', () => {
    expect(agentCreationLanguage({ ...englishRequest, creationLanguage: undefined })).toBe('zh-CN')
    const baseSpec = { ...createFallbackGameSpec('', 'English', 1), creationLanguage: 'en' as const }
    const request = prepareAgentRequest({ ...englishRequest, creationLanguage: undefined, baseSpec })
    expect(request.creationLanguage).toBe('en')
    expect(buildAgentPrompts({ ...request, creationLanguage: 'zh-CN' }).system).toContain('natural Simplified Chinese')
  })

  it('rejects wrong-language generated prose while allowing original source and proper names', () => {
    expect(() => assertAgentOutputLanguage(englishRequest, { artifact: { narrative: { opening: '小企鹅穿过日本的海边村庄，寻找失散已久的母亲。' } } })).toThrow('returned Chinese prose')
    expect(() => assertAgentOutputLanguage(englishRequest, { summary: 'The story preserves the player’s requirements.', artifact: { narrative: { opening: 'The penguin crosses Kyoto to find its mother.', characters: [{ name: '小企鹅' }], source: { originalStory: '小企鹅穿过日本的海边村庄，寻找失散已久的母亲。' } } } })).not.toThrow()
    expect(() => assertAgentOutputLanguage({ ...englishRequest, creationLanguage: 'zh-CN' }, { summary: '小企鹅穿过日本的海边村庄，寻找失散已久的母亲。' })).not.toThrow()
  })

  it('retains English project metadata through local integration and programmatic checks', () => {
    const baseSpec = createFallbackGameSpec(englishRequest.sourcePrompt, englishRequest.projectName, 3, 'en')
    const integrated = deterministicAgentResponse({ ...englishRequest, role: 'integrator', baseSpec })!
    expect((integrated.data!.artifact.spec as typeof baseSpec).creationLanguage).toBe('en')
    expect(integrated.data!.summary).toContain('integrated and checked locally')
    const qa = deterministicAgentResponse({ ...englishRequest, role: 'engineQa', baseSpec })!
    expect(qa.data!.summary).toContain('No text model was called')
    expect(qa.data!.summary).not.toMatch(/[\u3400-\u9fff]/)
    const playtest = deterministicAgentResponse({ ...englishRequest, role: 'playtest', baseSpec })!
    expect(playtest.data!.summary).toContain('No actual playtest record')
    expect(playtest.data!.artifact.status).toBe('not-tested')
  })

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
