/** A collision is a gameplay event, not evidence that the simulation has stopped. */
export function createTraversalHints() {
  let until = 0
  function clear() { until = 0 }
  function observe(now: number, obstacleType: string | undefined, groundedMovement: boolean) {
    if (Number.isFinite(now) && now >= 0 && groundedMovement && ['normalObstacle', 'bounceObstacle', 'airPlatform'].includes(obstacleType || '')) until = now + 2500
  }
  function message(now: number): string | null {
    return Number.isFinite(now) && now >= 0 && now < until ? '前方有障碍，按 W / 空格 / ↑ 跳过去，也可以点“跳跃”。' : null
  }
  return { clear, observe, message }
}

export function offlineTraversalHintSource(): string {
  return `const createTraversalHints=(${createTraversalHints.toString()});`
}
