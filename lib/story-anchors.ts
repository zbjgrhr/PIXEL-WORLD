export interface StoryAnchors {
  hero?: string
  antagonist?: string
  enemy?: string
  collectible?: string
  place?: string
}

function clean(value?: string): string | undefined {
  const cleaned = value?.trim()
    .replace(/^(?:一位|一个|一名|一只|年轻的|勇敢的)/, '')
    .replace(/^(?:\d+|一|两|三|几)(?:枚|个|把|件|颗|片|块)/, '')
    .replace(/(?:并(?:且)?|再)(?:修复|点亮|重启|重新|救出|拯救|前往|打开|关闭|击败|阻止).*$/u, '')
    .replace(/(?:为了|必须|需要|决定|试图|想要|要去|救出|拯救|击败|打败|阻止|收集|寻找|找回|夺回|取得|之后|然后|后|时).*$/u, '')
    .replace(/[的\s，。；,.;:：]+$/u, '')
    .trim()
  return cleaned && cleaned.length <= 24 ? cleaned : undefined
}

/** Conservative hints for the no-model draft; uncertain details stay generic. */
export function extractStoryAnchors(story: string): StoryAnchors {
  const source = story.slice(0, 2000)
  const roleNamedHero = source.match(/^(?:一名|一位|一个|一只)?(?:钟表匠|邮差|信使|地图师|护林人|领航员|骑士|维修员|机械师|画家|探险家|猎人)([\p{Script=Han}]{2,4})(?=带着|带领|与|和|在|来到|发现|决定|为了|前往|踏上)/u)?.[1]
  const introducedSubject = source.match(/^(?:一只|一位|一名|一个)([^，,。；]{2,28})[，,]\s*(?:在|来到|前往|决定|为了|想要|必须|需要|试图)/u)?.[1]?.split('的').at(-1)
  const openingSubject = source.match(/(?:^|[。！？；])\s*([^，。！？；\s]{2,16}?)在[^，。！？；]{1,28}?(?:发现|追踪|打败|击败|寻找|找回|拯救|救出|修复|收集|探索|送出|送达|寄出|冒险|战斗)/u)?.[1]
  const namedHero = source.match(/(?:名叫|叫做|名字是)\s*([^，。；\s]{1,16})/u)?.[1]
    || source.match(/(?:^|[。！？；])\s*主角是\s*([^，。！？；\s]{2,16})/u)?.[1]
    || source.match(/(?:^|[。！？；])\s*([\p{L}]{2,8})是(?:一名|一位|一个|一只)/u)?.[1]
  const heroCandidate = clean(namedHero || roleNamedHero || introducedSubject || openingSubject || source.match(/(?:^|[，。；,.;])\s*(?!最后|随后|然后)([^，。；,.;]{1,18}?)(?:为了|必须|需要|决定|试图|踏上|出发|前往|穿越|想要|要去|寻找|找回|打败|击败)/u)?.[1])
  const hero = heroCandidate && !/^(?:她|他|它|他们|她们|它们|主角|玩家)$/.test(heroCandidate) ? heroCandidate : undefined
  const activeCaptor = source.match(/(?:^|[。！？；])\s*([^，。！？；\s]{2,12}?)(带走|抓走|掳走|囚禁|绑架)([^，。！？；]{1,20})/u)
  const passiveCaptor = source.match(/被(?:城里(?:的)?|城中(?:的)?)?([^，。；,.;]{1,18}?)(带到|带走|抓走|掳走|囚禁|绑架|占领)/u)
  const captivityResolved = /(?:救回|救出|放走|逃出)/u.test(source)
  const activeAntagonist = activeCaptor && (activeCaptor[2] !== '带走' || captivityResolved)
    ? activeCaptor[1] : undefined
  const passiveAntagonist = passiveCaptor && (!['带到', '带走'].includes(passiveCaptor[2]) || captivityResolved)
    ? passiveCaptor[1] : undefined
  const antagonist = clean(
    source.match(/([^，。；,.;\s]{1,16})(?:\s*BOSS|\s*Boss|\s*boss)(?=[，。；,.;\s]|救出|找到|返回|带回|带|并|然后|$)/u)?.[1]?.split(/(?:和|与|以及|追踪|追击|打败了?|击败了?|战胜了?|对抗|讨伐|封印|阻止)/u).at(-1)
    || source.match(/(?:击败|打败|对抗|讨伐|封印|阻止)([^，。；,.;]{1,18})/u)?.[1]
    || activeAntagonist
    || passiveAntagonist,
  )
  const enemy = clean(source.match(/(?:避开|躲避|击退|抵御)([^，。；,.;]{1,16}?)(?=[，。；,.;]|最后|$)/u)?.[1])
  const candidates = [...source.matchAll(/收集([^，。；,.;]{1,18})/gu), ...source.matchAll(/(?:寻找|找回|夺回|取得)([^，。；,.;]{1,18})/gu)].map(match => clean(match[1]))
  const collectible = candidates.find(value => value && (
    /钥匙|宝石|晶片|晶石|水晶|碎片|星火|星核|种子|符文|零件|信件|地图|航图|罗盘|药草|药水|硬币|徽章|珍珠|贝壳|能源|能量块|人偶/.test(value)
    || !/人|船队|妹妹|姐姐|弟弟|哥哥|朋友|伙伴|父亲|母亲|公主|王子|村民|队员|船员|村庄|世界|故乡|真相|道路|航线|颜色|记忆|失踪/.test(value)
  ))
  const place = clean(source.match(/(?:带到|前往|进入|抵达|来到|穿越)([^，。；,.;]{1,22})/u)?.[1]
    || source.match(/(?:^|[。！？；])\s*[^，。！？；\s]{2,16}在([^，。！？；]{1,22}?)(?:发现|追踪|打败|击败|寻找|找回|拯救|救出|修复|收集|探索|送出|送达|寄出|冒险|战斗)/u)?.[1]
    || source.match(/(?:^|[，。！？；,])\s*在([^，。！？；]{1,22}?)(?:[，,]|发现|追踪|打败|击败|寻找|找回|拯救|救出|修复|收集|探索|送出|送达|寄出|冒险|战斗)/u)?.[1])
  return { hero, antagonist, enemy, collectible, place }
}
