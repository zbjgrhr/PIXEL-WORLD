export interface PromptTemplate {
  id: string
  name: string
  themeName: string
  levelCount: number
  prompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'pixel-world-odyssey',
    name: 'Pixel World Odyssey · 龙之城堡五关冒险',
    themeName: 'Pixel World Odyssey',
    levelCount: 5,
    prompt: `Epic fantasy pixel side-scroller world — cohesive 16-bit retro pixel art style, high contrast colors, hand-drawn texture, atmospheric lighting, unified color palette across all levels (deep teal shadows, warm orange highlights, mystical purple accents).

═══ HERO / 主角 ═══
A courageous young knight-errant, silver-blue armor with gold trim, flowing crimson cape, confident upright posture, facing right. Weapon: a glowing azure longsword with runic engravings along the blade, faint magical particle effects. Personality: brave, agile, determined explorer.

═══ ENEMIES / 敌人 ═══
Level 1 threats: small shadow bats with glowing red eyes, swooping attack pose.
Level 2 threats: stone golem sentries with cracked granite bodies and glowing core, slow heavy stance.
Level 3 threats: armored skeleton warriors with rusty iron swords and tattered capes.
Level 4 threats: dark elf archers in purple hooded cloaks with enchanted bows.
Level 5 BOSS: colossal ancient red dragon with spread wings, fire breath, menacing silhouette against stormy sky.

═══ WEAPONS & COMBAT STYLE / 武器与战斗 ═══
Hero weapon: magic longsword (azure flame edge, holy light on strike).
Enemy weapons: bat claws, golem stone fists, skeleton chipped swords, elf poison arrows, dragon fire breath.
Combat mood: classic action-platformer — dodge, jump, strike. Threat escalates each level.

═══ LEVEL DESIGN — CONTINUOUS ADVENTURE / 连贯关卡叙事 ═══
All levels form ONE connected journey through a cursed dragon kingdom. Each level is the next zone deeper into the realm. Visual progression: exterior → interior → underground → tower → lair. Ground texture and obstacle style stay consistent (ancient stone, moss, cracked tiles) while background atmosphere intensifies.

LEVEL 1 — Cursed Castle Gate (Twilight exterior):
Misty castle courtyard, crumbling stone walls, dead trees, torches flickering, dragon silhouette circling in storm clouds above. Mood: ominous but inviting. Obstacles: fallen stone pillars, broken statues.

LEVEL 2 — Grand Hall of Echoes (Castle interior):
Massive throne hall, towering gothic pillars, faded royal banners, magical runes glowing on marble floor, shafts of moonlight through broken stained glass. Mood: majestic and eerie. Obstacles: iron fence segments, ancient urns.

LEVEL 3 — Forgotten Dungeon Depths (Underground):
Dark underground passage, dripping stone walls, bioluminescent fungi, rusted chains hanging from ceiling, underground river reflections. Mood: claustrophobic tension. Obstacles: spike traps, moss-covered boulders.

LEVEL 4 — Wizard's Obsidian Tower (Ascending spiral):
Mystical tower interior, floating magical books, arcane circles on floor, purple lightning crackling in air, starry void visible through windows. Mood: intense magical danger. Obstacles: crystal shards, enchanted barriers.

LEVEL 5 — Dragon's Molten Sanctum (Final lair):
Volcanic dragon lair, rivers of lava, mountains of gold treasure, ancient dragon altar, apocalyptic red-orange sky, epic boss arena atmosphere. Mood: ultimate climax and triumph. Obstacles: lava rock formations, dragon bone remains.

═══ VISUAL CONSISTENCY RULES / 视觉统一 ═══
- Same pixel art density and outline style across all assets
- Character, ground, obstacles, and backgrounds share the same fantasy medieval palette
- Each level background shows clear depth layers (foreground ruins, midground architecture, background sky/mountains)
- Ground texture: ancient weathered stone tiles, seamless tileable, moss accents
- Obstacles: theme-appropriate stone and magical objects, clear collision-friendly silhouettes
- No modern elements, no sci-fi, no realistic 3D — pure 16-bit pixel game aesthetic throughout

═══ LEVEL RICHNESS / 关卡丰富度（每关必须遵守）═══
Each level background MUST include:
- 3 clear depth layers: foreground ruins, midground architecture, background sky/mountains
- Visible platform ledges at 2-3 different heights (suggest jump paths)
- Environmental storytelling props: torches, banners, chains, crystals, lava glow, bones
- A distinct "goal zone" on the far right (gate, portal, bridge, altar) as level exit

Per-level obstacle theme (for ground + obstacle assets):
LEVEL 1: fallen pillars, broken statues, cracked stone blocks
LEVEL 2: iron fences, royal urns, carpet rolls, throne debris
LEVEL 3: spike traps, moss boulders, hanging chains, flooded patches
LEVEL 4: crystal shards, magic barriers, floating rune stones, bookshelf debris
LEVEL 5: lava rocks, dragon bones, treasure chests, molten cracks

Ground texture per level: same stone family but escalating decay —
clean courtyard tiles → worn hall marble → wet dungeon stone → arcane tower floor → volcanic cracked rock

Background must feel WIDER than screen — horizontal scrolling composition,
extra content extending beyond left and right edges, parallax-ready layers.

Difficulty curve: later levels feel denser and more dangerous visually.

═══ STORY HOOK / 剧情引子 ═══
The kingdom fell when the ancient dragon claimed the castle. Our hero must traverse five cursed zones, defeat escalating guardians, and reach the dragon's lair to restore the realm. Every step forward reveals deeper corruption — and greater courage.`,
  },
]
