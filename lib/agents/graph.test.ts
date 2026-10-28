import { describe, expect, it } from 'vitest'
import { createPlanningTasks, createQualityTasks, runnableTasks, taskId } from './graph'

describe('Agent planning DAG', () => {
  it('establishes the narrative before unlocking mechanics and art', () => {
    const tasks = createPlanningTasks()
    expect(runnableTasks(tasks).map((task) => task.role)).toEqual(['director'])

    const afterDirector = tasks.map((task) => task.role === 'director' ? { ...task, status: 'completed' as const } : task)
    expect(runnableTasks(afterDirector).map((task) => task.role)).toEqual(['narrative'])
    const afterNarrative = afterDirector.map(task => task.role === 'narrative' ? { ...task, status: 'completed' as const } : task)
    expect(runnableTasks(afterNarrative).map(task => task.role)).toEqual(['mechanics', 'artDirector'])
  })

  it('requires both quality reports before Publisher can run', () => {
    const quality = createQualityTasks()
    expect(runnableTasks(quality).map((task) => task.role)).toEqual(['visualQa', 'playtest'])

    const afterChecks = quality.map((task) => task.role === 'publisher' ? task : { ...task, status: 'completed' as const })
    expect(runnableTasks(afterChecks).map((task) => task.id)).toEqual([taskId('publisher')])
  })
})
