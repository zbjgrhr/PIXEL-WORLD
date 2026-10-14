import { describe, expect, it } from 'vitest'
import { createGenerationJobs, runGenerationJobs } from './asset-generation-queue'
import { createFallbackGameSpec } from './game-spec'

describe('image dependencies and scheduling', () => {
  it('starts an action before an unrelated background finishes', async () => {
    let releaseBackground!: () => void
    const background = new Promise<void>(resolve => { releaseBackground = resolve })
    const order: string[] = []
    await runGenerationJobs([
      {id:'background',assetId:'background',dependencies:[]},
      {id:'idle',assetId:'hero',dependencies:[]},
      {id:'walk',assetId:'hero',dependencies:['idle']},
    ], 2, async job => { order.push(job.id); if(job.id==='background') await background; if(job.id==='walk') releaseBackground() }, () => {})
    expect(order).toEqual(['background','idle','walk'])
  })
  it('does not pay for dependent actions when the identity image fails', async () => {
    const paid: string[] = [], blocked: string[] = []
    await runGenerationJobs([{id:'idle',assetId:'hero',dependencies:[]},{id:'walk',assetId:'hero',dependencies:['idle']}], 2, async job => { paid.push(job.id); throw Error('bad image') }, job => blocked.push(job.id))
    expect(paid).toEqual(['idle']); expect(blocked).toEqual(['walk'])
  })
  it('waits for the exact project weapon before producing attack strips', () => {
    const spec = createFallbackGameSpec('', 'Test', 1)
    const hero = spec.assets.find(asset => asset.category === 'hero')!
    const weapon = spec.assets.find(asset => asset.category === 'meleeWeapon')!
    const jobs = createGenerationJobs(spec.assets)
    expect(jobs.find(job => job.id === `${hero.id}:meleeAttack`)?.dependencies).toContain(weapon.id)
    expect(jobs.find(job => job.id === `${hero.id}:walk`)?.dependencies).toEqual([`${hero.id}:idle`])
  })
})
