import type { GameSpec } from '@/types'
import { normalizeGameSpec } from './game-spec'

/** Generated drafts can be refreshed; a player-edited draft remains the source of truth. */
export function mergeCompletedDraft(previous: GameSpec | null, fresh: GameSpec, levelCount: number): GameSpec {
  return previous?.narrative?.source.origin === 'player'
    ? normalizeGameSpec(previous, fresh, levelCount)
    : fresh
}
