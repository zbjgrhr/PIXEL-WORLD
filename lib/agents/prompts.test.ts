import { describe, expect, it } from 'vitest'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { buildAgentPrompts } from '@/lib/agents/prompts'
import { createFallbackGameSpec } from '@/lib/game-spec'
import type { AgentExecuteRequest } from '@/types'

describe('role-scoped Agent context', () => {
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
    expect(prompts.user).toContain('Current finalized GameSpec')
    expect(prompts.user).not.toContain('DO_NOT_SEND_THIS_TO_COORDINATOR')
    expect(prompts.system).toMatch(/do not repeat the complete GameSpec/i)
  })
})
