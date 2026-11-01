/** Game controls follow the work's language, independently of the editor locale. */
export function createGameTranslator(language: string | undefined) {
  const entries: Record<string, string> = {
    '紧凑 960px': 'Compact 960px', '标准 1280px': 'Standard 1280px', '宽屏铺满': 'Full width',
    '尚无可试玩的游戏数据': 'No playable game is available yet', '返回制作台': 'Back to Studio',
    '出口已开放': 'Exit unlocked', '完成任务后开放出口': 'Complete the objectives to unlock the exit',
    '继续游戏': 'Resume', '暂停游戏': 'Pause', '打开游戏设置': 'Open Game Settings',
    '当前关卡任务': 'Current Objectives', '剧情记录': 'Story Log', '交互 E': 'Interact · E',
    '出口已开启：走入传送门继续冒险': 'Exit unlocked: enter the portal to continue',
    '游戏已暂停': 'Paused', '主角倒下了': 'You Have Fallen', '冒险完成': 'Adventure Complete',
    '本关完成': 'Level Complete', '重试本关': 'Retry Level', '重新开始冒险': 'Restart Adventure',
    '回看故事': 'Review Story', '完成本关任务后，进入出口继续冒险': 'Complete this level’s objectives, then enter the exit to continue',
    '击败所有敌人后，出口开放': 'Defeat all enemies to unlock the exit',
    '游戏设置': 'Game Settings', '画面': 'Display', '画面大小': 'Display Size', '画面效果': 'Visual Quality',
    '流畅': 'Performance', '标准': 'Standard', '鲜明': 'Vivid', '音乐': 'Music', '启用背景音乐': 'Enable Background Music',
    '基本操作指南': 'Controls', '左右移动': 'Move Left / Right', '跳跃': 'Jump', '近战攻击': 'Melee Attack',
    '远程攻击': 'Ranged Attack', '暂停或继续': 'Pause / Resume',
    '完成当前关卡任务、解除敌人阻拦后，走入右侧传送门继续冒险；靠近线索标记按 E 交互。': 'Complete the level objectives and clear the way, then enter the portal on the right. Approach a clue marker and press E to interact.',
    '冒险故事与剧情记录': 'Story and Event Log', '查看已发生的剧情': 'View Story So Far',
    '冒险剧情': 'Adventure Story', '当前剧情': 'Current Story', 'PIXEL WORLD · 冒险故事': 'PIXEL WORLD · ADVENTURE STORY',
    '还没有新的剧情记录。': 'No story events have been recorded yet.',
    '关闭记录，返回游戏': 'Close Log and Return to Game', '跳过本段剧情': 'Skip This Passage',
    '继续阅读': 'Read On', '继续冒险': 'Continue Adventure', '跳过剧情': 'Skip Story', '关闭记录': 'Close Log',
    '重新开始': 'Restart', '冒险完成！': 'Adventure Complete!',
    '菜单': 'Menu', '关卡': 'Level', '得分': 'Score', '强化': 'Power', '远程射击': 'Shoot',
    '得分：': 'Score: ', '· 所有关卡已完成': '· All levels completed', '音乐音量：': 'Music volume: ',
    '出口锁定：': 'Exit locked: ',
    '移动': 'Move', '近战': 'Slash', '暂停': 'Pause', '继续': 'Resume',
    '前方有障碍，按 W / 空格 / ↑ 跳过去，也可以点“跳跃”。': 'Obstacle ahead. Press W, Space, or ↑ to jump over it, or tap Jump.',
    'Boss 将在最后一关出现': 'Boss appears in the final arena',
    'A/D 移动 · 空格跳跃 · J 近战 · K 远程 · E 交互 · ESC 暂停': 'A/D Move · Space Jump · J Melee · K Ranged · E Interact · ESC Pause',
  }
  const englishToChinese: Record<string, string> = {
    'Menu': '菜单', 'Jump': '跳跃', 'Slash': '近战', 'Shoot': '远程射击', 'Resume': '继续游戏', 'Pause': '暂停游戏',
    'EXIT': '出口', 'LOCKED': '未解锁', 'HERO': '主角', 'ENEMY': '敌人', 'BOSS': 'Boss',
    'SPIKE': '尖刺', 'BOUNCE': '弹跳', 'BLOCK': '障碍', 'SEED': '收集物',
    'Projectile': '投射物', 'A/D or ←/→ move': 'A/D 或 ←/→ 移动', 'W/Space jump': 'W/空格 跳跃',
    'J melee': 'J 近战', 'K/F ranged': 'K/F 远程', 'ESC pause': 'ESC 暂停',
    'Boss appears in the final arena': 'Boss 将在最后一关出现',
  }
  return (source: string): string => language === 'en' ? entries[source] || source : englishToChinese[source] || source
}

/** Kept self-contained so offline games use exactly the same fixed UI wording. */
export function offlineGameLanguageSource(): string {
  return `const createGameTranslator=(${createGameTranslator.toString()});`
}
