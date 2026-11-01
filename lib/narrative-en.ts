import type { GameSpec, NarrativeSpec, StoryChapter, StoryObjective } from '@/types'
import { extractStoryAnchors } from './story-anchors'
import { separateStoryIntroduction } from './story-introduction'

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const sentence = (value: string) => /[.!?。！？]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const generic = (value: string) => !value.trim() || /^(?:Hero|World Guardian|World Stalker|Seedblade|Inner Seed|Level\s*\d+|A mysterious original)/i.test(value)

function readFields(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([^:：]{1,80})[:：]\s*(.+)$/)
    if (match) result[match[1].trim()] = match[2].trim()
  }
  return result
}

/** An authored English baseline. User text remains verbatim in its provenance. */
export function createEnglishNarrative(spec: GameSpec, sourcePrompt = '', originalStory?: string): NarrativeSpec {
  const playerFields = readFields(sourcePrompt)
  const rawField = (...keys: string[]) => keys.map(key => playerFields[key]).find(Boolean) || ''
  const englishText = (value: string) => /\p{Script=Han}/u.test(value) ? '' : value
  const field = (...keys: string[]) => englishText(rawField(...keys))
  const identities: Record<string, string> = { 小企鹅: 'Little penguin', 企鹅: 'Penguin', 熊猫: 'Panda', 小狐狸: 'Little fox', 狐狸: 'Fox', 小猫: 'Kitten', 小兔: 'Little rabbit', 日本: 'Japan', 日本世界: 'Japan', 中国: 'China', 月球: 'the Moon', 火星: 'Mars' }
  const identity = (value: string) => {
    const translated = identities[value] || value
    // Treat short unnamed animal labels as character names, rather than using
    // an English count noun without an article throughout the story.
    return /^(?:(?:little|young) )?(?:penguin|fox|rabbit|kitten|panda)$/i.test(translated)
      ? translated.replace(/\b[a-z]/g, letter => letter.toUpperCase()) : translated
  }
  const submittedStory = originalStory ?? (rawField('世界观与故事', 'World and story', '背景故事', 'Backstory', 'Story') || spec.narrative?.source.originalStory || '')
  const story = clean(submittedStory.split('【已选灵感】')[0].split('[Selected inspiration]')[0])
  const anchors = extractStoryAnchors(story)
  const nameFromDescription = (description: string) => description.match(/\b(?:named|called)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2})/)?.[1]
    || description.match(/^([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2})\s*[—–|]/)?.[1]
  const describedHeroName = nameFromDescription(field('主角 / Hero', '主角', 'Hero', 'Protagonist'))
  const describedBossName = nameFromDescription(field('BOSS', 'Boss', 'BOSS / Boss'))
  const hero = identity(rawField('主角姓名（可选）', '主角姓名', 'Protagonist name (optional)', 'Protagonist name') || describedHeroName || capital(anchors.hero || (!generic(spec.hero.name) ? spec.hero.name : 'The young explorer')))
  const boss = identity(rawField('对手姓名（可选）', '对手姓名', 'Opponent name (optional)', 'Opponent name') || describedBossName || capital(anchors.antagonist || (!generic(spec.boss.name) ? spec.boss.name : 'The gatekeeper')))
  const place = identity(anchors.place || (!generic(spec.world) && spec.world !== story && spec.world.length < 100 ? spec.world : 'the Lantern Coast'))
  const item = anchors.collectible || (!generic(spec.collectible.name) ? spec.collectible.name : 'trail tokens')
  const family = story.match(/\b(?:find|finds|finding|rescue|rescues|rescuing|reunite with|search for|searches for|looking for)\s+(?:(?:its|his|her|their|the|missing|lost|own)\s+)*(mother|mom|mum|father|sister|brother|family)\b/i)?.[1]
    || /(?:寻找|找回|找到|救出)(?:自己(?:的)?)?(妈妈|母亲)/.test(story) && 'mother'
  const statedGoal = story.match(/\b(?:wants? to|needs? to|must|sets? out to|in order to|trying to)\s+(.+?)(?=[.!?]|$)/i)?.[1]
    || story.match(/\bto\s+((?:repair|restore|relight|reactivate|find|rescue|recover|deliver|stop|defeat|collect)\s+.+?)(?=[.!?]|$)/i)?.[1]
  const goal = field('主角目标（可选）', '主角目标', 'Protagonist goal (optional)', 'Protagonist goal')
    || englishText(spec.creativeBrief?.heroGoal || '') || (family ? `find their ${family}` : statedGoal || `discover why the route through ${place} has been blocked`)
  const labels: Record<string, string[]> = {
    premise: ['故事概念', 'Premise'], incitingIncident: ['事件起因', 'Inciting incident'], motivation: ['主角动机', 'Protagonist motivation'],
    conflict: ['主要冲突', 'Central conflict'], bossRelation: ['Boss与故事的关系', 'Boss relationship'], resolution: ['结局方向', 'Resolution'], opening: ['开场剧情', 'Opening'], ending: ['结局剧情', 'Ending'],
  }
  for (const [key, aliases] of Object.entries(labels)) if (field(...aliases)) playerFields[`narrative.${key}`] = field(...aliases)
  const clue = field('关键线索', 'Key clue') || (family ? `a note recording the last known whereabouts of the missing ${family}` : `a route record bearing the same mark as the ${item}`)
  const payoff = field('线索回应', 'Clue payoff') || `The records collected along the route confirm that the final destination lies beyond ${boss}'s position.`
  const incident = field(...labels.incitingIncident) || `${hero} reaches ${place}, where monsters have blocked the route ahead.`
  const motivation = field(...labels.motivation) || `${hero} sets out to ${goal.replace(/[.!?。！？]+$/, '')}.`
  const relation = field(...labels.bossRelation) || `${boss} controls the final stretch of the route and prevents ${hero} from reaching the destination.`
  const explicitEnding = separateStoryIntroduction(story).ending
  const foreignEnding = /\p{Script=Han}/u.test(explicitEnding || '') || Boolean(rawField(...labels.ending, ...labels.resolution) && !field(...labels.ending, ...labels.resolution))
  const restoredEnding = explicitEnding && /^(?:finally|in the end|at last)\s+(?:finds|rescues|defeats|returns|reunites)\b/i.test(explicitEnding)
    ? explicitEnding.replace(/^(finally|in the end|at last)\s+/i, (_, lead: string) => `${capital(lead)}, ${hero} `) : explicitEnding
  const ending = field(...labels.ending) || field(...labels.resolution) || (foreignEnding
    ? /(?:妈妈|母亲).{0,8}(?:死|离世|去世)|(?:死|离世|去世).{0,8}(?:妈妈|母亲)/.test(rawField(...labels.ending, ...labels.resolution) || explicitEnding || '')
      ? `${hero} reaches the final destination and learns that their mother has died.`
      : /^(?:最后|最终)?[，,\s]*(?:小企鹅|企鹅|他|她|它)?(?:终于)?(?:找到了?|找回了?|救出了?)(?:自己(?:的)?)?(?:妈妈|母亲)[。！\s]*$/.test(explicitEnding || '')
        ? `${hero} defeats ${boss} and reaches the final destination. There, ${hero} finds their mother, and the two are reunited.`
      : 'The journey reaches its final destination. The outcome specified in the original brief still requires translation and review.'
    : restoredEnding ? sentence(capital(restoredEnding)) : family
    ? `${hero} defeats ${boss} and reaches the final destination. There, ${hero} finds their ${family}, and the two are reunited.`
    : `${hero} defeats ${boss} and follows the confirmed route to its destination. The journey through ${place} is complete.`)
  const premise = field(...labels.premise) || `${hero} travels through ${place} to ${goal.replace(/[.!?。！？]+$/, '')}, but monsters and ${boss} stand in the way.`
  const opening = field(...labels.opening) || `${incident} ${motivation} A discovery along the route may explain how to reach the final destination.`
  const actionMatch = story.match(/\b(repair|restore|relight|reactivate|light)\s+(one|two|three|four|five|[1-5])\s+([\w'-]+(?:\s+[\w'-]+){0,3}?)(?=\s+(?:and|to|before|after|so|while)\b|[,.;!?]|$)/i)
  const actionCount = actionMatch ? ({ one: 1, two: 2, three: 3, four: 4, five: 5 }[actionMatch[2].toLowerCase()] || Number(actionMatch[2])) : 0
  const actions = actionMatch && actionCount <= spec.levels.length * 2 ? Array.from({ length: actionCount }, (_, index) => ({
    index, levelIndex: Math.min(spec.levels.length - 1, Math.floor(index * spec.levels.length / actionCount)),
    verb: actionMatch[1].toLowerCase(), object: actionMatch[3],
  })) : []
  const chapters: StoryChapter[] = spec.levels.map((level, index) => {
    const last = index === spec.levels.length - 1
    const routes = /japan|日本/i.test(place) ? ['Seaside Village', 'Rice-Field Path', 'Bamboo Shrine'] : ['Outer Trail', 'Old Crossing', 'Final Approach']
    const routeIndex = last ? routes.length - 1 : Math.min(index, routes.length - 2)
    const title = generic(level.name) ? routes[routeIndex] + (!last && index > 1 ? ` ${index + 1}` : '') : level.name
    const next = spec.levels[index + 1]
    const point = { id: `${level.id}-beacon`, name: last ? 'Final route record' : 'Trail record', description: `Read the record left at ${title} to confirm the next part of the route.`, kind: 'interact' as const, position: last ? .62 : .48 }
    const points = [point]
    const objectives: StoryObjective[] = []
    if (level.collectibleCount > 0) objectives.push({ id: `${level.id}-collect`, kind: 'collect', target: 'collectible', count: Math.min(2, level.collectibleCount), description: `Collect ${Math.min(2, level.collectibleCount)} ${item}`, feedback: `${hero} gathers the ${item} and compares the marks with the earlier record.`, prerequisites: [] })
    objectives.push({ id: `${level.id}-interact`, kind: 'interact', target: point.id, count: 1, description: `Read the ${point.name.toLowerCase()} (approach and press E)`, feedback: last ? payoff : `The record confirms the route ahead. ${hero} now knows where to look next.`, prerequisites: objectives.filter(task => task.kind === 'collect').map(task => task.id) })
    const levelActions = actions.filter(action => action.levelIndex === index)
    levelActions.forEach((action, actionIndex) => {
      const singular = action.object.replace(/ies$/i, 'y').replace(/(?<!s)s$/i, '')
      const name = `${capital(singular)} ${action.index + 1}`
      const id = `${level.id}-story-point-${actionIndex}`
      points.push({ id, name, description: `${name} requires attention. Approach and press E to ${action.verb} it.`, kind: 'interact', position: Math.min(.8, .58 + actionIndex * .16) })
      objectives.push({ id: `${level.id}-story-action-${actionIndex}`, kind: 'interact', target: id, count: 1, description: `${capital(action.verb)} ${name} (approach and press E)`, feedback: `${hero} completes the work on ${name}.`, prerequisites: [`${level.id}-interact`] })
    })
    if (level.enemyCount > 0) objectives.push({ id: `${level.id}-defeat`, kind: 'defeat', target: 'enemies', count: level.enemyCount, description: `Defeat ${level.enemyCount} ${level.enemyCount === 1 ? 'enemy' : 'enemies'} in this area`, feedback: `The enemies blocking the route through ${title} have been defeated.`, prerequisites: [] })
    if (level.hasBoss) objectives.push({ id: `${level.id}-boss`, kind: 'boss', target: 'boss', count: 1, description: `Defeat ${boss}`, feedback: `${boss} can no longer block the way. ${hero} can proceed to the final exit.`, prerequisites: levelActions.map((_, actionIndex) => `${level.id}-story-action-${actionIndex}`) })
    objectives.push({ id: `${level.id}-exit`, kind: 'reach', target: 'exit', count: 1, description: last ? 'Reach the exit to finish the journey' : 'Reach the exit to continue', feedback: last ? `${hero} reaches the last destination, ready to complete the journey.` : 'The route to the next area is open.', prerequisites: objectives.map(task => task.id) })
    return { levelId: level.id, title,
      arrival: `${hero} enters ${title}. ${index === 0 ? `The first trace is ${clue}.` : last ? relation : 'The marks found in the previous area match the records here.'} ${level.collectibleCount ? `Gather the ${item} and read the local record` : 'Read the local record'}${levelActions.length ? ', then complete the work at the marked story point' : ''} before continuing.`,
      departure: last ? `${hero} passes the final checkpoint and approaches the journey's destination.` : `${hero} confirms the next part of the route and continues toward ${next && !generic(next.name) ? next.name : 'the next area'}.`,
      bossBefore: level.hasBoss ? `${boss} blocks the last part of the route. ${hero} must win this fight to continue.` : '',
      bossAfter: level.hasBoss ? `${boss} has been defeated. ${hero} can now proceed to the final exit.` : '', points, objectives }
  })
  if (anchors.hero || describedHeroName || field('主角姓名', '主角姓名（可选）', 'Protagonist name', 'Protagonist name (optional)')) playerFields['narrative.characters.hero.name'] = hero
  if (anchors.antagonist || describedBossName || field('对手姓名', '对手姓名（可选）', 'Opponent name', 'Opponent name (optional)')) playerFields['narrative.characters.boss.name'] = boss
  return { version: 1,
    source: { originalTitle: spec.title, originalStory: submittedStory, playerFields, lockedFields: {}, generatedFields: [...Object.keys(labels).filter(key => !playerFields[`narrative.${key}`]), 'chapters'], origin: 'rules' },
    premise, incitingIncident: incident, motivation,
    conflict: field(...labels.conflict) || `Monsters and ${boss} obstruct the route through ${place}, preventing ${hero} from completing the journey.`,
    bossRelation: relation, resolution: field(...labels.resolution) || ending, opening, ending,
    characters: [{ id: 'hero', name: hero, role: 'Protagonist', motivation, relationship: field('人物关系', 'Character relationships') || `${hero} must overcome ${boss}'s blockade to ${goal.replace(/[.!?。！？]+$/, '')}.` }, { id: 'boss', name: boss, role: 'Final opponent', motivation: relation, relationship: `${boss} opposes ${hero} at the end of the route.` }],
    clues: [{ id: 'main-clue', setup: clue, payoff, levelId: spec.levels[0]?.id || 'level-1', payoffLevelId: spec.levels.at(-1)?.id || 'level-1' }], chapters }
}

/** Avoid applying Chinese template worlds when upgrading an English work. */
export function englishNarrativeSpec(spec: GameSpec, narrative: NarrativeSpec): GameSpec {
  const hero = narrative.characters.find(character => character.id === 'hero')?.name || spec.hero.name
  const boss = narrative.characters.find(character => character.id === 'boss')?.name || spec.boss.name
  const anchors = extractStoryAnchors(narrative.source.originalStory)
  const levels = spec.levels.map((level, index) => {
    const title = narrative.chapters[index]?.title || level.name
    return { ...level, name: generic(level.name) ? title : level.name,
      environment: /region\s*\d|progressively stronger atmosphere|A mysterious original|^(?:Approach to|A distinct route through|Final confrontation at)/.test(level.environment)
        ? `${title}${anchors.place ? ` in ${anchors.place}` : ''}; a side-view pixel environment with a clear traversal lane and space for combat.` : level.environment }
  })
  const world = narrative.opening.match(/reaches (.+?), where monsters/)?.[1] || anchors.place || (generic(spec.world) || spec.world === spec.backgroundStory ? 'The Lantern Coast' : spec.world)
  return { ...spec, narrative, world, backgroundStory: narrative.opening,
    creativeBrief: { ...spec.creativeBrief, heroGoal: /\p{Script=Han}/u.test(spec.creativeBrief?.heroGoal || '') ? narrative.motivation : spec.creativeBrief?.heroGoal || narrative.motivation },
    hero: { ...spec.hero, name: hero }, boss: { ...spec.boss, name: boss },
    enemies: spec.enemies.map(enemy => ({ ...enemy, name: generic(enemy.name) ? (/japan|日本/i.test(anchors.place || '') ? 'Lantern spirit' : 'Trail creature') : enemy.name })),
    weapon: { ...spec.weapon, name: generic(spec.weapon.name) ? 'Travel staff' : spec.weapon.name },
    collectible: { ...spec.collectible, name: anchors.collectible || (generic(spec.collectible.name) ? 'trail tokens' : spec.collectible.name) }, levels,
    assets: spec.assets.map(asset => {
      if (asset.url || asset.category !== 'levelBackground') return asset
      const level = levels.find(level => asset.levelIds.includes(level.id))
      return level ? { ...asset, prompt: `Environment-only side-view pixel art. ${level.environment} No characters, no text.` } : asset
    }) }
}
