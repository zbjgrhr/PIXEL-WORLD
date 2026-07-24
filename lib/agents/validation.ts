import { animationClipPoses, normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AgentIssue, AgentRole, AssetCategory, GameSpec } from '@/types'

function issue(source: AgentRole, severity: AgentIssue['severity'], path: string, message: string, suggestion: string): AgentIssue {
  return {
    id: `${source}-${path}-${message}`.replace(/[^a-z0-9-]+/gi, '-').slice(0, 120),
    severity,
    source,
    path,
    message,
    suggestion,
  }
}

function enabledAssets(spec: GameSpec, category: AssetCategory) {
  return spec.assets.filter((asset) => asset.enabled && asset.category === category)
}

export function inspectGameSpec(spec: GameSpec, source: AgentRole = 'engineQa'): AgentIssue[] {
  const issues: AgentIssue[] = []
  const required: Array<[AssetCategory, string]> = [
    ['hero', '主角'], ['meleeWeapon', '近战武器'], ['rangedWeapon', '远程武器'],
    ['rangedProjectile', '远程弹射物'], ['rangedAttackEffect', '远程攻击特效'],
    ['collectible', '收集品'], ['boss', 'Boss'], ['groundPlatform', '地面平台'],
  ]
  for (const [category, label] of required) {
    if (!enabledAssets(spec, category).length) {
      issues.push(issue(source, 'blocking', `assets.${category}`, `缺少已启用的${label}素材。`, `新增并启用 ${category} 素材。`))
    }
  }

  if (!spec.levels.length) issues.push(issue(source, 'blocking', 'levels', '游戏没有任何关卡。', '至少建立一个关卡。'))
  spec.levels.forEach((level, index) => {
    const background = enabledAssets(spec, 'levelBackground').some((asset) => asset.levelIds.includes(level.id))
    if (!background) issues.push(issue(source, 'blocking', `levels.${index}.background`, `${level.name} 没有关卡背景。`, '为该关卡分配一个 levelBackground。'))
    if (level.enemyCount < 1 && !level.hasBoss) issues.push(issue(source, 'warning', `levels.${index}.enemyCount`, `${level.name} 没有普通敌人。`, '至少配置一个与难度相符的敌人。'))
    if (level.collectibleCount < 1) issues.push(issue(source, 'warning', `levels.${index}.collectibleCount`, `${level.name} 没有收集品。`, '至少配置一个收集品以形成探索目标。'))
  })

  const bossLevels = spec.levels.filter((level) => level.hasBoss)
  const finalLevel = spec.levels[spec.levels.length - 1]
  if (!finalLevel?.hasBoss) issues.push(issue(source, 'blocking', 'levels.last.hasBoss', '最终关没有启用 Boss。', '将最终关 hasBoss 设为 true。'))
  if (bossLevels.length > 1) issues.push(issue(source, 'warning', 'levels.hasBoss', '多个关卡被设为最终 Boss 战。', '第一版仅保留最终关 Boss。'))

  for (const asset of spec.assets.filter((candidate) => candidate.enabled)) {
    const invalid = asset.levelIds.filter((id) => !spec.levels.some((level) => level.id === id))
    if (invalid.length) issues.push(issue(source, 'blocking', `assets.${asset.id}.levelIds`, `${asset.title} 引用了不存在的关卡。`, '移除无效关卡 ID 并重新分配。'))
    if (!asset.prompt.trim() && (asset.kind === 'image' || asset.kind === 'spriteSheet')) {
      issues.push(issue(source, 'blocking', `assets.${asset.id}.prompt`, `${asset.title} 没有生成描述。`, '补充只描述该素材本身的提示词。'))
    }
  }

  if (spec.hero.maxHealth <= 0 || spec.hero.moveSpeed <= 0 || spec.hero.jumpPower <= 0) {
    issues.push(issue(source, 'blocking', 'hero', '主角生命、速度或跳跃参数无效。', '使用大于零且位于引擎范围内的数值。'))
  }
  if (spec.weapon.meleeDamage <= 0 || spec.weapon.rangedDamage <= 0 || spec.weapon.projectileSpeed <= 0) {
    issues.push(issue(source, 'blocking', 'weapon', '近战或远程战斗参数不完整。', '补齐伤害、冷却和弹射物速度。'))
  }
  return dedupeIssues(issues)
}

export function inspectVisualAssets(spec: GameSpec): AgentIssue[] {
  const issues: AgentIssue[] = []
  for (const asset of spec.assets.filter((item) => item.enabled && (item.kind === 'image' || item.kind === 'spriteSheet'))) {
    if (asset.kind === 'spriteSheet') {
      const animation = normalizeAnimationSpec(asset.animation)
      for (const pose of animationClipPoses(asset)) {
        const clip = animation.clips?.[pose]
        if (!clip?.url) issues.push(issue('visualQa', 'blocking', `assets.${asset.id}.animation.${pose}`, `${asset.title} 缺少 ${pose} 动作条。`, `重新生成 ${pose} 动作。`))
        if (clip && (clip.frameCount < 1 || clip.frameCount > 3)) issues.push(issue('visualQa', 'blocking', `assets.${asset.id}.animation.${pose}.frameCount`, `${asset.title} 的 ${pose} 帧数超出引擎规则。`, '将动作条限制为 1～3 帧。'))
      }
    } else if (!asset.url) {
      issues.push(issue('visualQa', 'blocking', `assets.${asset.id}.url`, `${asset.title} 尚未生成。`, '生成该素材后再执行发布检查。'))
    }
  }
  return dedupeIssues(issues)
}

export function inspectPlayability(spec: GameSpec): AgentIssue[] {
  const issues = inspectGameSpec(spec, 'playtest')
  if (!spec.assets.some((asset) => asset.enabled && asset.category === 'meleeAttackEffect')) {
    issues.push(issue('playtest', 'warning', 'assets.meleeAttackEffect', '近战攻击缺少可见反馈。', '启用近战攻击特效。'))
  }
  const boss = enabledAssets(spec, 'boss')
  const finalLevel = spec.levels[spec.levels.length - 1]
  if (finalLevel && !boss.some((asset) => asset.levelIds.includes(finalLevel.id))) {
    issues.push(issue('playtest', 'blocking', 'assets.boss.levelIds', 'Boss 没有被分配到最终关。', '把 Boss 及其攻击素材分配到最终关。'))
  }
  const usableEnemies = spec.assets.filter((asset) => asset.enabled && ['groundEnemy', 'airEnemy', 'waterEnemy'].includes(asset.category))
  spec.levels.forEach((level, index) => {
    if (level.enemyCount > 0 && !usableEnemies.some((asset) => asset.levelIds.includes(level.id))) {
      issues.push(issue('playtest', 'blocking', `levels.${index}.enemies`, `${level.name} 需要敌人但没有分配可用敌人素材。`, '为该关卡分配至少一种敌人。'))
    }
  })
  return dedupeIssues(issues)
}

export function sanitizeIssues(value: unknown, fallbackSource: AgentRole): AgentIssue[] {
  if (!Array.isArray(value)) return []
  return dedupeIssues(value.slice(0, 40).map((candidate, index) => {
    const item = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
    const severity = item.severity === 'blocking' || item.severity === 'warning' ? item.severity : 'info'
    return {
      id: typeof item.id === 'string' ? item.id : `${fallbackSource}-${index}`,
      severity,
      source: fallbackSource,
      path: typeof item.path === 'string' ? item.path.slice(0, 160) : 'spec',
      message: typeof item.message === 'string' ? item.message.slice(0, 500) : 'Agent reported an unspecified issue.',
      suggestion: typeof item.suggestion === 'string' ? item.suggestion.slice(0, 500) : 'Review this field.',
    }
  }))
}

export function dedupeIssues(issues: AgentIssue[]): AgentIssue[] {
  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = `${item.severity}:${item.path}:${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function countBlockingIssues(issues: AgentIssue[]): number {
  return issues.filter((item) => item.severity === 'blocking').length
}
