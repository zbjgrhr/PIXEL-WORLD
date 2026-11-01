import type { AgentRun, GameSpec } from '@/types'
import { pendingNarrativeSuggestions, sameSpecExceptSuggestions } from '@/lib/narrative-suggestions'

function withoutMedia(spec: GameSpec): GameSpec {
  return { ...spec, assets: spec.assets.map(asset => ({ ...asset, url: undefined, status: 'pending' as const, error: undefined,
    animation: asset.animation?.clips ? { ...asset.animation, clips: Object.fromEntries(Object.entries(asset.animation.clips).map(([pose, clip]) => [pose, clip ? { ...clip, url: undefined, status: 'pending' as const, error: undefined } : clip])) } : asset.animation,
  })) }
}

/** Reviewing wording alone must preserve model lock, task results, approval and gameplay content. */
export function updateRunNarrativeDecisions(run: AgentRun, spec: GameSpec): AgentRun {
  if (['planning', 'reviewing', 'quality_check'].includes(run.status) || run.tasks.some(task => task.status === 'running')) return run
  const current = run.artifacts.productionSpec || run.artifacts.revisedSpec || run.artifacts.mergedSpec
  if (!current?.narrative || !spec.narrative || !sameSpecExceptSuggestions(withoutMedia(current), withoutMedia(spec))) return run
  // The editor spec may contain hydrated media while the run artifact stores
  // only metadata. Copy decisions by suggestion ID, never compare whole specs.
  const decisions = new Map((spec.narrative.suggestions || []).map(item => [item.id, item.status]))
  const replace = (candidate?: GameSpec) => candidate?.narrative ? {
    ...candidate,
    narrative: { ...candidate.narrative, suggestions: candidate.narrative.suggestions?.map(item => ({
      ...item, status: decisions.get(item.id) || item.status,
    })) },
  } : candidate
  const updatedProduction = replace(run.artifacts.productionSpec)
  if (pendingNarrativeSuggestions(spec).length === 0 && pendingNarrativeSuggestions(updatedProduction || current).length) return run
  return { ...run, updatedAt: Date.now(), artifacts: { ...run.artifacts,
    ...(run.artifacts.productionSpec ? { productionSpec: replace(run.artifacts.productionSpec) } : {}),
    ...(run.artifacts.revisedSpec ? { revisedSpec: replace(run.artifacts.revisedSpec) } : {}),
    ...(run.artifacts.mergedSpec ? { mergedSpec: replace(run.artifacts.mergedSpec) } : {}),
  }, tasks: run.tasks.map(task => {
    const outputSpec = task.output?.spec as GameSpec | undefined
    return outputSpec ? { ...task, output: { ...task.output, spec: replace(outputSpec) } } : task
  }) }
}
