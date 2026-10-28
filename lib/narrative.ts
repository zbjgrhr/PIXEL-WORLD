import type { GameSpec, NarrativeSpec, StoryChapter, StoryObjective, StoryPoint } from '@/types'
import { applyNarrativeLocks } from './narrative-editing'
import { separateStoryIntroduction } from './story-introduction'
import { normalizeNarrativeSuggestions } from './narrative-suggestions'
import { enabledEnemyNamesForLevel } from './enemy-identity'
import { extractStoryAnchors } from './story-anchors'

type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const line = (value: unknown, fallback = '', limit = 1800) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const clean = (value: string) => value.replace(/【已选灵感】/g, '').replace(/\[truncated\]/g, '').replace(/\s+/g, ' ').trim()
const chineseCounts: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 }
function authoredActions(story: string, levelCount: number) {
  const match = story.match(/(修好|修复|点亮|启动|重启|激活)([一二两三四五\d])([枚座个台盏处])([^\s，。；,;]{1,10})/u)
  if (!match) return []
  const count = chineseCounts[match[2]] || Number(match[2])
  if (!Number.isInteger(count) || count < 1 || count > Math.min(5, levelCount * 2)) return []
  return Array.from({ length: count }, (_, index) => ({
    index, levelIndex: Math.min(levelCount - 1, Math.floor(index * levelCount / count)),
    verb: match[1], measure: match[3], item: match[4],
  }))
}
const generic = (value: string) => !value.trim() || /^(?:Hero|World Guardian|World Stalker|Seedblade|Inner Seed|Level\s*\d+|A brave readable|A mysterious original|An imposing oversized)/i.test(value)
const inventedPassage = /(?:隐藏通道|直通.{0,12}的暗道|通道(?:自动开启|开启无需)|出口轮廓.{0,20}浮现|(?:基座|地面).{0,10}(?:浮现|升起).{0,12}(?:接口|通道))/
const unrenderedProjection = /(?:全息投影|投射.{0,30}影像|影像(?:定格|浮现|回放)|投影(?:放大|显示|呈现|中突袭)|(?:穹顶|幕墙|基座).{0,15}投影)/

function fields(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  let current = ''
  for (const raw of source.split(/\r?\n/)) {
    const match = raw.match(/^([^：:]{1,70})[：:]\s*(.*)$/)
    if (match) { current = match[1].trim(); if (!/^关卡\s*\d+/.test(current)) result[current] = match[2].trim() }
    else if (current && raw.trim() && result[current]) result[current] += `\n${raw.trim()}`
  }
  for (const [key, value] of Object.entries(result)) if (/（可选）$/.test(key)) result[key.replace(/（可选）$/, '')] = value
  return result
}

const WORLDS = [
  { match: /群岛|星桥|飞艇|地图师|星轨|灯塔/, world: '潮汐群岛', hero: '地图师阿澜', identity: '年轻地图师，蓝色短披风，皮革工具腰带，折叠测绘杖', boss: '失控的守桥巨像', enemy: '巡桥铜甲虫', item: '航路星核', weapon: '测绘星杖', place: ['雾港旧码头', '星桥断口', '风鸣修船坞', '潮汐观测站', '守桥核心'], incident: '一次异常潮汐让古老星桥接连熄灭，远航的人们被困在彼此隔绝的岛屿。', motive: '找回航路上失去联络的人，让每座岛重新迎来归航的飞艇', relation: '巨像原本守护星桥，却因航路核心受损而把所有来访者当作入侵者。', resolution: '失控核心被解除，星核重新点亮航路，失去联络的人终于沿着星桥回家。', clue: '一枚刻着旧航线的铜质罗盘', payoff: '罗盘上的缺口与核心插槽相合，揭开了星桥熄灭的原因' },
  { match: /森林|花|树|颜色|精灵|萤|种子/, world: '失色森林', hero: '护林人小栖', identity: '年轻护林人，苔绿色斗篷，橙色围巾，种子挎包，木质手杖', boss: '枯根守卫', enemy: '缠枝甲虫', item: '晨光种子', weapon: '芽光手杖', place: ['林边苗圃', '断流溪谷', '荆棘旧径', '月光树庭', '古树心室'], incident: '古树的光源渐渐枯竭，森林的颜色正沿着干涸的溪流消失。', motive: '把晨光带回古树，守住大家赖以生活的森林', relation: '守卫被枯根侵蚀，错误地封住了通往树心的路。', resolution: '枯根的束缚被打破，种子在树心萌发，溪流与色彩重新回到森林。', clue: '一片仍然发亮的叶子', payoff: '叶脉指出了树心深处被堵住的光源' },
  { match: /海|水|船|珊瑚|潜/, world: '回声海湾', hero: '领航员沐舟', identity: '年轻领航员，海蓝潜水外套，白色围巾，黄铜气瓶，信号枪', boss: '深潮机甲', enemy: '礁壳巡游者', item: '声纹晶片', weapon: '潮声标枪', place: ['退潮船坞', '珊瑚隧道', '沉船回廊', '回声穹顶', '潮汐控制室'], incident: '一阵陌生的深海回声打乱了海湾潮汐，归港航线被接连封锁。', motive: '找到失联者并恢复安全航路，让滞留的船队重返家园', relation: '机甲守着受损的潮汐装置，它的错误指令正在放大风暴。', resolution: '失控装置停止运转，晶片校准了潮汐，船队顺着熟悉的灯光回到了港口。', clue: '一段断续的求救声纹', payoff: '声纹中的节奏是关闭错误潮汐指令的密码' },
  { match: /./, world: '曙光城堡', hero: '骑士岚', identity: '年轻骑士，蓝色披风，银色轻甲，琥珀胸针，短剑与符文护腕', boss: '灰烬守门龙', enemy: '锈甲哨兵', item: '曙光碎片', weapon: '曙光短剑', place: ['城外旧村', '风蚀城墙', '地下水道', '钟楼长廊', '灰烬王座'], incident: '城堡的晨钟突然沉寂，灰烬雾封住了村民回家的道路。', motive: '找到晨钟失声的原因，打通被封锁的道路并让受困的人平安归来', relation: '守门龙受损坏的钟心影响，正在守护一条错误的命令。', resolution: '守门龙的束缚被解除，碎片修复了钟心，晨钟再度响起，归家的道路重新开放。', clue: '一枚不会被灰烬熄灭的钟铃', payoff: '钟铃的共鸣揭示了王座后受损的钟心' },
]

const EXTRA_WORLDS: typeof WORLDS = [
  { match: /钟表|钟塔|时钟|发条/, world: '雾城钟坊', hero: '钟表匠小今', identity: '年轻钟表匠，灰色工装，铜色工具腰带，圆形护目镜，发条工具杖', boss: '失序的报时核心', enemy: '巡检发条机', item: '发条碎片', weapon: '校时扳手', place: ['旧钟表铺', '停摆的街巷', '传动管廊', '报时钟楼', '中央钟室'], incident: '城中的时钟接连停摆，报时网络发出错误指令，封锁了居民出行的道路。', motive: '查清停摆的原因，修复报时网络，让受困的人重新回到正常生活', relation: '报时核心因损坏的发条反复执行错误指令，阻止了维修者接近中央钟室。', resolution: '损坏的指令被解除，发条恢复转动，城市重新响起准确的钟声。', clue: '一张记录了异常报时顺序的维修单', payoff: '维修单上的顺序指向核心中错位的传动部件' },
  { match: /邮差|信使|邮局|邮包|送信/, world: '风铃邮路', hero: '邮差小禾', identity: '年轻邮差，红色雨衣，棕色邮包，黄铜信筒，坚固短靴', boss: '逆风哨兵', enemy: '截信风鸦', item: '遗失信件', weapon: '风铃短杖', place: ['旧邮局', '风铃长桥', '废弃驿站', '暴风观测塔', '最后的收信站'], incident: '突来的风暴吹散了邮包，也让通往最后一座驿站的路失去联络。', motive: '追回遗失的信件，把人们等待的消息送到收信人手中', relation: '哨兵仍在执行封锁邮路的旧命令，它拒绝让任何人通过最后的驿站。', resolution: '哨兵停止了封锁，遗失信件终于送到收信人手中。风暴过后，邮路上的风铃重新响起。', clue: '一张带有风铃印记的回执', payoff: '回执上的印记指出了最后一位收信人所在的驿站' },
  { match: /机器人|赛博|机城|数据|芯片|机械城/, world: '霓虹机城', hero: '维修员阿零', identity: '年轻维修员，青色防护夹克，橙色工具包，方形护目镜，绝缘手套', boss: '封锁主机', enemy: '失控巡逻机', item: '备份芯片', weapon: '脉冲扳手', place: ['维修街区', '供能管廊', '旧数据仓', '信号中继站', '中央机房'], incident: '城市供能网络突然故障，巡逻机开始封锁居民区，求助信号也被切断。', motive: '找回备份数据，恢复居民区的供能与通信', relation: '主机的故障指令把维修行动误判为入侵，封锁了最后的控制通道。', resolution: '故障指令被解除，备份数据恢复了供能，居民区再次亮起灯光。', clue: '一段来自旧维修站的故障日志', payoff: '日志记录了错误指令的来源，成为修复主机的依据' },
]
const LIGHTHOUSE_WORLD: typeof WORLDS[number] = {
  match: /灯塔/, world: '雾海航路', hero: '地图师阿澜',
  identity: '年轻地图师，蓝色短披风，皮革工具腰带，黄铜罗盘，棕色短靴',
  boss: '失控的灯塔守卫', enemy: '礁岸巡逻蟹', item: '灯芯碎片', weapon: '测绘短杖',
  place: ['旧港候船所', '退潮礁道', '断讯观测台', '风暴栈桥', '灯塔顶层'],
  incident: '浓雾遮住了海上的路标，灯塔接连熄灭，离港的船队迟迟没有传回消息。',
  motive: '查明灯塔熄灭的原因，重新点亮航路，让失联的船队平安归港',
  relation: '守卫仍在执行封塔的旧命令，挡住了通往灯室的道路，维修记录也被困在塔内。',
  resolution: '灯室里的故障被排除，灯光重新穿过海雾。失联的船队循着航标归港，岸边等待的人终于听见了汽笛声。',
  clue: '一页标着熄灯时刻的航线日志',
  payoff: '日志上的时刻与封塔指令吻合，说明船队偏离航线是因为失去了灯塔指引',
}
function chooseWorld(source: string) {
  // A lighthouse alone does not establish star bridges. Keep an explicitly
  // chosen star-bridge world, otherwise use the more specific coastal setting.
  if (LIGHTHOUSE_WORLD.match.test(source) && !/星桥|星轨/.test(source)) return LIGHTHOUSE_WORLD
  return WORLDS.slice(0, -1).find(world => world.match.test(source)) || EXTRA_WORLDS.find(world => world.match.test(source)) || WORLDS[WORLDS.length - 1]
}
function explicitSetting(place?: string): boolean {
  return Boolean(place && (/(?:世界|星球|王国|国度|国家|都市|沙漠|森林|群岛|水族馆|博物馆|城堡|校园|学校|工厂|基地|邮局|冰原|雪原|街区|小镇|村庄|港口|车站)$/.test(place)
    || /^(?:日本|中国|法国|英国|埃及|火星|月球)/.test(place)))
}
function authoredCity(place?: string): string {
  return place && /(?:城|城市)$/.test(place) ? place.replace(/^一座/, '') : ''
}
function meaningful(value: string) { return /[\p{L}]/u.test(value.replace(/【已选灵感】/g, '')) }
function id(value: unknown, fallback: string) { return line(value, fallback, 90).replace(/[^\p{L}\p{N}_-]/gu, '-') }
function namedField(value: string): string {
  const explicit = value.match(/(?:名叫|名字是|姓名[为是：:]?)\s*([^，。；\s]{1,16})/)?.[1]
  const separated = value.match(/^([^，。；\n]{1,16})\s*[—–|]\s*.+/)?.[1]
  return clean(explicit || separated || '')
}

/** A complete authored baseline. It is also used when an AI gives only part of a plan. */
export function createNarrative(spec: GameSpec, sourcePrompt = '', originalStory?: string): NarrativeSpec {
  const playerFields = fields(sourcePrompt)
  const labels = { premise: '故事概念', incitingIncident: '事件起因', motivation: '主角动机', conflict: '主要冲突', bossRelation: 'Boss与故事的关系', resolution: '结局方向', opening: '开场剧情', ending: '结局剧情' }
  for (const [key, label] of Object.entries(labels)) if (playerFields[label]) playerFields[`narrative.${key}`] = playerFields[label]
  const submittedStory = originalStory ?? playerFields['世界观与故事'] ?? playerFields['背景故事'] ?? spec.narrative?.source.originalStory ?? ''
  const originalBrief = clean(submittedStory.split('【已选灵感】')[0])
  const storyParts = separateStoryIntroduction(originalBrief)
  const setup = storyParts.ending ? originalBrief.slice(0, originalBrief.length - storyParts.ending.length).trim().replace(/[，,]$/, '') : clean(submittedStory)
  const readable = clean(submittedStory)
  const anchors = extractStoryAnchors(readable)
  const selectedTheme = chooseWorld(`${readable} ${spec.title}`)
  const usePlayerPlace = Boolean(anchors.place && (selectedTheme === WORLDS[WORLDS.length - 1] || explicitSetting(anchors.place)))
  const theme = usePlayerPlace && anchors.place ? {
    ...selectedTheme,
    world: anchors.place,
    hero: anchors.hero || selectedTheme.hero,
    boss: anchors.antagonist || selectedTheme.boss,
    enemy: anchors.enemy || (/巡逻机器人/.test(readable) ? '巡逻机器人' : /日本/.test(anchors.place) ? '灯笼小妖' : /沙漠|埃及/.test(anchors.place) ? '沙漠甲虫' : /月球/.test(anchors.place) ? '月尘怪' : '拦路怪物'),
    item: anchors.collectible || (/月球/.test(anchors.place) ? '星光碎片' : '旅途线索'),
    weapon: /月球/.test(anchors.place) ? '月光杖' : '旅行短杖',
    place: /日本/.test(anchors.place)
      ? [`${anchors.place}的海边村庄`, `${anchors.place}的稻田小径`, `${anchors.place}的山间古道`, `${anchors.place}的旧神社参道`, `${anchors.place}的竹林深处`]
      : /沙漠|埃及/.test(anchors.place)
        ? [`${anchors.place}的绿洲营地`, `${anchors.place}的沙丘古道`, `${anchors.place}的风蚀遗迹`, `${anchors.place}的岩壁峡谷`, `${anchors.place}的蝎巢深处`]
      : /月球/.test(anchors.place)
        ? ['月球着陆区', '环形山边缘', '月尘裂谷', '月背遗迹', '陨石坑深处']
      : /水族馆/.test(anchors.place)
        ? [`${anchors.place}入口`, `${anchors.place}展区`, `${anchors.place}维修通道`, `${anchors.place}设备室`, `${anchors.place}${/传送门/.test(readable) ? '传送门控制室' : '深处'}`]
        : [`${anchors.place}入口`, `${anchors.place}外围`, `${anchors.place}通道`, `${anchors.place}中心区`, `${anchors.place}深处`],
    incident: `${anchors.hero || '主角'}来到${anchors.place}，前往目标的道路上出现了怪物。`,
    motive: `穿过${anchors.place}，完成寻找亲人的旅程`,
    relation: `${anchors.antagonist || '最终对手'}挡在旅程的终点，${anchors.hero || '主角'}必须击败它才能继续前行。`,
    resolution: `${anchors.antagonist || '最终对手'}被击败，主角终于抵达旅程的终点。`,
    clue: /月球/.test(anchors.place) ? '一块留下星光轨迹的月岩' : anchors.collectible ? `一份记录${anchors.collectible}去向的线索` : '一份指向终点的路线记录',
    payoff: /月球/.test(anchors.place) ? '月岩里的光点指向陨石坑深处' : anchors.collectible ? `沿途的记录指向${anchors.collectible}所在的最后一段路` : '沿途的路线记录连起了最后一段路',
  } : authoredCity(anchors.place) ? { ...selectedTheme, world: authoredCity(anchors.place) } : selectedTheme
  if (usePlayerPlace && anchors.place && !/日本|沙漠|埃及|月球|水族馆/.test(anchors.place)) {
    const middlePlace = originalBrief.match(/穿过([^，。；,;]{2,16})(?=[，。；,;])/u)?.[1]?.trim()
    const finalPlace = storyParts.ending?.match(/在([^，。；,;]{1,16}?)(?:里|中|下)?(?:找到了?|救出了?)/u)?.[1]?.replace(/[里中下]$/, '').trim()
    if (middlePlace && middlePlace !== anchors.place) theme.place[1] = middlePlace
    if (finalPlace && finalPlace !== anchors.place && finalPlace !== middlePlace) theme.place[theme.place.length - 1] = finalPlace
  }
  const heroField = playerFields['主角 / Hero'] || playerFields['主角'] || ''
  const roleHint = readable.match(/邮差|信使|机器人|地图师|护林人|领航员|骑士|维修员|机械师|魔法师|小猫|小兔|狐狸/)?.[0]
  const roleName = roleHint ? `${roleHint}${theme.hero.replace(/^(?:邮差|地图师|护林人|领航员|骑士|维修员)/, '')}` : theme.hero
  const heroName = clean(playerFields['主角姓名'] || namedField(heroField) || anchors.hero || readable.match(/(?:名叫|叫做)\s*([^，。；\s]{1,12})/)?.[1] || (!generic(spec.hero.name) ? spec.hero.name : roleName))
  const statedGoalText = setup.match(/(?:必须|需要|决定|想要|为了)([^。！？]{4,90})/)?.[1] || setup.match(/(?:救出|拯救|寻找|找回|阻止|击败|修复|送出|送达|寄出|递交|交给|收集)[^。！？]{2,75}/)?.[0]
  // Failure stakes remain in the player's setup; they are not the goal that
  // the generated successful ending claims has been accomplished.
  const statedGoal = statedGoalText?.split(/[，,；;]\s*(?:否则|不然|若不|如果不|一旦失败)/)[0].trim()
  const namedFamily = readable.match(/(?:妹妹|姐姐|弟弟|哥哥)([\p{Script=Han}]{2,4}?)(?=来到|前往|在|被|，|。|和|与|失踪|遭|走|去|跟)/u)?.[1]
  const explicitNamedRescue = namedFamily && readable.match(new RegExp(`(救回|救出|找回|找到)了?${namedFamily}(?=[，,。！？；;]|$)`))
  const namedAbductedFamily = namedFamily && (new RegExp(`(?:带走|抓走|掳走|绑走)${namedFamily}(?=[，,。！？；;]|$)`).test(readable)
    || readable.match(/(?:妹妹|姐姐|弟弟|哥哥)([\p{Script=Han}]{2,4})(?=来到|前往|在|被|，|。)[^。]*。[她他][^。]{0,35}被[^。]{0,25}(?:带走|抓走|掳走)/u)?.[1] === namedFamily)
    ? namedFamily : undefined
  const abductedPerson = readable.match(/(?:带走|抓走|掳走|绑走)([\p{Script=Han}]{2,4})(?=[，,。！？；;]|$)/u)?.[1]
  const namedCaptive = abductedPerson && new RegExp(`(?:放走|救回|救出|找回|找到)了?${abductedPerson}(?=[，,。！？；;]|$)`, 'u').test(readable)
    ? abductedPerson : undefined
  const trappedFamily = readable.match(/(妈妈|母亲|爸爸|父亲|家人|妹妹|姐姐|弟弟|哥哥)(?:被困|被关|被囚)/)?.[1] || namedAbductedFamily || namedCaptive
  const familyGoal = readable.match(/(?:寻找|找回|找到|救回|救出)(?:了)?(?:失踪的|被抓走的|被困的)?(?:自己(?:的)?)?(妈妈|母亲|爸爸|父亲|家人|妹妹|姐姐|弟弟|哥哥)/)?.[1] || (explicitNamedRescue ? namedFamily : undefined) || trappedFamily
  const familyLocation = trappedFamily ? `${familyGoal}被困的地方` : `${familyGoal}最后出现的地方`
  const familyLocationLabel = trappedFamily ? `${familyGoal}被困地点` : `${familyGoal}最后出现地点`
  const number = originalBrief.match(/^\d+$/)?.[0]
  const clue = playerFields['关键线索'] || (number ? `一份标着编号“${number}”的委托记录` : usePlayerPlace && familyGoal ? `一张标着${familyLocationLabel}的纸条` : theme.clue)
  const clueReference = /纸条/.test(clue) ? '纸条' : /地图/.test(clue) ? '地图' : '线索'
  const payoff = playerFields['线索回应'] || (number ? `编号“${number}”的委托记录指向${theme.place.at(-1)}` : usePlayerPlace && familyGoal ? `沿途记录与${clueReference}上的记号吻合，${familyLocation}就在前方` : theme.payoff)
  const goal = playerFields['主角目标（可选）'] || playerFields['主角目标'] || (explicitNamedRescue ? `${explicitNamedRescue[1]}${namedFamily}` : familyGoal ? `${namedCaptive ? '救回' : trappedFamily ? '救出' : '找到'}${familyGoal}` : statedGoal) || spec.creativeBrief?.heroGoal || theme.motive
  const sparseFragment = originalBrief.length < 48 && /[，,、]/.test(originalBrief) && !/(?:决定|想要|寻找|找回|修复|拯救|打败|击败|救出|收集|穿越|抵达|阻止|送到|送达)/.test(originalBrief)
  const incidentSentence = setup.split(/[。！？]/).find(sentence => /突然|失踪|夺走|带走|抓走|掳走|绑走|破坏|消失|入侵|失联|故障|停摆|被.*(?:封|困|抓)/.test(sentence))
  const event = playerFields['事件起因'] || (!sparseFragment && incidentSentence ? incidentSentence + '。'
    : usePlayerPlace && familyGoal
      ? `${heroName}在${theme.world}发现${clue}，而通往线索所指地点的道路已被怪物占据。`
      : usePlayerPlace && statedGoal
        ? `${heroName}在${theme.world}开始${goal.replace(/[。！]$/, '')}，但${/巡逻机器人/.test(readable) ? '巡逻机器人' : anchors.antagonist || theme.boss}挡住了前路。`
      : theme.incident)
  const motivation = playerFields['主角动机'] || `${heroName}决定${goal.replace(/[。！]$/, '')}。`
  const boss = playerFields['对手姓名'] || namedField(playerFields['BOSS'] || playerFields['Boss'] || playerFields['BOSS / Boss'] || '') || anchors.antagonist || (!generic(spec.boss.name) ? spec.boss.name : theme.boss)
  const bossIncident = setup.split(/[。！？]/).find(sentence => /(?:误把[^，。！？]+当成[^，。！？]+|把[^，。！？]+误认成[^，。！？]+)/.test(sentence) && (sentence.includes(boss) || /核心/.test(boss) && /核心/.test(sentence) || /机械/.test(boss) && /机械/.test(sentence)))
  const mistakenIdentity = bossIncident?.match(/误把([^，。！？]{1,24})当成([^，。！？]{1,24})/)
    || bossIncident?.match(/把([^，。！？]{1,24})误认成([^，。！？]{1,24})/)
  const explicitAbduction = familyGoal && setup.split(/[。！？]/).find(sentence => sentence.includes(boss) && sentence.includes(familyGoal) && /带走|抓走|掳走|绑走/.test(sentence))
  const relation = playerFields['Boss与故事的关系'] || playerFields['BOSS与故事的关系'] || (mistakenIdentity
    ? `${boss}误把${mistakenIdentity[1]}当成${mistakenIdentity[2]}，因此阻止${heroName}${goal.replace(/[。！]$/, '')}。`
    : explicitAbduction
    ? `${boss}带走了${familyGoal}，${heroName}必须突破它的阻拦，${goal.replace(/[。！]$/, '')}。`
    : usePlayerPlace && familyGoal
    ? `${boss}封锁了通往${familyLocationLabel}的道路，${heroName}必须突破它的阻拦。`
    : boss !== theme.boss ? `${boss}控制着通往目标的最后一段道路，${heroName}必须突破它的阻拦，才能解决这场危机。` : theme.relation)
  const clarifiedEnding = familyGoal
    ? storyParts.ending?.replace(/(救出|找回|找到)(了)?(?:她|他)(?=[。！？,，]|$)/, (_match, verb: string, aspect: string | undefined) => `${verb}${aspect || ''}${familyGoal}`)
    : storyParts.ending
  const namedEnding = clarifiedEnding?.split(`${boss}Boss`).join(boss).split(`${boss}BOSS`).join(boss).split(`${boss}boss`).join(boss)
  const selfContainedEnding = namedEnding?.replace(/^(?:他|她|它)(?=修|找|救|回|击|打|战)/, heroName).replace(/^(?=打败|击败|战胜)/, heroName)
  const statedEnding = selfContainedEnding && familyGoal && /^最后(?:找(?:到|回)|救出)/.test(selfContainedEnding)
    ? `${heroName}击败${boss}后，${selfContainedEnding.replace(/^最后/, '终于')}`
    : selfContainedEnding && /^最后(?:打败|击败|战胜)/.test(selfContainedEnding)
      ? `${heroName}${selfContainedEnding.replace(/^最后/, '终于')}`
      : selfContainedEnding
  const baseEnding = playerFields['结局方向'] || statedEnding || (familyGoal ? `${heroName}击败${boss}后，终于找到${familyGoal}，两人重新团聚。` : (statedGoal || playerFields['主角目标（可选）'] || playerFields['主角目标'] ? `${heroName}越过${theme.world}的最后一道阻拦，${goal.replace(/[。！]$/, '')}。${theme.resolution}` : theme.resolution))
  const ending = number && !playerFields['结局方向'] && !playerFields['结局剧情'] && !statedEnding ? `${baseEnding}编号“${number}”的委托终于写上“已完成”。` : baseEnding
  const inspirationWorld = [...submittedStory.matchAll(/【已选灵感】([^。\n]+)/g)].map(match => clean(match[1])).filter(value => /群岛|森林|星桥|世界|海湾|潮汐|颜色/.test(value) && !originalBrief.includes(value)).slice(0, 3)
  const worldContext = inspirationWorld.length ? `在这里，${inspirationWorld.join('；')}。` : ''
  const shortFamilySynopsis = Boolean(usePlayerPlace && familyGoal && storyParts.ending && originalBrief.length < 110 && !incidentSentence && /(?:打败|击败|战胜)[^。！？]{0,32}(?:Boss|BOSS|boss|首领|最终对手)/.test(storyParts.introduction))
  const premise = sparseFragment
    ? `在${theme.world}，${event.replace(/[。！]$/, '')}。${heroName}为了${goal.replace(/[。！]$/, '')}，必须突破${boss}的阻拦。`
    : shortFamilySynopsis ? `在${theme.world}，${heroName}循着${familyGoal}的线索穿过怪物出没的道路，最终要面对${boss}。`
    : meaningful(originalBrief) ? originalBrief : `在${theme.world}，${heroName}接到一项与编号“${number || spec.title}”有关的委托。`
  const synopsisRevealsVictory = Boolean(storyParts.ending && /(?:打败|击败|战胜|消灭)[^。！？]{0,32}(?:Boss|BOSS|boss|首领|最终对手)/.test(storyParts.introduction))
  const introduction = sparseFragment ? premise : synopsisRevealsVictory
    ? `${heroName}来到${anchors.place || theme.world}，为了${goal.replace(/[。！]$/, '')}，必须穿过怪物盘踞的道路，面对${boss}。`
    : meaningful(originalBrief) ? (storyParts.ending && /(?:交给|送达|送到)/.test(storyParts.ending) ? storyParts.introduction.replace(/(?<!准备)(送出|送达|寄出|递交)(?=最后一封信|一封信|信件)/, '准备$1') : storyParts.introduction) : premise
  const repeatsLocation = Boolean(anchors.place && introduction.includes(anchors.place) && event.startsWith(`${heroName}来到${anchors.place}`))
  const repeatsGoal = introduction.includes(goal.replace(/[。！]$/, '')) || Boolean(familyGoal && new RegExp(`(?:救回|救出|找回|找到|寻找|保护)[^。！？]{0,18}${familyGoal}`).test(introduction))
  const completeAuthoredStory = originalBrief.length >= 80 && Boolean(storyParts.ending) && (originalBrief.match(/[。！？]/g)?.length || 0) >= 3
  const opening = playerFields['开场剧情'] || (completeAuthoredStory ? `${introduction}${repeatsGoal ? '' : `${/[。！？]$/.test(introduction) ? '' : '。'}${motivation}`}` : shortFamilySynopsis
    ? `${event}${heroName}决定循着线索找到${familyGoal}，并突破${boss}的封锁。`
    : `${introduction}${/[。！？]$/.test(introduction) ? '' : '。'}${worldContext}${sparseFragment || synopsisRevealsVictory || repeatsLocation || repeatsGoal || introduction.includes(event.replace(/[。！？]$/, '')) ? '' : event}${sparseFragment || repeatsGoal ? '' : motivation}沿途留下的线索指向${boss}，而${clue}也许能揭开真相。`)
  const endingNeedsClockAdjustment = /(?:把|将).{0,8}(?:中央钟|报时钟|时钟|钟).{0,5}(?:调回正向|调正|校准)|(?:调正|校准)(?:中央钟|报时钟|时钟)/.test(originalBrief)
  const recognitionPhrase = originalBrief.match(/让([\p{Script=Han}]{2,12})(?:认出|识别)([^，。！？]{2,30})/u)
  const recognitionAction = recognitionPhrase && (boss.includes(recognitionPhrase[1]) || recognitionPhrase[1].includes(boss))
    ? `让${boss}认出${recognitionPhrase[2]}` : ''
  const storyActions = authoredActions(originalBrief, spec.levels.length)
  const chapters: StoryChapter[] = spec.levels.map((level, index) => {
    const last = index === spec.levels.length - 1
    const place = generic(level.name) || !level.name || /^背景[：:]?$/.test(level.name) ? (theme.place[last ? theme.place.length - 1 : index % (theme.place.length - 1)] + (!last && index >= theme.place.length - 1 ? `·第${index + 1}段旅程` : '')) : level.name
    const nextLevel = spec.levels[index + 1]
    const nextPlace = nextLevel ? (generic(nextLevel.name) ? theme.place[index + 1 >= spec.levels.length - 1 ? theme.place.length - 1 : (index + 1) % (theme.place.length - 1)] : nextLevel.name) : ''
    const authoredWaypoint = theme.place.find((candidate, waypointIndex) => waypointIndex > index + 1 && originalBrief.includes(candidate) && candidate !== place && candidate !== nextPlace && !spec.levels.some(entry => entry.name.includes(candidate)))
    const viaWaypoint = authoredWaypoint && index === spec.levels.length - 2 ? `，途经${authoredWaypoint}` : ''
    const prefix = level.id
    const hasCollectibles = level.collectibleCount > 0
    const itemName = generic(spec.collectible.name) ? theme.item : spec.collectible.name
    const point: StoryPoint = { id: `${prefix}-beacon`, name: last ? '终点线索' : index === 0 ? '路边线索' : '旅途记录', description: last && hasCollectibles ? `把沿途收集的${itemName}带到这里，确认最终目标。` : `查看${place}留下的记录，寻找${last ? '最后一段路的方向' : '下一段旅程的方向'}。`, position: last ? .62 : .48, kind: 'interact' }
    const points: StoryPoint[] = [point]
    const collect: StoryObjective = { id: `${prefix}-collect`, kind: 'collect', target: 'collectible', count: Math.min(2, level.collectibleCount), description: `收集${Math.min(2, level.collectibleCount)}份${itemName}`, feedback: familyGoal ? `${heroName}从收集到的${itemName}中找到与先前线索相符的记号。` : `${heroName}找到了可用的线索。${index === 0 ? `其中藏着${clue}的痕迹。` : '这些发现让前方的方向更加清晰。'}`, prerequisites: [] }
    const objectives: StoryObjective[] = [...(hasCollectibles ? [collect] : []), { id: `${prefix}-interact`, kind: 'interact', target: point.id, count: 1, description: `查看${point.name}（靠近后按 E）`, feedback: last ? `${payoff}。${boss}就在前方。` : familyGoal ? `在${place}找到的记号与先前线索相符，指向${nextPlace}。` : `${place}的记录已经读出，前方的路标亮了起来。`, prerequisites: hasCollectibles ? [collect.id] : [] }]
    const levelActions = storyActions.filter(action => action.levelIndex === index)
    levelActions.forEach((action, actionIndex) => {
      const number = ['一', '二', '三', '四', '五'][action.index]
      const name = `第${number}${action.measure}${action.item}`
      const actionPoint: StoryPoint = { id: `${prefix}-story-point-${actionIndex}`, name, description: `${name}需要${heroName}${action.verb}。`, position: Math.min(.8, .58 + actionIndex * .16), kind: 'interact' }
      points.push(actionPoint)
      objectives.push({ id: `${prefix}-story-action-${actionIndex}`, kind: 'interact', target: actionPoint.id, count: 1, description: `${action.verb}${name}（靠近后按 E）`, feedback: `${heroName}${action.verb}了${name}。`, prerequisites: [`${prefix}-interact`] })
    })
    if (level.enemyCount) objectives.push({ id: `${prefix}-defeat`, kind: 'defeat', target: 'enemies', count: level.enemyCount, description: `击败本关${level.enemyCount}名敌人`, feedback: `${place}的阻拦已经解除。`, prerequisites: [] })
    if (level.hasBoss) objectives.push({ id: `${prefix}-boss`, kind: 'boss', target: 'boss', count: 1, description: recognitionAction ? `使${boss}停止攻击` : `击败${boss}`, feedback: recognitionAction ? `${boss}停止了攻击，${heroName}现在可以靠近确认指令。` : familyGoal ? `${boss}停止了攻击，通往${familyLocationLabel}的道路打开了。` : `${boss}停止了攻击。${payoff}。`, prerequisites: levelActions.map((_, actionIndex) => `${prefix}-story-action-${actionIndex}`) })
    if (last && level.hasBoss && recognitionAction) {
      const instructionPoint: StoryPoint = { id: `${prefix}-instruction-point`, name: boss, description: `${boss}停止攻击后，靠近确认${recognitionPhrase![2]}。`, position: .76, kind: 'interact' }
      points.push(instructionPoint)
      objectives.push({ id: `${prefix}-recognize-instruction`, kind: 'interact', target: instructionPoint.id, count: 1, description: `${recognitionAction}（靠近后按 E）`, feedback: `${boss}认出了${recognitionPhrase![2]}。`, prerequisites: [`${prefix}-boss`] })
    }
    if (last && level.hasBoss && endingNeedsClockAdjustment) {
      const clockPoint: StoryPoint = { id: `${prefix}-clock`, name: '中央钟调校盘', description: '中央钟的指针仍停在倒走刻度。', position: .83, kind: 'interact' }
      points.push(clockPoint)
      objectives.push({ id: `${prefix}-adjust-clock`, kind: 'interact', target: clockPoint.id, count: 1,
        description: '调正中央钟（靠近后按 E）', feedback: `中央钟的指针恢复正向，${heroName}完成了最后的调校。`, prerequisites: recognitionAction ? [`${prefix}-boss`, `${prefix}-recognize-instruction`] : [`${prefix}-boss`] })
    }
    objectives.push({ id: `${prefix}-exit`, kind: 'reach', target: 'exit', count: 1, description: last ? '抵达出口，完成冒险' : '抵达出口，前往下一关', feedback: last ? (familyGoal ? `${heroName}抵达最后的地点，准备寻找${familyGoal}。` : '所有任务完成，冒险迎来结局。') : `通往${nextPlace}的路已打开。`, prerequisites: objectives.map(item => item.id) })
    const developments = trappedFamily
      ? [`${heroName}核对手中的线索，寻找通往${familyLocationLabel}的路线。`, `上一站的记录确认了通往${familyLocationLabel}的方向，${heroName}继续接近目标。`, `前方道路被封锁，${heroName}必须找到绕过阻拦的办法。`, `${heroName}已接近${familyLocationLabel}，最后的阻拦就在眼前。`]
      : familyGoal
        ? [opening.includes(clue) ? `先前发现的线索在这里指向第一处可查的记录，${heroName}开始追踪${familyGoal}的去向。` : `${clue}第一次在这里出现，${heroName}终于找到追踪${familyGoal}去向的起点。`, `上一站发现的记号再次出现，${familyGoal}可能经过这里。`, `线索指向一条被封锁的旧路，${heroName}必须继续追查${familyGoal}的去向。`, `沿途的记号连成一条路线，${heroName}离${familyGoal}只剩最后一段路。`]
        : [opening.includes(clue) ? `带着已有的${clue}，${heroName}在这里核对第一处记录。` : `${clue}留下了最初的痕迹，先确认它来自哪里。`, '上一站的发现与这里的记录相互印证，危机波及的范围比预想中更大。', '线索指向一条被封锁的旧路。穿过这片区域，就能查清最后一道阻拦的位置。', `散落的记录开始连成一幅完整的路线图，${heroName}距离目标只剩最后一段旅程。`]
    const development = last ? `沿途的线索在这里汇合。${relation}` : developments[Math.min(index, developments.length - 1)]
    return { levelId: level.id, title: place, arrival: `${heroName}来到${place}。${development}${hasCollectibles ? `先寻找${itemName}，再查看记录` : '先查看这里留下的记录'}${levelActions.length ? `，然后${levelActions.map(action => `${action.verb}第${['一', '二', '三', '四', '五'][action.index]}${action.measure}${action.item}`).join('、')}` : ''}，打开前路。`, departure: last ? (familyGoal ? `${heroName}走过最后一段路，来到${familyLocation}。` : `${boss}的阻拦已经解除，${heroName}走向${place}的出口。`) : familyGoal ? `在${place}找到的记号指向${nextPlace}，${heroName}带着线索继续前行${viaWaypoint}。` : `在${place}找到的记录已被确认。${heroName}带着新的发现继续前行，下一站是${nextPlace}${viaWaypoint}。`, bossBefore: level.hasBoss ? `${boss}挡住了道路。${relation}${heroName}握紧武器，决定解除这场危机。` : '', bossAfter: level.hasBoss ? recognitionAction ? `${boss}停止攻击，${heroName}可以靠近确认${recognitionPhrase![2]}。` : familyGoal ? `${boss}的封锁解除。${payoff}。` : `${boss}终于停止攻击。${payoff}。` : '', points, objectives }
  })
  if (playerFields['主角姓名'] || namedField(heroField) || anchors.hero || readable.includes(heroName) && !generic(spec.hero.name)) playerFields['narrative.characters.hero.name'] = heroName
  if (playerFields['对手姓名'] || anchors.antagonist) playerFields['narrative.characters.boss.name'] = boss
  if (playerFields['人物关系']) playerFields['narrative.characters.hero.relationship'] = playerFields['人物关系']
  if (playerFields['关键线索']) playerFields['narrative.clues.main-clue.setup'] = clue
  if (playerFields['线索回应']) playerFields['narrative.clues.main-clue.payoff'] = payoff
  return {
    version: 1,
    source: { originalTitle: spec.title, originalStory: submittedStory, playerFields, lockedFields: {}, generatedFields: [...Object.keys(labels).filter(key => !playerFields[`narrative.${key}`]), 'chapters'], origin: 'rules' },
    premise, incitingIncident: event, motivation,
    conflict: playerFields['主要冲突'] || `${goal.replace(/[。！]$/, '')}的道路受到${boss}及沿途敌人的阻拦。${relation}`,
    bossRelation: relation, resolution: ending, opening, ending: playerFields['结局剧情'] || ending,
    characters: [{ id: 'hero', name: heroName, role: '主角', motivation, relationship: playerFields['人物关系'] || `调查${boss}与这场危机的联系，设法突破它对前路的封锁。` }, { id: 'boss', name: boss, role: '最终对手', motivation: relation, relationship: `${boss}阻拦了${heroName}的行动。${relation}` }],
    clues: [{ id: 'main-clue', setup: clue, payoff, levelId: spec.levels[0]?.id || 'level-1', payoffLevelId: spec.levels.at(-1)?.id || 'level-1' }], chapters,
  }
}

/** Normalize a partial model/player narrative without letting unknown task kinds run. */
export function normalizeNarrative(value: unknown, spec: GameSpec, fallback = createNarrative(spec)): NarrativeSpec {
  const raw = object(value), source = object(raw.source)
  const lockedFields = Object.fromEntries(Object.entries(object(source.lockedFields)).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, String(value).slice(0, 12000)]))
  const result: NarrativeSpec = { ...fallback, source: { ...fallback.source, originalTitle: line(source.originalTitle, fallback.source.originalTitle), originalStory: line(source.originalStory, fallback.source.originalStory, 12000), playerFields: { ...fallback.source.playerFields, ...Object.fromEntries(Object.entries(object(source.playerFields)).filter(([, value]) => typeof value === 'string')) } as Record<string, string>, lockedFields, generatedFields: list(source.generatedFields).filter((v): v is string => typeof v === 'string'), origin: source.origin === 'model' || source.origin === 'player' ? source.origin : fallback.source.origin }, chapters: [] }
  for (const key of ['premise', 'incitingIncident', 'motivation', 'conflict', 'bossRelation', 'resolution', 'opening', 'ending'] as const) result[key] = lockedFields[key] !== undefined ? lockedFields[key] : line(raw[key], fallback[key])
  const chapters = list(raw.chapters).map(object)
  result.chapters = spec.levels.map((level, index) => {
    const base = fallback.chapters.find(c => c.levelId === level.id) || createNarrative(spec).chapters[index]
    // A patch addressed to level-2 must never fall back to array position 0.
    const candidate = chapters.find(chapter => chapter.levelId === level.id) || (!chapters.some(chapter => chapter.levelId) ? chapters[index] : undefined) || {}
    const points = Array.isArray(candidate.points) ? candidate.points.slice(0, 6).map((v, i) => {
      const p = object(v)
      const prior = base.points.find(point => point.id === p.id) || (!p.id ? base.points[i] : undefined)
      return { id: id(p.id, prior?.id || `${level.id}-point-${i}`), kind: p.kind === 'reach' || p.kind === 'interact' ? p.kind : prior?.kind || 'interact', name: line(p.name, prior?.name || '线索标记', 40), description: line(p.description, prior?.description || '调查这里留下的线索。', 300), position: Math.max(.15, Math.min(.85, Number(p.position) || prior?.position || .5)) } as StoryPoint
    }) : base.points
    const objectives = Array.isArray(candidate.objectives) && candidate.objectives.length ? candidate.objectives.slice(0, 12).map((v, i) => {
      const o = object(v)
      const prior = base.objectives.find(task => task.id === o.id) || (!o.id ? base.objectives[i] : undefined)
      return { id: id(o.id, prior?.id || `${level.id}-objective-${i}`), kind: line(o.kind, prior?.kind || 'unknown'), target: line(o.target, prior?.target || ''), count: Math.max(1, Math.min(20, Math.round(Number(o.count) || prior?.count || 1))), description: line(o.description, prior?.description || '未说明任务'), feedback: line(o.feedback, prior?.feedback || '任务完成。'), prerequisites: Array.isArray(o.prerequisites) ? list(o.prerequisites).filter((v): v is string => typeof v === 'string') : prior?.prerequisites || [] } as StoryObjective
    }) : base.objectives
    // Explicit actions in the player's story cannot disappear when a model
    // replaces a chapter with generic tasks.
    const authoredTasks = base.objectives.filter(task => task.id === `${level.id}-adjust-clock` || task.id === `${level.id}-recognize-instruction` || task.id.startsWith(`${level.id}-story-action-`))
    for (const task of authoredTasks) {
      if (!objectives.some(item => item.id === task.id)) {
        const exitIndex = objectives.findIndex(item => item.target === 'exit')
        objectives.splice(exitIndex < 0 ? objectives.length : exitIndex, 0, task)
      }
      if (!points.some(point => point.id === task.target)) {
        const authoredPoint = base.points.find(point => point.id === task.target)
        if (authoredPoint) points.push(authoredPoint)
      }
    }
    for (const task of authoredTasks) {
      for (const dependencyId of task.prerequisites) {
        if (objectives.some(item => item.id === dependencyId)) continue
        const dependency = base.objectives.find(item => item.id === dependencyId)
        if (dependency) objectives.unshift(dependency)
      }
    }
    const recognitionTask = objectives.find(task => task.id === `${level.id}-recognize-instruction`)
    if (recognitionTask) {
      const authoredRecognition = base.objectives.find(task => task.id === recognitionTask.id)!
      recognitionTask.kind = 'interact'
      recognitionTask.target = authoredRecognition.target
      recognitionTask.count = 1
      recognitionTask.prerequisites = [...new Set([...recognitionTask.prerequisites, ...authoredRecognition.prerequisites])]
      const clock = objectives.find(task => task.id === `${level.id}-adjust-clock`)
      if (clock) clock.prerequisites = [...new Set([...clock.prerequisites, recognitionTask.id])]
    }
    const exit = objectives.find(task => task.target === 'exit')
    if (exit) {
      exit.prerequisites = [...new Set([...exit.prerequisites, ...authoredTasks.map(task => task.id)])]
    }
    const boss = objectives.find(task => task.kind === 'boss')
    const authoredBoss = base.objectives.find(task => task.kind === 'boss')
    if (boss && authoredBoss?.prerequisites.length) {
      boss.prerequisites = [...new Set([...boss.prerequisites, ...authoredBoss.prerequisites])]
    }
    const next = { ...base, points, objectives }
    for (const key of ['title', 'arrival', 'departure', 'bossBefore', 'bossAfter'] as const) next[key] = line(lockedFields[`chapters.${level.id}.${key}`], line(candidate[key], base[key]))
    return next
  })
  result.characters = list(raw.characters).length ? list(raw.characters).slice(0, 12).map((v, i) => {
    const c = object(v), role = line(c.role, '角色', 40)
    const characterId = /主角|protagonist|^hero$/i.test(`${c.id || ''} ${role}`) ? 'hero' : /boss|最终对手|反派|最终首领/i.test(`${c.id || ''} ${role}`) ? 'boss' : id(c.id, `character-${i}`)
    return { id: characterId, name: line(c.name, '未命名角色', 40), role, motivation: line(c.motivation, characterId === 'hero' ? fallback.motivation : ''), relationship: line(c.relationship, '', 300) }
  }) : fallback.characters
  result.clues = list(raw.clues).length ? list(raw.clues).slice(0, 12).map((v, i) => { const c = object(v); return { id: id(c.id, `clue-${i}`), setup: line(c.setup, '', 300), payoff: line(c.payoff, '', 300), levelId: line(c.levelId, spec.levels[0].id), payoffLevelId: line(c.payoffLevelId, spec.levels.at(-1)!.id) } }) : fallback.clues
  const retainLocked = <T extends { id: string }>(items: T[], original: T[], prefix: string) => {
    const next = [...items]
    original.forEach((item, index) => { if (Object.keys(lockedFields).some(path => path.startsWith(`${prefix}.${item.id}.`)) && !next.some(candidate => candidate.id === item.id)) next.splice(Math.min(index, next.length), 0, item) })
    return next
  }
  result.characters = retainLocked(result.characters, fallback.characters, 'characters')
  result.clues = retainLocked(result.clues, fallback.clues, 'clues')
  result.chapters = result.chapters.map(chapter => {
    const original = fallback.chapters.find(item => item.levelId === chapter.levelId)
    return original ? { ...chapter, points: retainLocked(chapter.points, original.points, `chapters.${chapter.levelId}.points`), objectives: retainLocked(chapter.objectives, original.objectives, `chapters.${chapter.levelId}.objectives`) } : chapter
  })
  const locked = applyNarrativeLocks(result)
  const suggestions = normalizeNarrativeSuggestions(raw.suggestions ?? fallback.suggestions, locked)
  return suggestions.length ? { ...locked, suggestions } : locked
}

/** Upgrade legacy/local drafts while preserving non-generic model/player choices. */
export function ensureNarrative(spec: GameSpec, sourcePrompt = '', originalStory?: string): GameSpec {
  const fallback = createNarrative(spec, sourcePrompt, originalStory)
  const anchors = extractStoryAnchors(fallback.source.originalStory)
  const selectedTheme = chooseWorld(`${fallback.source.originalStory} ${spec.title}`)
  const usePlayerPlace = Boolean(anchors.place && (selectedTheme === WORLDS[WORLDS.length - 1] || explicitSetting(anchors.place)))
  const theme = usePlayerPlace && anchors.place
    ? { ...selectedTheme, world: anchors.place, enemy: anchors.enemy || (/巡逻机器人/.test(fallback.source.originalStory) ? '巡逻机器人' : /日本/.test(anchors.place) ? '灯笼小妖' : /沙漠|埃及/.test(anchors.place) ? '沙漠甲虫' : /月球/.test(anchors.place) ? '月尘怪' : '拦路怪物'), item: anchors.collectible || (/月球/.test(anchors.place) ? '星光碎片' : '旅途线索'), weapon: /月球/.test(anchors.place) ? '月光杖' : '旅行短杖' }
    : authoredCity(anchors.place) ? { ...selectedTheme, world: authoredCity(anchors.place) } : selectedTheme
  const narrative = spec.narrative ? normalizeNarrative(spec.narrative, spec, fallback) : fallback
  const player = narrative.source.playerFields
  const sourceIntroduction = clean(separateStoryIntroduction(narrative.source.originalStory).introduction)
  const worldFacts = sourceIntroduction.split(/[。！？]/).filter(fact => /群岛|森林|星桥|世界|城堡|海湾|天空|潮汐|颜色/.test(fact)).map(fact => fact.replace(/^\d+\s*/, '')).slice(0, 2).join('。')
  const roleHint = narrative.source.originalStory.match(/邮差|信使|机器人|地图师|护林人|领航员|骑士|维修员|机械师|魔法师|小猫|小兔|狐狸/)?.[0]
  const describedHero = clean(narrative.source.originalStory).match(/(?:^|[。！？])([^。！？]{1,24}是(?:一名|一位|一个)[^。！？]{1,90})/)?.[1]?.split(/[，,]/).slice(0, 2).join('，')
  const heroName = narrative.characters.find(c => c.id === 'hero')?.name || theme.hero
  const ruleAppearance = describedHero ? `${describedHero}。完整侧视像素角色，轮廓清晰，无背景。`
    : /企鹅/.test(heroName) ? `${heroName}，黑白羽毛、橙色喙与脚，完整侧视像素角色；每帧保持相同体形和配色，无背景。`
    : /狐狸/.test(heroName) ? `${heroName}，橙棕色毛发、白色胸腹、蓬松尾巴，完整侧视像素角色；每帧保持相同体形和配色，无背景。`
    : /小猫|猫咪/.test(heroName) ? `${heroName}，柔软的短毛、三角耳朵、长尾巴，完整侧视像素角色；每帧保持相同体形和配色，无背景。`
    : roleHint ? theme.identity.replace(/^[^，]+/, roleHint)
    : anchors.hero ? `以${heroName}为原型的完整侧视像素角色，外观符合玩家指定的身份；每帧保持相同轮廓和配色，无背景。`
    : theme.identity
  const generatedHeroPlaceholder = /^An original full-body side-view pixel hero based on/i.test(spec.hero.appearance)
  const heroAppearance = player['主角 / Hero'] || player['主角'] || (generatedHeroPlaceholder || generic(spec.hero.appearance) ? ruleAppearance : spec.hero.appearance)
  const bossName = narrative.characters.find(c => c.id === 'boss')?.name || theme.boss
  const oldLocal = !spec.narrative && (!spec.backgroundStory || spec.backgroundStory === spec.world || spec.backgroundStory.includes('【已选灵感】') || /^Long ago,/.test(spec.backgroundStory) || !meaningful(spec.backgroundStory))
  const levels = spec.levels.map((level, i) => {
    const title = narrative.chapters[i].title
    const setting = title.includes(theme.world) ? title : `${title}，位于${theme.world}`
    const generatedEnvironment = /region\s*\d|progressively stronger atmosphere|A mysterious original|^(?:Approach to|A distinct route through|Final confrontation at)/.test(level.environment) || level.environment.includes('【已选灵感】')
    return {
      ...level,
      name: generic(level.name) || /^背景[：:]?$/.test(level.name) ? title : level.name,
      environment: generatedEnvironment
        ? `${setting}；${i === spec.levels.length - 1 ? '最终战斗场地，地面平整且前景清晰' : i % 2 ? '穿过高低错落的平台，留出跳跃与战斗空间' : '开阔前路、清晰远景与可辨认的探索路线，留出行走区域'}`
        : level.environment,
    }
  })
  const worldContext = worldFacts || (narrative.source.originalStory.length >= 48 ? sourceIntroduction.replace(/[。！？]+$/, '') : '')
  const routePlaces = levels.map(level => level.name.startsWith(`${theme.world}的`) ? level.name.slice(theme.world.length + 1) : level.name).filter(Boolean)
  const routeDescription = routePlaces.length > 1
    ? `从${routePlaces[0]}出发，${routePlaces.length > 2 ? `经过${routePlaces.slice(1, -1).join('、')}，` : ''}前往${routePlaces.at(-1)}`
    : `前往${routePlaces[0] || theme.world}`
  const incident = narrative.incitingIncident.replace(/[。！？]+$/, '')
  const worldDescription = usePlayerPlace
    ? separateStoryIntroduction(narrative.source.originalStory).ending
      ? `${incident.includes(theme.world) ? '' : `${theme.world}。`}${incident}。随后${routeDescription}。${narrative.bossRelation}`
      : `${theme.world}。${worldFacts || clean(narrative.source.originalStory) || `一场围绕${theme.item}展开的冒险`}。`
    : `${worldContext.includes(theme.world) ? '' : `${theme.world}。`}${worldContext || `一场围绕${theme.item}和失控守卫展开的冒险`}。`
  const next = { ...spec, narrative, backgroundStory: oldLocal ? narrative.opening : clean(spec.backgroundStory), world: spec.world === spec.backgroundStory || !meaningful(spec.world) || generic(spec.world) || spec.world.includes('【已选灵感】') ? worldDescription : clean(spec.world), creativeBrief: { ...spec.creativeBrief, heroGoal: spec.creativeBrief?.heroGoal || narrative.motivation }, hero: { ...spec.hero, name: heroName, appearance: heroAppearance }, boss: { ...spec.boss, name: bossName }, enemies: spec.enemies.map(e => ({ ...e, name: generic(e.name) ? theme.enemy : e.name })), weapon: { ...spec.weapon, name: generic(spec.weapon.name) ? theme.weapon : spec.weapon.name }, collectible: { ...spec.collectible, name: generic(spec.collectible.name) ? theme.item : spec.collectible.name }, levels }
  return alignNarrativeCast({ ...next, assets: next.assets.map(asset => {
    if (asset.url) return asset
    if (asset.category === 'hero') return { ...asset, prompt: heroAppearance }
    if (asset.category === 'levelBackground') {
      const level = levels.find(level => asset.levelIds.includes(level.id))
      const original = spec.levels.find(item => item.id === level?.id)
      if (!level || original?.environment === level.environment) return asset
      return { ...asset, prompt: `Environment-only side-view pixel art. ${level.environment} Wide traversal lane, no characters, vivid colors, no gray haze, no muddy wash.` }
    }
    return asset
  }) }, spec)
}

export function alignNarrativeCast(spec: GameSpec, previous?: GameSpec): GameSpec {
  if (!spec.narrative) return spec
  const n = applyNarrativeLocks(spec.narrative)
  const heroName = n.source.lockedFields['characters.hero.name'] ?? spec.hero.name
  const bossName = n.source.lockedFields['characters.boss.name'] ?? spec.boss.name
  const aliases = spec.narrative.characters.map(character => [character.name, character.id === 'hero' ? heroName : character.id === 'boss' ? bossName : character.name]).filter(([oldName, newName]) => oldName && newName && oldName !== newName)
  if (previous) for (const entity of ['collectible', 'weapon'] as const) if (previous[entity].name && previous[entity].name !== spec[entity].name) aliases.push([previous[entity].name, spec[entity].name])
  const rewrite = (value: string) => aliases.reduce((text, [before, after]) => text.split(before).join(after), value)
  const narrative = { ...n, clues: n.clues.map(clue => ({ ...clue, setup: rewrite(clue.setup), payoff: rewrite(clue.payoff) })), characters: n.characters.map(character => ({ ...character, name: character.id === 'hero' ? heroName : character.id === 'boss' ? bossName : character.name, motivation: rewrite(character.motivation), relationship: rewrite(character.relationship) })), chapters: n.chapters.map(chapter => ({ ...chapter, arrival: n.source.lockedFields[`chapters.${chapter.levelId}.arrival`] || rewrite(chapter.arrival), departure: rewrite(chapter.departure), bossBefore: rewrite(chapter.bossBefore), bossAfter: rewrite(chapter.bossAfter), points: chapter.points.map(point => ({ ...point, name: rewrite(point.name), description: rewrite(point.description) })), objectives: chapter.objectives.map(o => ({...o,description:rewrite(o.description),feedback:rewrite(o.feedback)})) })) }
  for (const key of ['premise', 'incitingIncident', 'motivation', 'conflict', 'bossRelation', 'resolution', 'opening', 'ending'] as const) narrative[key] = n.source.lockedFields[key] !== undefined ? n.source.lockedFields[key] : rewrite(n[key])
  return { ...spec, hero: spec.hero.name === heroName ? spec.hero : { ...spec.hero, name: heroName }, boss: spec.boss.name === bossName ? spec.boss : { ...spec.boss, name: bossName }, narrative: applyNarrativeLocks(narrative), backgroundStory: narrative.opening }
}

/** Keep model-invented passages from promising map changes the runtime cannot show. */
export function alignGeneratedPassages(spec: GameSpec): { spec: GameSpec; repairedPaths: string[] } {
  const narrative = spec.narrative
  if (!narrative || /(?:隐藏通道|暗道|按入.{0,20}(?:凹槽|机关))/.test(narrative.source.originalStory)) return { spec, repairedPaths: [] }
  const repairedPaths: string[] = []
  const locks = narrative.source.lockedFields
  const hero = spec.hero.name
  const usableLead = (value: string) => value.split(/[，。；]|——/)[0].trim()
    .replace(/[，。；]+$/, '').slice(0, 90)
    .replace(/^(?:.*(?:按入|插入|嵌入|暗道|通道|接口|浮现|升起|自动开启|无需插入).*)$/, '')
  const chapters = narrative.chapters.map((chapter, index) => {
    const nextLevel = spec.levels[index + 1]
    const departureKey = `chapters.${chapter.levelId}.departure`
    const bossAfterKey = `chapters.${chapter.levelId}.bossAfter`
    let departure = chapter.departure
    let bossAfter = chapter.bossAfter
    if (locks[departureKey] === undefined && inventedPassage.test(departure)) {
      const lead = usableLead(departure)
      departure = nextLevel
        ? `${lead || `${hero}核对线索`}，认出前往${nextLevel.name}的方向，沿出口继续前行。`
        : `${lead || `${hero}完成这里的任务`}，从出口走向结局。`
      repairedPaths.push(`narrative.chapters.${index}.departure`)
    }
    if (locks[bossAfterKey] === undefined && inventedPassage.test(bossAfter)) {
      bossAfter = `${usableLead(bossAfter) || `${spec.boss.name}停止攻击`}，${hero}可以前往出口，继续完成最后的目标。`
      repairedPaths.push(`narrative.chapters.${index}.bossAfter`)
    }
    return departure === chapter.departure && bossAfter === chapter.bossAfter ? chapter : { ...chapter, departure, bossAfter }
  })
  const clues = narrative.clues.map(clue => {
    const lockKey = `clues.${clue.id}.payoff`
    if (locks[lockKey] !== undefined || !inventedPassage.test(clue.payoff)) return clue
    const levelIndex = spec.levels.findIndex(level => level.id === clue.payoffLevelId)
    const nextLevel = spec.levels[levelIndex + 1]
    repairedPaths.push(`narrative.clues.${clue.id}.payoff`)
    const lead = usableLead(clue.payoff)
    return { ...clue, payoff: nextLevel
      ? `${lead || `${hero}核对这条线索`}，线索指向${nextLevel.name}。`
      : `${lead || `${hero}核对这条线索`}，终于看清${spec.boss.name}与这场危机的关联。` }
  })
  return repairedPaths.length ? { spec: { ...spec, narrative: { ...narrative, chapters, clues } }, repairedPaths } : { spec, repairedPaths }
}

export function narrativeProblems(spec: GameSpec): Array<{ path: string; message: string; severity?: 'warning' | 'blocking' }> {
  const n = spec.narrative
  if (!n) return [{ path: 'narrative', message: '缺少完整叙事与任务方案。' }]
  const issues: Array<{ path: string; message: string; severity?: 'warning' | 'blocking' }> = []
  const add = (path: string, message: string, severity?: 'warning' | 'blocking') => issues.push({ path, message, ...(severity ? { severity } : {}) })
  const claims = [
    { test: /(?:利用|使用|提交|携带|收集).{0,24}(?:触发|解除|干扰|消除).{0,18}(?:护盾|防御系统|无敌|停火机制)/, label: '按物品条件改变 Boss 防御或停火' },
    { test: /(?:把|将).{0,24}(?:信纸|邮票|碎片|钥匙|道具|晶片).{0,20}(?:按入|插入|嵌入|贴于).{0,35}(?:哨兵|守卫|Boss|核心|关节).{0,25}(?:短路|瘫痪|识别|解锁|停火|解除|跪地|暴露)/i, label: '物品插入 Boss 或机关后触发特殊状态' },
    { test: /(?:风向|风力|阵风).{0,12}(?:改变|影响|推动|控制).{0,10}(?:移动|跳跃|速度)/, label: '风力改变移动或跳跃' },
    { test: /(?:选择|触发|解锁).{0,12}(?:分支剧情|不同结局|多结局)/, label: '分支选择或多结局' },
    { test: /(?:必须|需要).{0,12}(?:合成道具|制作物品|护送NPC|护送村民)/i, label: '合成或实时护送' },
    { test: /(?:全屏|龙卷风|砸地|盾牌).{0,12}(?:弹幕|冲击波|范围伤害)|(?:狂暴|变身).{0,6}(?:阶段|形态)|enraged.{0,12}phase/i, label: '自定义 Boss 范围技能或变身阶段' },
  ]
  const prose = [spec.boss.attackPattern, n.opening, n.ending, n.conflict, ...n.clues.map(c => c.payoff), ...n.chapters.flatMap(c => [c.arrival, c.departure, c.bossBefore, c.bossAfter, ...c.objectives.flatMap(o => [o.description, o.feedback])])].join('\n')
  claims.forEach(claim => { if (claim.test.test(prose)) add('narrative.unimplemented', `剧情提到“${claim.label}”，当前引擎没有对应的特殊机制。请改写为已支持的收集、战斗或调查反馈；此描述不代表功能已实现。`, 'warning') })
  const itemTriggeredBoss = /(?:把|将|使用|利用).{0,24}(?:信纸|邮票|碎片|钥匙|道具|晶片).{0,18}(?:按入|插入|嵌入|贴于|解除).{0,38}(?:哨兵|守卫|Boss|首领|护盾|关节).{0,28}(?:短路|瘫痪|识别|解锁|停火|解除|跪地|暴露)/i
  const requiredItemMechanic = /(?:把|将|使用|利用|用).{0,26}(?:怀表|钟芯|信纸|邮票|碎片|钥匙|道具|晶片|收集品).{0,25}(?:按入|插入|嵌入|放入|贴于).{0,45}(?:激活|开启|打开|解锁|短路|瘫痪|停火|解除|识别|破防)/
  n.chapters.forEach((chapter, index) => {
    const fields = { arrival: chapter.arrival, departure: chapter.departure, bossBefore: chapter.bossBefore, bossAfter: chapter.bossAfter }
    Object.entries(fields).forEach(([field, value]) => {
      if (requiredItemMechanic.test(value)) add(`narrative.chapters.${index}.${field}`, '章节文字承诺把物品放入机关来开启通道或改变战斗；游戏没有这种物品使用机制。')
      if (inventedPassage.test(value)) add(`narrative.chapters.${index}.${field}`, '章节承诺出现新的暗道或机关接口；游戏只会让已有出口变得可通行。')
      if (unrenderedProjection.test(value)) add(`narrative.chapters.${index}.${field}`, '章节承诺展示投影或回溯影像，但游戏没有对应画面。请改为角色查看记录后得知的事实，或提供可显示的素材。')
    })
    chapter.points.forEach(point => {
      if (requiredItemMechanic.test(point.description)) add(`narrative.chapters.${index}.points.${point.id}`, '交互点承诺物品插入机制，但游戏仅支持普通查看与触发剧情。')
      if (unrenderedProjection.test(point.description)) add(`narrative.chapters.${index}.points.${point.id}`, '交互点承诺展示投影或影像，但游戏没有对应画面。')
    })
  })
  if (/(?:phase\s*[123]|≤\s*\d+\s*HP|stun|chronal pulse|slows? (?:the )?hero|阶段.{0,15}(?:眩晕|减速|冲击波)|受击.{0,8}(?:后退|击退|击飞|击晕))/i.test(spec.boss.attackPattern)) {
    add('boss.attackPattern', 'Boss 设定承诺阶段技能、状态变化或受击位移；当前战斗只支持普通近战和远程攻击。')
  }
  n.chapters.forEach((chapter, index) => chapter.objectives.forEach(task => {
    if (inventedPassage.test(`${task.description} ${task.feedback}`)) add(`narrative.chapters.${index}.objectives.${task.id}`, '任务文字承诺出现新的暗道或机关接口；游戏只会让已有出口变得可通行。')
    if (unrenderedProjection.test(`${task.description} ${task.feedback}`)) add(`narrative.chapters.${index}.objectives.${task.id}`, '任务承诺展示投影或影像，但游戏没有对应画面。请用可见的素材呈现，或改成文字调查反馈。')
    if (task.kind === 'reach' && task.target === 'exit' && chapter.objectives.some(objective => objective.id.endsWith('-adjust-clock'))
      && /(?:调回正向|调正(?:中央钟|报时钟|时钟)|校准(?:中央钟|报时钟|时钟))/.test(task.feedback)) {
      add(`narrative.chapters.${index}.objectives.${task.id}`, '出口反馈重复了已经完成的调钟动作；请把实际调钟留在交互任务，出口只承接结局。')
    }
    if (task.kind === 'boss' && chapter.objectives.some(objective => objective.id.endsWith('-adjust-clock'))
      && /(?:指令|钟|时钟|中央钟).{0,12}(?:校准|调校|调正)完成/.test(task.feedback)) {
      add(`narrative.chapters.${index}.objectives.${task.id}`, 'Boss 战反馈提前宣布调钟完成；实际调钟要在战后的交互任务中发生。')
    }
    if (itemTriggeredBoss.test(task.description)) add(`narrative.chapters.${index}.objectives.${task.id}`, '任务说明要求用物品改变 Boss 状态，但实际只支持普通战斗；请改写为击败 Boss，物品线索可在战后文字中回应。')
    if (requiredItemMechanic.test(task.description)) add(`narrative.chapters.${index}.objectives.${task.id}`, '任务要求把物品放入机关以触发新通道或战斗状态，但游戏没有这种物品使用机制。请改成查看线索、收集物品或普通战斗。')
    if (task.kind === 'boss' && /(?:瞄准.{0,12}(?:透镜|弱点|关节)|(?:\d|三|两|多)阶段.{0,15}破防|(?:生命|血量|HP).{0,8}[≤<].{0,8}(?:追加|释放|触发)|(?:击中|攻击|命中)(?:\d+|一|两|二|三|四|五|六|七|八|九|十)次.{0,12}(?:停机|击败|倒下|获胜)|(?:怀表|钟芯|碎片|钥匙|道具).{0,18}(?:嵌入|插入|按入))/.test(`${task.description} ${task.feedback}`)) {
      add(`narrative.chapters.${index}.objectives.${task.id}`, 'Boss 任务承诺了固定击中次数、弱点、阶段破防或阶段攻击、物品插入；当前只支持普通近战与远程击败。')
    }
    if (task.kind !== 'boss' && chapter.objectives.some(objective => objective.kind === 'boss')
      && /(?:防御协议|防御系统|Boss|首领|守钟机械).{0,15}(?:终止|解除|停火|停止攻击)/i.test(task.feedback)
      && !/(?:尚未|并未|没有|未曾).{0,4}(?:终止|解除|停火|停止攻击)/.test(task.feedback)) {
      add(`narrative.chapters.${index}.objectives.${task.id}`, 'Boss 尚未击败，普通任务反馈却提前宣告其防御或攻击结束。请把结果留在 Boss 战后。')
    }
  }))
  const endingRescueTarget = n.ending.match(/(?:救出|放走|找到|找回)([\p{Script=Han}]{1,8})/u)?.[1]
  if (endingRescueTarget) n.chapters.forEach((chapter, index) => {
    if (new RegExp(`${endingRescueTarget}.{0,18}(?:走出|逃出|脱困|获救|重逢)`).test(chapter.bossAfter)) {
      add(`narrative.chapters.${index}.bossAfter`, '战后文字提前完成了玩家写在通关结局中的营救，最后出口会重复或失去作用。请在出口触发结局。')
    }
  })
  n.clues.forEach(clue => {
    if (inventedPassage.test(clue.payoff)) add(`narrative.clues.${clue.id}.payoff`, '线索回应承诺出现新通道；当前关卡只有原有出口。请改写为发现下一站的线索。')
    if (unrenderedProjection.test(clue.payoff)) add(`narrative.clues.${clue.id}.payoff`, '线索回应承诺展示投影或回溯影像，但游戏没有对应画面。请改为查看记录后得知的事实，或提供可显示的素材。')
    if (requiredItemMechanic.test(clue.payoff)) {
      add(`narrative.clues.${clue.id}.payoff`, '线索回应要求把物品放入机关并开启通道；游戏没有这种物品使用机制。请改成调查所得的叙事发现。')
    }
    if (itemTriggeredBoss.test(clue.payoff) && /决战前|战斗前|交战前|短路|停火|触发/i.test(clue.payoff)) {
      add(`narrative.clues.${clue.id}.payoff`, '线索回应要求战前使用物品改变 Boss 状态；游戏没有该操作。请在击败 Boss 后用文字揭示线索的意义。')
    }
  })
  const briefFragment = n.source.originalStory.trim()
  if (briefFragment.length < 48 && /[，,、]/.test(briefFragment) && !/(?:决定|想要|寻找|找到|找回|修复|拯救|打败|击败|战胜|救出|穿越|抵达|阻止|送到|送达)/.test(briefFragment) && n.premise.trim() === briefFragment) {
    add('narrative.premise', '故事概念仍是玩家给出的几个词，尚未补出地点、主角、事件和目标。')
  }
  if (!n.source.playerFields['结局方向'] && /这次冒险的目标终于实现|沿途收集的线索揭开了危机的原因|找到了继续前行的方向/.test(n.resolution)) {
    add('narrative.resolution', '结局仍是通用总结，尚未说明主角怎样解决这场危机。')
  }
  for (const key of ['opening', 'ending', 'incitingIncident', 'motivation', 'conflict', 'bossRelation', 'resolution'] as const) if (n[key].trim().length < 8) add(`narrative.${key}`, '叙事内容过少，尚未形成完整设定。')
  if (/【已选灵感】|World Guardian|\bHero\b/.test(n.opening + n.ending + spec.hero.name + spec.boss.name)) add('narrative.opening', '成品仍含内部标记或默认角色。')
  const known = new Set(spec.levels.map(l => l.id))
  if (n.chapters.length !== spec.levels.length || new Set(n.chapters.map(c => c.levelId)).size !== spec.levels.length || spec.levels.some(level => !n.chapters.some(c => c.levelId === level.id))) add('narrative.chapters', '每一关都需要一份对应且不重复的剧情与任务。')
  const characterIds = new Set(n.characters.map(c => c.id))
  if (characterIds.size !== n.characters.length || !characterIds.has('hero') || !characterIds.has('boss')) add('narrative.characters', '需要唯一的主角和最终对手记录。')
  n.characters.forEach(c => { if (!c.name.trim() || !c.motivation.trim() || !c.relationship.trim()) add(`narrative.characters.${c.id}`, '角色缺少姓名、动机或人物关系。') })
  if (!n.clues.length) add('narrative.clues', '请补充关键线索及其回应。')
  n.clues.forEach(c => {
    if (!known.has(c.levelId) || !known.has(c.payoffLevelId) || !c.setup || !c.payoff) add('narrative.clues', '线索缺少铺垫、回应或有效关卡。')
    if (spec.levels.findIndex(l => l.id === c.payoffLevelId) < spec.levels.findIndex(l => l.id === c.levelId)) add(`narrative.clues.${c.id}`, '线索的回应关卡不能早于出现关卡。')
  })
  const allObjectiveIds = new Set<string>()
  n.chapters.forEach((chapter, i) => {
    const level = spec.levels.find(l => l.id === chapter.levelId)
    if (!level) return add(`narrative.chapters.${i}`, '剧情引用了不存在的关卡。')
    const keys = new Set<string>()
    const points = new Map(chapter.points.map(p => [p.id, p]))
    if (points.size !== chapter.points.length) add(`narrative.chapters.${i}.points`, '交互点 ID 重复。')
    if (!chapter.title.trim() || !chapter.arrival.trim() || !chapter.departure.trim()) add(`narrative.chapters.${i}`, '章节缺少标题、进入剧情或完成反馈。')
    for (const o of chapter.objectives) {
      const path = `narrative.chapters.${i}.objectives.${o.id}`
      if (allObjectiveIds.has(o.id)) add(path, '任务 ID 重复；每关的任务都需要独立 ID。')
      allObjectiveIds.add(o.id)
      if (o.prerequisites.some(id => !keys.has(id))) add(path, '任务前置条件不存在、顺序错误或形成循环。')
      keys.add(o.id)
      if (!Number.isInteger(o.count) || o.count < 1) add(path, '任务数量必须是大于零的整数。')
      if (['reach', 'interact'].includes(o.kind) && o.count !== 1) add(path, '地点和交互任务一次完成，数量需要为 1。')
      if (!o.description.trim() || !o.feedback.trim()) add(path, '任务缺少说明或完成反馈。')
      if (!['collect', 'defeat', 'boss', 'reach', 'interact'].includes(o.kind)) add(path, '任务使用了引擎尚未实现的条件。')
      if (o.kind === 'collect' && (o.target !== 'collectible' || o.count > level.collectibleCount)) add(path, '收集目标超过关卡可提供的数量。')
      if (o.kind === 'defeat' && (o.target !== 'enemies' || o.count > level.enemyCount)) add(path, '敌人任务数量与关卡不符。')
      if (o.kind === 'defeat') {
        const statedCount = o.description.match(/(?:击败|击退|消灭|打倒)([1-9]|10|[一二三四五六七八九十])(?:只|名|个|位)/)?.[1]
        const chineseCounts: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
        if (statedCount && (chineseCounts[statedCount] ?? Number(statedCount)) !== o.count) add(path, '击败任务文字中的敌人数量与实际完成条件不一致。')
        const availableNames = enabledEnemyNamesForLevel(spec, level.id)
        const unavailableName = spec.enemies.find(enemy => enemy.name && `${o.description} ${o.feedback}`.includes(enemy.name) && !availableNames.includes(enemy.name))?.name
        if (unavailableName) add(path, `任务写了“${unavailableName}”，但这一关没有启用对应敌人素材；请分配该素材，或改成实际会出现的敌人。`)
        else if (/(?:空中|飞行|飞翔|天空中|airborne|flying).{0,10}(?:敌|哨兵|怪|生物|鸟|鸦|龙|enemy)/i.test(o.description)
          && !spec.assets.some(asset => asset.enabled && asset.category === 'airEnemy' && asset.levelIds.includes(level.id))) {
          add(path, '任务写了空中敌人，但这一关没有启用空中敌人素材；请分配该素材，或改成实际会出现的敌人。')
        }
      }
      if (o.kind === 'boss' && (!level.hasBoss || o.target !== 'boss' || o.count !== 1)) add(path, 'Boss 任务与关卡实际配置不符。')
      if ((o.kind === 'interact' || o.kind === 'reach') && !(o.kind === 'reach' && o.target === 'exit') && points.get(o.target)?.kind !== o.kind) add(path, '任务引用了不存在或类型不符的交互点。')
    }
    if (!chapter.objectives.some(o => o.kind === 'reach' && o.target === 'exit')) add(`narrative.chapters.${i}`, '缺少抵达出口的完成条件。')
    if (level.hasBoss && (!chapter.bossBefore.trim() || !chapter.bossAfter.trim() || !chapter.objectives.some(o => o.kind === 'boss'))) add(`narrative.chapters.${i}`, 'Boss 关需要战前剧情、战后反馈和实际击败 Boss 的条件。')
  })
  if (new Set(n.chapters.map(c => c.arrival)).size !== n.chapters.length) add('narrative.chapters', '多个关卡使用相同剧情，需要区分各关的推进作用。')
  if (new Set(n.chapters.map(c => c.departure.trim())).size !== n.chapters.length) add('narrative.chapters.departure', '多个关卡的完成剧情完全相同，请检查是否重复了同一事件或提前揭示后续线索。', 'warning')
  return issues
}
