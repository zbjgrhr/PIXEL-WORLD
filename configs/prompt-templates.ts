export interface PromptTemplate {
  id: string
  name: string
  themeName: string
  levelCount: number
  prompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [{
  id: 'pixel-world-odyssey',
  name: 'Pixel World Odyssey · 龙之城堡五关冒险',
  themeName: '龙之城堡：余烬王冠',
  levelCount: 5,
  prompt: `游戏标题：龙之城堡：余烬王冠
世界观与故事：一个完全原创的黑暗奇幻像素王国。余烬王冠碎裂后，五片领地失去季节与光明；一名成年骑士需要回收星火结晶、重新开启五座传送门，并击败盘踞熔火圣殿的古龙守卫。
背景故事：王国的五座传送门曾由余烬王冠维持。王冠碎裂后，城门、王座厅、地下河、法师塔与熔火圣殿彼此隔绝。成年骑士艾琳从暮色城门出发，以蓝焰符文装备对抗石甲守卫、雷翼兽和深河生物。每枚星火结晶都会恢复传送门的一部分能量，并强化她的近战与远程攻击。第五座门后，熔岩古龙正利用碎片重塑王冠；艾琳必须穿越逐渐升级的平台、陷阱和敌群，在最终竞技场终结诅咒。
整体像素风格：原创16-bit横版像素美术，清晰硬像素边缘，无抗锯齿；深青阴影、暖橙高光、少量蓝紫魔法点缀；统一左上方光源、统一2倍像素比例、正交侧视角和高辨识度剪影。不模仿或引用任何现有游戏、影视、动漫、艺术家、工作室、角色、标志或品牌。

主角 / Hero：One original adult female knight, full-body side view facing right, silver-blue plate armor with gold trim, short dark-red cape, dark hair tied back, athletic readable silhouette; character only, no weapon, no companion, no scenery, no text or emblem.
地面敌人 / Ground Enemy：One original stone-armored sentinel, full-body side view facing left, compact heavy body, cracked charcoal plates, dim orange core, two arms and two legs; enemy only, no weapon floating separately, no scenery.
地面敌人攻击特效：One compact rust-orange impact arc with three stone fragments, horizontal direction, effect only, no creature, no weapon, no environment.
地面敌人行动形态：Slow patrol, notice the player, accelerate into a short chase, stop at melee range, attack, then recover.
地面敌人攻击音效：Short low stone impact followed by one restrained metallic click.
地面敌人行动音效：Heavy rhythmic stone footsteps with a quiet grit texture.
空中敌人 / Air Enemy：One original small thunder-wing creature, full-body side view facing left, dark indigo body, two geometric wings, cyan electric core, clear flying silhouette; creature only, no scenery.
空中敌人攻击特效：One compact cyan-violet electric bolt pointing left, projectile only, no creature, no clouds, no background.
空中敌人行动形态：Hover in place, patrol in a shallow wave, telegraph briefly, then dive toward the player and return to altitude.
空中敌人攻击音效：Short bright electric crack with a fast air-cut transient.
空中敌人行动音效：Soft wing pulse with a quiet electrical hum.
水中敌人 / Water Enemy：One original armored river eel, complete side view facing left, teal segmented plates, pale cyan fins, one glowing eye, readable swimming silhouette; creature only, no water scene.
水中敌人攻击特效：One compact cyan water blade with two bubbles, pointing left, effect only, no creature, no environment.
水中敌人行动形态：Swim in a smooth wave, track the player slowly inside water, telegraph, then perform one short horizontal dash.
水中敌人攻击音效：Muffled low water burst with a short bubble pop.
水中敌人行动音效：Quiet continuous bubbling with a soft flowing-water pulse.
BOSS：One original colossal magma dragon guardian, complete side view facing left, black iron scales, restrained orange lava seams, two large wings, four limbs and one tail, strong final-arena silhouette; boss only, no rider, no minions, no scenery.
BOSS攻击特效：One large fan-shaped orange flame wave with a clear leading edge and sparse embers, effect only, no dragon, no arena, no text.
BOSS行动形态：Phase one ground pursuit and claw strikes; phase two airborne flame volleys; below half health, faster alternating dives and radial shockwaves with clear telegraphs.
BOSS攻击音效：Deep short roar layered with a controlled flame burst and low impact.
BOSS行动音效：Heavy footfalls, broad wing beats and quiet armored-scale friction.
近战武器：One original blue-flame rune longsword, horizontal side view pointing right, silver blade, dark grip, small gold guard, restrained cyan glow; weapon only, no hands, no character, no scenery, no letters or logo.
远程武器：One original compact wrist crossbow, horizontal side view pointing right, dark metal body, blue-gold energy channel, practical readable silhouette; weapon only, no hands, no character, no projectile, no scenery.
近战攻击特效：One compact cyan crescent slash, horizontal motion from left to right, thin bright core and sparse square particles; effect only, no sword, no character, no scenery.
近战攻击音效：Crisp short sword swing followed by one clean metallic impact.
远程弹射物：One small blue-gold energy bolt, horizontal side view pointing right, narrow diamond tip and short cyan tail; projectile only, no launcher, no character, no impact scene.
远程攻击/命中特效：One compact two-part effect showing a tiny cyan muzzle flash beside a small orange-cyan hit burst, isolated and separated, no weapon, no character, no background.
远程攻击音效：Short crossbow release, restrained energy pulse and one clear impact click.
收集品：One original six-sided starfire crystal pickup, small symmetrical silhouette, cyan center, warm orange rim and restrained glow; collectible only, no pedestal, no ground, no scenery, no text.
地面平台：Seamless side-view ancient stone-brick platform material, dark gray blocks with thin moss and a narrow readable top edge; material fills the canvas, no character, no object, no sky, no perspective scene.
水域（低重力）：Wide side-view translucent underground water-zone overlay, teal gradient bands, sparse bubbles and a clear surface line; environment overlay only, no creature, no platform, no architecture, no text.
大气（漂浮）：One isolated floating rune platform with a wide flat top, dark stone base, cyan lift glyphs and clean collision-friendly silhouette; platform only, no sky, no building, no character.
触碰即死障碍物：One isolated row of three dark-metal spikes with orange heated tips, flat base and clear lethal silhouette; obstacle only, no floor, no character, no environment.
弹跳障碍物：One isolated rune bounce pad, compact rectangular base, visible spring center and cyan upward-energy cue; obstacle only, no character, no environment.
普通障碍物：One isolated cracked stone barricade, compact rectangular collision shape, dark gray blocks with one restrained orange seam; obstacle only, no doorway, no character, no environment.
关卡背景：Five original environment-only parallax backgrounds described separately below; every background keeps the central traversal lane readable and contains no hero, enemy, boss, weapon, pickup, foreground obstacle, text, logo or UI.
关卡背景音乐：Five seamless procedural chiptune loops described separately below; music is synthesized locally and does not call the image API.
关卡特效：Per-level weather particles, color filter and restrained impact flash described separately below; effects are rendered locally and do not call the image API.

关卡 1：暮色城门
背景：Wide empty twilight castle approach, broken outer wall in the distance, dry trees at the far edges, layered deep-blue hills and one small glowing gateway at the far right; clear empty traversal corridor, environment only.
平台类型：地面。
障碍物：普通石墙障碍、少量金属尖刺和一个符文弹跳台。
出现素材：主角、地面敌人、空中敌人、近战武器、远程武器、近战攻击特效、远程弹射物、远程攻击/命中特效、收集品、地面平台、普通障碍物、触碰即死障碍物、弹跳障碍物。
背景音乐：92 BPM，三角波主旋律、低音脉冲和克制鼓点，气氛低沉但保留冒险希望。
天气/滤镜/闪光：薄雾、冷色滤镜、低强度、仅受击时短闪光。

关卡 2：回声王座厅
背景：Wide empty ruined throne hall, tall stone columns, broken stained-glass windows, faded banners and diagonal moonlight beams; open central floor and a distant stairway on the right, environment only.
平台类型：地面。
障碍物：普通石制路障、铁栏和两个符文弹跳台。
出现素材：主角、地面敌人、空中敌人、近战武器、远程武器、全部玩家攻击特效、收集品、地面平台、普通障碍物、弹跳障碍物。
背景音乐：104 BPM，方波和弦、断续鼓点与短促回声。
天气/滤镜/闪光：漂浮尘埃、轻微暖色高光、中低强度、受击短闪光。

关卡 3：遗忘地下河
背景：Wide empty underground river cavern, layered wet rock walls, distant chains, small luminous fungi and a calm teal water reflection; clear side-scrolling route, environment only.
平台类型：水域低重力。
障碍物：水边金属尖刺、普通湿岩路障和一个气泡弹跳台。
出现素材：主角、地面敌人、水中敌人、远程武器、远程弹射物、远程攻击/命中特效、收集品、水域、地面平台、普通障碍物、触碰即死障碍物、弹跳障碍物。
背景音乐：112 BPM，正弦波低音、低通水下脉冲和稀疏高音。
天气/滤镜/闪光：气泡、雾气、水下滤镜、中等强度、受击短闪光。

关卡 4：星尘法师塔
背景：Wide empty upper tower chamber, distant bookcases, geometric magic circles on the rear wall, tall windows showing a star field and restrained violet lightning outside; open aerial traversal space, environment only.
平台类型：大气漂浮。
障碍物：漂浮符文平台、金属尖刺和普通石制路障。
出现素材：主角、地面敌人、空中敌人、近战武器、远程武器、全部玩家攻击特效、收集品、大气漂浮平台、普通障碍物、触碰即死障碍物。
背景音乐：128 BPM，快速三角波琶音、低频脉冲与稀疏电流音色。
天气/滤镜/闪光：星尘、梦境滤镜、中高强度、攻击命中时短闪光。

关卡 5：熔火圣殿
背景：Wide empty volcanic sanctuary, distant lava river, black basalt arches, dragon-bone shapes embedded in the rear wall and dark red clouds; broad uncluttered central boss arena, environment only.
平台类型：地面。
障碍物：熔岩尖刺、普通黑岩路障和热气弹跳台。
出现素材：主角、地面敌人、空中敌人、BOSS、全部武器、全部攻击特效、远程弹射物、收集品、地面平台、普通障碍物、触碰即死障碍物、弹跳障碍物。
背景音乐：144 BPM，锯齿波低音、稳定战鼓节奏和清晰胜利动机。
天气/滤镜/闪光：余烬雨、危险暖色滤镜、高强度、Boss重击时短闪光。`,
}]
