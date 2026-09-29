export interface PromptTemplate {
  id: string
  name: string
  themeName: string
  levelCount: number
  prompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [{
  id: 'pixel-world-odyssey',
  name: '龙之城堡：余烬王冠 · 5 关完整冒险',
  themeName: '龙之城堡：余烬王冠',
  levelCount: 5,
  prompt: `游戏标题：龙之城堡：余烬王冠
世界观与故事：一个完全原创的黑暗奇幻像素王国。余烬王冠碎裂后，五片领地失去季节与光明；一名成年骑士需要回收星火结晶、重新开启五座传送门，并击败盘踞熔火圣殿的古龙守卫。
背景故事：王国的五座传送门曾由余烬王冠维持。王冠因熔岩古龙夺取核心而碎裂，城门、王座厅、地下河、法师塔与熔火圣殿从此隔绝。成年骑士艾琳从暮色城门出发，以蓝焰符文装备对抗石甲守卫、雷翼兽和深河生物。每枚星火结晶都会恢复传送门的一部分能量，并强化她的近战与远程攻击。她的明确目标是在前四关累计收集至少十二枚星火结晶、开启全部传送门，在第五关击败熔岩古龙并走入右侧出口，完成王冠重铸。
整体像素风格：原创16-bit横版像素美术，清晰硬像素边缘，无抗锯齿；深青阴影、暖橙高光、少量蓝紫魔法点缀；统一左上方光源、统一2倍像素比例、正交侧视角和高辨识度剪影。不模仿或引用任何现有游戏、影视、动漫、艺术家、工作室、角色、标志或品牌。
玩法硬规则：全局普通重力倍率为1.0；水域关卡只在水域碰撞范围内使用0.55重力；大气关卡使用普通重力并依靠漂浮平台移动。近战和远程共用420毫秒冷却；近战每次消耗8能量，远程每次消耗15能量，未攻击或冲刺时每秒恢复2能量。普通关敌人数不超过6，最终关普通敌人数不超过5并额外出现一个Boss。Boss震波最大半径48像素并有明显预警。主角、各类敌人和Boss动作条统一为站立1帧、走路3帧、跳跃2帧、近战攻击3帧、远程攻击3帧、受击1帧、死亡2帧，每一帧都是同一角色从头到脚的完整侧视形象。
关卡兼容规则：暮色城门与回声王座厅只使用地面平台；遗忘地下河只使用水域低重力；星尘法师塔只使用大气漂浮；熔火圣殿只使用地面平台。地面敌人只分配到地面关，水中敌人只分配到水域关，空中敌人可分配到地面或大气关但不得进入水域关。所有Boss相关素材、近战武器、远程武器和两套攻击资源必须分配到最终关。

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
BOSS行动形态：Phase one ground pursuit and close-range strikes; phase two airborne flame volleys; below half health, faster alternating dives and radial shockwaves capped at a 48-pixel radius, always preceded by a clear two-step telegraph.
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
背景：Wide empty sunset castle approach with a saturated turquoise-to-coral sky, emerald grass ledges, golden stone highlights, violet distant hills, colorful banners and one jewel-bright gateway at the far right; sharp readable layers, clear empty traversal corridor, no gray fog, environment only.
平台类型：地面。
障碍物：普通石墙障碍、少量金属尖刺和一个符文弹跳台。
出现素材：主角、地面敌人、空中敌人、近战武器、远程武器、近战攻击特效、远程弹射物、远程攻击/命中特效、收集品、地面平台、普通障碍物、触碰即死障碍物、弹跳障碍物。
背景音乐：92 BPM，三角波主旋律、低音脉冲和克制鼓点，气氛低沉但保留冒险希望。
天气/滤镜/闪光：薄雾、冷色滤镜、低强度、仅受击时短闪光。
敌人数：3。收集品数：3。Boss：否。

关卡 2：回声王座厅
背景：Wide empty ruined throne hall with cobalt stone columns, luminous ruby-and-cyan stained glass, bright gold trim, saturated violet banners and crisp diagonal sunbeams; colorful readable shadows, open central floor and a distant stairway on the right, environment only.
平台类型：地面。
障碍物：普通石制路障、铁栏和两个符文弹跳台。
出现素材：主角、地面敌人、空中敌人、近战武器、远程武器、全部玩家攻击特效、收集品、地面平台、普通障碍物、弹跳障碍物。
背景音乐：104 BPM，方波和弦、断续鼓点与短促回声。
天气/滤镜/闪光：漂浮尘埃、轻微暖色高光、中低强度、受击短闪光。
敌人数：4。收集品数：4。Boss：否。

关卡 3：遗忘地下河
背景：Wide empty underground river cavern with layered indigo and magenta rock walls, bright turquoise water, golden chains, lime-and-coral luminous fungi and sparkling reflections; vivid colored lighting, crisp side-scrolling route, no muddy gray wash, environment only.
平台类型：水域低重力。
障碍物：水边金属尖刺、普通湿岩路障和一个气泡弹跳台。
出现素材：主角、水中敌人、近战武器、远程武器、全部玩家攻击特效、远程弹射物、收集品、水域、地面平台、普通障碍物、触碰即死障碍物、弹跳障碍物。
背景音乐：112 BPM，正弦波低音、低通水下脉冲和稀疏高音。
天气/滤镜/闪光：气泡、雾气、水下滤镜、中等强度、受击短闪光。
敌人数：5。收集品数：4。Boss：否。

关卡 4：星尘法师塔
背景：Wide empty upper tower chamber with rich cobalt bookcases, glowing cyan-and-gold magic circles, coral crystal accents and tall windows showing a deep sapphire star field with vivid violet lightning; sharp colorful layers and open aerial traversal space, environment only.
平台类型：大气漂浮。
障碍物：漂浮符文平台、金属尖刺和普通石制路障。
出现素材：主角、空中敌人、近战武器、远程武器、全部玩家攻击特效、远程弹射物、收集品、大气漂浮平台、普通障碍物、触碰即死障碍物。
背景音乐：128 BPM，快速三角波琶音、低频脉冲与稀疏电流音色。
天气/滤镜/闪光：星尘、梦境滤镜、中高强度、攻击命中时短闪光。
敌人数：6。收集品数：5。Boss：否。

关卡 5：熔火圣殿
背景：Wide empty volcanic sanctuary with brilliant orange lava, deep cobalt basalt arches, magenta mineral highlights, golden dragon-bone shapes and saturated crimson-violet clouds; luminous colored rim light, crisp silhouettes and a broad uncluttered central boss arena, environment only.
平台类型：地面。
障碍物：熔岩尖刺、普通黑岩路障和热气弹跳台。
出现素材：主角、地面敌人、空中敌人、BOSS、全部武器、全部攻击特效、远程弹射物、收集品、地面平台、普通障碍物、触碰即死障碍物、弹跳障碍物。
背景音乐：144 BPM，锯齿波低音、稳定战鼓节奏和清晰胜利动机。
天气/滤镜/闪光：余烬雨、危险暖色滤镜、高强度、Boss重击时短闪光。
敌人数：5。收集品数：5。Boss：是。`,
}, {
  id: 'tide-lighthouse',
  name: '潮汐灯塔 · 3 关海岛冒险',
  themeName: '潮汐灯塔',
  levelCount: 3,
  prompt: `游戏标题：潮汐灯塔
世界观与故事：群岛的灯塔失去蓝色火种后，海雾吞没航线。年轻的灯塔守护者小澜要收集三枚潮汐贝壳，穿过港口、海底遗迹与灯塔顶层，阻止夺走火种的深海领主，让船只重新找到回家的路。
背景故事：小澜在暴风雨后发现灯塔熄灭，父亲的渔船仍在海上。她带着短刀与信号弩寻找潮汐贝壳；每收集一枚就能点亮一段航道，最终在灯塔顶层击败深海领主并重燃蓝色火种。
整体像素风格：明亮的16-bit横版像素风，青蓝海水、珊瑚橙与奶油色灯光；角色和障碍物轮廓清晰，统一侧视角与像素比例。
主角 / Hero：年轻灯塔守护者小澜，黄色雨衣、蓝色围巾，完整侧视像素角色，无背景。
地面敌人 / Ground Enemy：生锈的海盗机械蟹，钳子清晰，完整侧视像素角色，无背景。
水中敌人 / Water Enemy：发光的深海水母，触须短而清楚，完整侧视像素角色，无背景。
BOSS：深海领主，蓝黑鳞甲、珊瑚冠冕，完整侧视像素角色，无背景。
近战武器：小澜的短刀，黄铜刀柄，独立透明背景。
远程武器：便携信号弩，蓝色发光导轨，独立透明背景。
收集品：蓝白相间的潮汐贝壳，独立透明背景。
水域（低重力）：透明青蓝色水域覆盖层，表面线清晰，无人物。
关卡 1：雾港码头
背景：夕阳下的海港木桥、远处渔船与浅色海雾；中间留出清晰行走区域，无人物或文字。
平台类型：地面。
障碍物：木箱和码头缺口。
敌人数：3。收集品数：3。Boss：否。
关卡 2：沉没遗迹
背景：青蓝色水下石廊、珊瑚与透过海面的光束；留出清晰游动区域，无人物或文字。
平台类型：水域低重力。
出现素材：主角、水中敌人、近战武器、远程武器、收集品、水域、地面平台。
障碍物：海胆与石柱。
敌人数：4。收集品数：4。Boss：否。
关卡 3：灯塔顶层
背景：暴风雨中的灯塔平台，远处海面与即将亮起的蓝色火种；中央留出Boss战场，无人物或文字。
平台类型：地面。
障碍物：断裂栏杆与闪电落点。
敌人数：4。收集品数：5。Boss：是。`,
}, {
  id: 'moonlit-forest',
  name: '月影森林 · 3 关童话冒险',
  themeName: '月影森林',
  levelCount: 3,
  prompt: `游戏标题：月影森林
世界观与故事：月亮碎片掉入森林后，树木不再开花。见习园丁阿芽要找到散落的月光种子，经过蘑菇村、云上树冠与古树核心，从贪婪的影藤王手中救回月亮碎片。
背景故事：阿芽答应村里的孩子在月亮升起前让森林重新发光。她用木剑和种子弹保护自己，每收集一颗月光种子就唤醒一片植物，最后击败影藤王，修复古树核心。
整体像素风格：温暖童话16-bit横版像素风，薄荷绿、薰衣草紫与金色月光，轻快但易看清的场景和角色轮廓。
主角 / Hero：见习园丁阿芽，绿色斗篷与橙色发夹，完整侧视像素角色，无背景。
地面敌人 / Ground Enemy：被影藤缠绕的小树桩，短腿与发光眼睛，完整侧视像素角色，无背景。
空中敌人 / Air Enemy：紫色飞蛾，月牙形翅膀，完整侧视像素角色，无背景。
BOSS：影藤王，古树形身躯、紫色藤蔓王冠，完整侧视像素角色，无背景。
近战武器：短小的园丁木剑，独立透明背景。
远程武器：发射种子的藤蔓弹弓，独立透明背景。
收集品：发光的月光种子，独立透明背景。
大气（漂浮）：宽阔平坦的漂浮树叶平台，边缘清晰，无人物。
关卡 1：蘑菇村
背景：月光下的蘑菇房、温暖窗灯和低矮树丛；中间留出清晰行走区域，无人物或文字。
平台类型：地面。
障碍物：倒木和荆棘。
敌人数：3。收集品数：3。Boss：否。
关卡 2：云上树冠
背景：高大的树冠、漂浮叶片和透过云层的月光；留出清晰跳跃路线，无人物或文字。
平台类型：大气漂浮。
障碍物：移动树枝和尖刺果实。
敌人数：4。收集品数：4。Boss：否。
关卡 3：古树核心
背景：古树内部的金紫色年轮与月光裂隙；中央留出Boss战场，无人物或文字。
平台类型：地面。
障碍物：影藤与倒塌木根。
敌人数：4。收集品数：5。Boss：是。`,
}, {
  id: 'neon-city',
  name: '霓虹失城 · 4 关科幻冒险',
  themeName: '霓虹失城',
  levelCount: 4,
  prompt: `游戏标题：霓虹失城
世界观与故事：城市的中央网络突然关闭，街区陷入停电。快递员小雷发现四枚数据芯片能重启电网，必须穿过夜市、地下水道、空中列车与中央机房，对抗失控的守卫主机。
背景故事：小雷的妹妹被困在停电的医院，他必须赶在备用电源耗尽前恢复电网。一路上他收集数据芯片、修复通路，最后进入中央机房击败守卫主机并重新点亮城市。
整体像素风格：清晰的16-bit赛博像素风，深蓝底色、玫红霓虹与青色电光；统一侧视角，街景明亮而不遮挡角色。
主角 / Hero：快递员小雷，蓝色机车夹克、橙色头盔，完整侧视像素角色，无背景。
地面敌人 / Ground Enemy：矮小的巡逻机器人，白色装甲和红色扫描灯，完整侧视像素角色，无背景。
空中敌人 / Air Enemy：三角形监控无人机，青色推进光，完整侧视像素角色，无背景。
水中敌人 / Water Enemy：水道里的防水维修机器人，圆形灯眼，完整侧视像素角色，无背景。
BOSS：守卫主机，机械核心与四只机械臂，完整侧视像素角色，无背景。
近战武器：电击短棍，独立透明背景。
远程武器：便携脉冲发射器，独立透明背景。
收集品：小型青色数据芯片，独立透明背景。
水域（低重力）：透明青蓝色水道覆盖层，表面线清晰，无人物。
大气（漂浮）：宽阔平坦的悬浮列车平台，边缘清晰，无人物。
关卡 1：霓虹夜市
背景：雨后的霓虹摊位、深蓝建筑与明亮路牌；中间留出清晰行走区域，无人物或文字。
平台类型：地面。
障碍物：货箱和漏电围栏。
敌人数：3。收集品数：3。Boss：否。
关卡 2：地下水道
背景：反光的地下水道、青色水面与远处管线；留出清晰游动区域，无人物或文字。
平台类型：水域低重力。
出现素材：主角、水中敌人、近战武器、远程武器、收集品、水域、地面平台。
障碍物：管道与电网。
敌人数：4。收集品数：4。Boss：否。
关卡 3：空中列车
背景：高空列车站、紫色夜空与城市灯海；留出清晰跳跃路线，无人物或文字。
平台类型：大气漂浮。
障碍物：断裂车厢与移动平台。
敌人数：5。收集品数：4。Boss：否。
关卡 4：中央机房
背景：蓝黑色服务器阵列、橙色警告灯与发光核心；中央留出Boss战场，无人物或文字。
平台类型：地面。
障碍物：电流地板与金属箱。
敌人数：5。收集品数：5。Boss：是。`,
}]
