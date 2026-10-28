import type { AgentRun, GameSpec } from '@/types'
import { sameSpecExceptSuggestions } from '@/lib/narrative-suggestions'

/** Reviewing wording alone must preserve model lock, task results, approval and gameplay content. */
export function updateRunNarrativeDecisions(run: AgentRun, spec: GameSpec): AgentRun {
  if (['planning', 'reviewing', 'quality_check'].includes(run.status) || run.tasks.some(task => task.status === 'running')) return run
  const current = run.artifacts.productionSpec || run.artifacts.revisedSpec || run.artifacts.mergedSpec
  if (!current || !sameSpecExceptSuggestions(current, spec)) return run
  const replace = (candidate?: GameSpec) => candidate && sameSpecExceptSuggestions(candidate, spec) ? { ...candidate, narrative: spec.narrative } : candidate
  return { ...run, updatedAt: Date.now(), artifacts: { ...run.artifacts, productionSpec: replace(run.artifacts.productionSpec), revisedSpec: replace(run.artifacts.revisedSpec), mergedSpec: replace(run.artifacts.mergedSpec) }, tasks: run.tasks.map(task => {
    const outputSpec = task.output?.spec as GameSpec | undefined
    return outputSpec && sameSpecExceptSuggestions(outputSpec, spec) ? { ...task, output: { ...task.output, spec: replace(outputSpec) } } : task
  }) }
}
