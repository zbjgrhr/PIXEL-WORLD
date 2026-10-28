import type { NarrativeSpec } from '@/types'

/** Paths use stable IDs so reordering chapters never moves a player's lock. */
export function recordNarrativeEdit(narrative: NarrativeSpec, path: string, value: string): NarrativeSpec {
  const lockedFields = { ...narrative.source.lockedFields }
  if (path in lockedFields) lockedFields[path] = value
  return { ...narrative, source: { ...narrative.source, origin: 'player', lockedFields,
    playerFields: { ...narrative.source.playerFields, [`narrative.${path}`]: value },
    generatedFields: narrative.source.generatedFields.filter(field => field !== path),
  } }
}

export function applyNarrativeLocks(narrative: NarrativeSpec): NarrativeSpec {
  const locks = narrative.source.lockedFields
  const text = (path: string, value: string) => locks[path] === undefined ? value : locks[path]
  return {
    ...narrative,
    characters: narrative.characters.map(character => ({ ...character,
      name: text(`characters.${character.id}.name`, character.name),
      motivation: text(`characters.${character.id}.motivation`, character.motivation),
      relationship: text(`characters.${character.id}.relationship`, character.relationship),
    })),
    clues: narrative.clues.map(clue => ({ ...clue,
      setup: text(`clues.${clue.id}.setup`, clue.setup), payoff: text(`clues.${clue.id}.payoff`, clue.payoff),
      levelId: text(`clues.${clue.id}.levelId`, clue.levelId), payoffLevelId: text(`clues.${clue.id}.payoffLevelId`, clue.payoffLevelId),
    })),
    chapters: narrative.chapters.map(chapter => {
      const prefix = `chapters.${chapter.levelId}`
      return { ...chapter, title: text(`${prefix}.title`, chapter.title), arrival: text(`${prefix}.arrival`, chapter.arrival),
        departure: text(`${prefix}.departure`, chapter.departure), bossBefore: text(`${prefix}.bossBefore`, chapter.bossBefore), bossAfter: text(`${prefix}.bossAfter`, chapter.bossAfter),
        points: chapter.points.map(point => ({ ...point, name: text(`${prefix}.points.${point.id}.name`, point.name), description: text(`${prefix}.points.${point.id}.description`, point.description) })),
        objectives: chapter.objectives.map(task => ({ ...task, description: text(`${prefix}.objectives.${task.id}.description`, task.description), feedback: text(`${prefix}.objectives.${task.id}.feedback`, task.feedback) })),
      }
    }),
  }
}

/** Keep repeated references aligned; explicit text locks always win. */
export function replaceNarrativeReference(narrative: NarrativeSpec, before: string, after: string): NarrativeSpec {
  if (!before || before === after) return narrative
  const replace = (text: string) => text.split(before).join(after)
  const next = { ...narrative,
    clues: narrative.clues.map(c => ({ ...c, setup: replace(c.setup), payoff: replace(c.payoff) })),
    characters: narrative.characters.map(c => ({ ...c, motivation: replace(c.motivation), relationship: replace(c.relationship) })),
    chapters: narrative.chapters.map(c => ({ ...c, arrival: replace(c.arrival), departure: replace(c.departure), bossBefore: replace(c.bossBefore), bossAfter: replace(c.bossAfter),
      points: c.points.map(p => ({ ...p, description: replace(p.description) })), objectives: c.objectives.map(o => ({ ...o, description: replace(o.description), feedback: replace(o.feedback) })),
    })),
  }
  for (const key of ['premise', 'incitingIncident', 'motivation', 'conflict', 'bossRelation', 'resolution', 'opening', 'ending'] as const) next[key] = narrative.source.lockedFields[key] ?? replace(narrative[key])
  return applyNarrativeLocks(next)
}
