/** Keep this factory self-contained: exported games run the same rules without imports. */
function createEnemyCombatRules() {
  function meleeHitbox(x: number, y: number, width: number, height: number, facing: number) {
    // Include the actor's body so an enemy that overlaps at point-blank range
    // does not fall behind the sword's forward-only hitbox. Forward reach stays 88px.
    return { x: facing >= 0 ? x : x - 88, y: y - 4, width: width + 88, height: height + 8 }
  }
  function usesRanged(behavior: string, mobility: string, spawnIndex: number): boolean {
    return behavior === 'ranged' || mobility !== 'ground' || spawnIndex % 3 === 2
  }

  function attackKind(ranged: boolean, boss: boolean, distance: number, width: number, elapsed: number, locked: boolean, verticalOverlap: boolean): 'ranged' | 'melee' | null {
    if (locked) return null
    if (ranged && Math.abs(distance) < (boss ? 480 : 360) && elapsed > (boss ? 1050 : 2200)) return 'ranged'
    if (!ranged && verticalOverlap && Math.abs(distance) < width + 24 && elapsed > 950) return 'melee'
    return null
  }

  function projectileDamage(damage: number, boss: boolean): number {
    return Math.round(damage * (boss ? 0.75 : 0.6))
  }

  function moveWithinPatrol(x: number, direction: number, distance: number, minX: number, maxX: number): number {
    return Math.max(minX, Math.min(maxX, x + direction * distance))
  }

  // Recompute from birth identity, never the survivor's current position in the array.
  function restoredRanged(actor: { uid?: string; phase?: number; mobility: string }, behavior: string): boolean {
    const suffix = actor.uid?.match(/-enemy-(\d+)$/)
    const spawnIndex = suffix ? Number(suffix[1]) : Math.round((actor.phase || 0) / 1.15)
    return usesRanged(behavior, actor.mobility, spawnIndex)
  }

  return { meleeHitbox, usesRanged, attackKind, projectileDamage, moveWithinPatrol, restoredRanged }
}

export const enemyCombatRules = createEnemyCombatRules()
export function offlineEnemyCombatSource(): string {
  return `const enemyCombatRules=(${createEnemyCombatRules.toString()})();`
}
