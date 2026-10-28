import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { alignSpriteCells, inspectSingleCharacterSprite, inspectSpriteImage, processGeneratedImage } from './image-quality.server'
import { removeChromaGreenBackground } from './image-cutout'

async function fixture(colors: string[], background = '#00ff00') {
  return sharp({ create: { width: colors.length * 100, height: 100, channels: 4, background } })
    .composite(await Promise.all(colors.map(async (color, index) => ({
      input: await sharp({ create: { width: 34, height: 70, channels: 4, background: color } }).png().toBuffer(),
      left: index * 100 + 33, top: 15,
    })))).png().toBuffer()
}

describe('generated sprites use actual image pixels', () => {
  it('rejects a scenic square mislabeled as a three-frame strip', async () => {
    const scene = await sharp({ create: { width: 300, height: 100, channels: 4, background: '#445577' } }).png().toBuffer()
    await expect(inspectSpriteImage(scene, 3)).rejects.toThrow(/场景底图/)
  })
  it('rejects an empty animation cell instead of slicing a single character', async () => {
    const single = await fixture(['#ab4422', '#00ff00', '#00ff00'])
    await expect(inspectSpriteImage(await removeChromaGreenBackground(single, true), 3)).rejects.toThrow(/没有角色/)
  })
  it('accepts separated transparent cells and catches a different character palette', async () => {
    const good = await removeChromaGreenBackground(await fixture(['#bb5522', '#bb5522', '#bb5522']), true)
    expect((await inspectSpriteImage(good, 3)).frames).toHaveLength(3)
    const bad = await removeChromaGreenBackground(await fixture(['#bb5522', '#2244bb', '#bb5522']), true)
    await expect(inspectSpriteImage(bad, 3)).rejects.toThrow(/配色/)
  })
  it('preserves green costume pixels enclosed inside a character', async () => {
    const sprite = await fixture(['#994422'])
    const detail = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#00ff00' } }).png().toBuffer()
    const result = await removeChromaGreenBackground(await sharp(sprite).composite([{ input: detail, left: 45, top: 40 }]).png().toBuffer(), true)
    const { data } = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[(45 * 100 + 50) * 4 + 3]).toBe(255)
    expect(data[3]).toBe(0)
  })
  it('never silently accepts a failed cutout', async () => {
    const opaque = await fixture(['#664488'], '#223355')
    await expect(processGeneratedImage('data:image/png;base64,' + opaque.toString('base64'), { cutout: 'chroma-green', isolated: true })).rejects.toThrow()
  })
  it('removes large enclosed key pockets between limbs while keeping small green details', async () => {
    const body = await sharp({create:{width:160,height:160,channels:4,background:'#334488'}}).png().toBuffer()
    const pocket = await sharp({create:{width:55,height:55,channels:4,background:'#00ff00'}}).png().toBuffer()
    const input = await sharp({create:{width:200,height:200,channels:4,background:'#00ff00'}}).composite([{input:body,left:20,top:20},{input:pocket,left:60,top:80}]).png().toBuffer()
    const {data} = await sharp(await removeChromaGreenBackground(input,true)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    expect(data[(100*200+80)*4+3]).toBe(0)
    expect(data[(40*200+40)*4+3]).toBe(255)
  })
  it('removes pale lime key backgrounds returned by Seedream', async () => {
    const result = await processGeneratedImage('data:image/png;base64,' + (await fixture(['#664488'], '#a3ed50')).toString('base64'), { cutout: 'chroma-green', isolated: true, preserveCanvas: true, frameCount: 1 })
    expect((await inspectSpriteImage(Buffer.from(result.split(',')[1], 'base64'))).transparentRatio).toBeGreaterThan(.5)
  })
  it('aligns valid action frames to square cells without cropping character detail', async () => {
    const input = await removeChromaGreenBackground(await fixture(['#bb5522', '#bb5522', '#bb5522']), true)
    const result = await alignSpriteCells(input, 3)
    const check = await inspectSpriteImage(result, 3)
    expect(check.width).toBe(1536)
    expect(check.height).toBe(512)
    expect(check.frames.every(frame => frame.borderCoverage === 0)).toBe(true)
  })
  it('rejects multiple figures inside one idle frame while accepting a single figure', async () => {
    const body = await sharp({ create: { width: 80, height: 180, channels: 4, background: '#bb5522' } }).png().toBuffer()
    const single = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00000000' } }).composite([{ input: body, left: 100, top: 170 }]).png().toBuffer()
    const crowded = await sharp(single).composite([{ input: body, left: 330, top: 170 }]).png().toBuffer()
    await expect(inspectSingleCharacterSprite(single)).resolves.toBeUndefined()
    await expect(inspectSingleCharacterSprite(crowded)).rejects.toThrow(/多个角色/)
    await expect(processGeneratedImage('data:image/png;base64,' + crowded.toString('base64'), { cutout: null, isolated: true, preserveCanvas: true, frameCount: 1, strictSingleCharacter: true })).rejects.toThrow(/多个角色/)
  })
})
