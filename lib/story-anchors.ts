export interface StoryAnchors {
  hero?: string
  antagonist?: string
  collectible?: string
  place?: string
}

function clean(value?: string): string | undefined {
  const cleaned = value?.trim()
    .replace(/^(?:一位|一个|一名|年轻的|勇敢的)/, '')
    .replace(/^(?:\d+|一|两|三|几)(?:枚|个|把|件|颗|片|块)/, '')
    .replace(/(?:为了|必须|需要|决定|试图|想要|要去|救出|拯救|击败|打败|阻止|收集|寻找|找回|夺回|取得|之后|然后|后|时).*$/u, '')
    .replace(/[的\s，。；,.;:：]+$/u, '')
    .trim()
  return cleaned && cleaned.length <= 24 ? cleaned : undefined
}

/** Conservative hints for the no-model draft; uncertain details stay generic. */
export function extractStoryAnchors(story: string): StoryAnchors {
  const source = story.slice(0, 2000)
  const hero = clean(source.match(/(?:^|[，。；,.;])\s*([^，。；,.;]{1,18}?)(?:必须|需要|决定|试图|踏上|出发|前往|穿越|想要|要去)/u)?.[1])
  const antagonist = clean(
    source.match(/(?:击败|打败|对抗|讨伐|封印|阻止)([^，。；,.;]{1,18})/u)?.[1]
    || source.match(/被([^，。；,.;]{1,18}?)(?:带到|抓走|掳走|囚禁|绑架|占领)/u)?.[1],
  )
  const collectible = clean(source.match(/(?:收集|寻找|找回|夺回|取得)([^，。；,.;]{1,18})/u)?.[1])
  const place = clean(source.match(/(?:带到|前往|进入|抵达|来到|穿越)([^，。；,.;]{1,22})/u)?.[1])
  return { hero, antagonist, collectible, place }
}
