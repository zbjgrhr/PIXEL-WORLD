export type InspirationTarget = 'story' | 'style'

export interface InspirationIdea {
  kind: '世界' | '主角' | '冲突' | '目标' | '画风'
  target: InspirationTarget
  tone: 'sea' | 'forest' | 'violet' | 'coral' | 'gold'
  variants: readonly [string, string]
}

export interface InspirationPack {
  id: string
  name: string
  ideas: readonly InspirationIdea[]
}

// Each pack is one coherent world. Its alternate sentences add compatible details.
export const INSPIRATION_PACKS: readonly InspirationPack[] = [
  {
    id: 'star-tides', name: '星潮群岛', ideas: [
      { kind: '世界', target: 'story', tone: 'sea', variants: ['群岛会随着潮汐缓缓升降', '岛屿之间由古老的星光桥相连'] },
      { kind: '主角', target: 'story', tone: 'violet', variants: ['主角是一名修理飞行船的年轻地图师', '这名地图师能从星轨辨认失落航线'] },
      { kind: '冲突', target: 'story', tone: 'coral', variants: ['海雾正在吞没通往家园的航线', '守护航线的灯塔正一座接一座熄灭'] },
      { kind: '目标', target: 'story', tone: 'forest', variants: ['收集星火，重新点亮三座灯塔', '找到失踪的船队并打通回家的航路'] },
      { kind: '画风', target: 'style', tone: 'gold', variants: ['明亮的侧视像素风，青蓝海面配珊瑚橙灯光', '统一 16-bit 像素比例，星光与岛屿轮廓清晰'] },
    ],
  },
  {
    id: 'moon-forest', name: '月影森林', ideas: [
      { kind: '世界', target: 'story', tone: 'forest', variants: ['森林小路每到夜晚都会重新排列', '古树的枝叶托起通往月亮的浮空平台'] },
      { kind: '主角', target: 'story', tone: 'violet', variants: ['主角是照顾月光种子的见习园丁', '这名园丁能唤醒沉睡植物为自己开路'] },
      { kind: '冲突', target: 'story', tone: 'coral', variants: ['影藤正在夺走古树的月光', '村庄周围的花朵一夜之间停止开放'] },
      { kind: '目标', target: 'story', tone: 'sea', variants: ['收集月光种子，修复古树核心', '穿过蘑菇村和树冠，找到影藤的源头'] },
      { kind: '画风', target: 'style', tone: 'gold', variants: ['温暖童话像素风，薄荷绿与淡紫月光交织', '清晰侧视角和硬像素边缘，角色始终容易辨认'] },
    ],
  },
  {
    id: 'neon-city', name: '霓虹失城', ideas: [
      { kind: '世界', target: 'story', tone: 'sea', variants: ['城市靠相连的空中列车和地下水道运行', '整座城市的夜晚由中央电网点亮'] },
      { kind: '主角', target: 'story', tone: 'violet', variants: ['主角是一名懂维修电路的快递员', '这名快递员熟悉城市里隐蔽的送货捷径'] },
      { kind: '冲突', target: 'story', tone: 'coral', variants: ['失控的守卫主机切断了城市电力', '停电让医院的备用电源所剩无几'] },
      { kind: '目标', target: 'story', tone: 'forest', variants: ['找回数据芯片并重启中央电网', '穿过夜市与列车站，救出困在停电区的人'] },
      { kind: '画风', target: 'style', tone: 'gold', variants: ['清晰的赛博像素风，深蓝街景配青色与玫红霓虹', '统一侧视像素比例，灯光明亮但不遮挡角色'] },
    ],
  },
  {
    id: 'clockwork-oasis', name: '沙漠钟城', ideas: [
      { kind: '世界', target: 'story', tone: 'gold', variants: ['沙漠绿洲由一座巨大的机械钟调节水流', '沙丘下藏着连接各座绿洲的古老齿轮轨道'] },
      { kind: '主角', target: 'story', tone: 'violet', variants: ['主角是会修钟表的年轻守水人', '这名守水人随身带着父亲留下的黄铜工具箱'] },
      { kind: '冲突', target: 'story', tone: 'coral', variants: ['机械钟停摆后，绿洲的水正在干涸', '风沙怪物占据了通向钟塔的轨道'] },
      { kind: '目标', target: 'story', tone: 'forest', variants: ['找回散落的齿轮，让机械钟重新运转', '沿着齿轮轨道抵达钟塔，恢复绿洲水流'] },
      { kind: '画风', target: 'style', tone: 'sea', variants: ['温暖的沙漠像素风，琥珀沙丘衬托碧蓝绿洲', '统一侧视角，黄铜机械与角色轮廓清晰'] },
    ],
  },
]

export function selectedInspirationTexts(source: string): string[] {
  return INSPIRATION_PACKS.flatMap((pack) => pack.ideas.flatMap((idea) => idea.variants))
    .filter((text) => source.includes(text))
}
