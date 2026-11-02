import {afterEach,expect,it,vi} from 'vitest'
import {exportGameZip,gameZipFileName} from './export-game'
import {createFallbackGameSpec} from './game-spec'
afterEach(()=>vi.unstubAllGlobals())
it('preserves the player title in the actual ZIP download',async()=>{
  const spec=createFallbackGameSpec('双关机关冒险','小鳄鱼找妈妈 第2关',2)
  spec.assets=spec.assets.map(a=>({...a,enabled:false}))
  const anchor={href:'',download:'',click:vi.fn()}
  vi.stubGlobal('document',{createElement:()=>anchor})
  vi.stubGlobal('URL',{createObjectURL:()=> 'blob:test',revokeObjectURL:vi.fn()})
  vi.stubGlobal('window',{setTimeout:vi.fn()})
  await exportGameZip(spec)
  expect(anchor.download).toBe('小鳄鱼找妈妈 第2关.zip');expect(anchor.click).toHaveBeenCalledOnce()
})
it('keeps readable case and handles unsafe or reserved filename titles',()=>{
  expect(gameZipFileName('My World 2')).toBe('My World 2.zip')
  expect(gameZipFileName('世界:关卡/一?')).toBe('世界-关卡-一-.zip')
  expect(gameZipFileName('CON')).toBe('_CON.zip')
  expect(gameZipFileName(' ... ')).toBe('pixel-world.zip')
  expect(gameZipFileName('龙'.repeat(100))).toBe('龙'.repeat(60)+'.zip')
})
