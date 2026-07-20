export const GAME_MANUAL = {
  title: '操作说明 · Controls',
  sections: [
    {
      heading: '移动 Move',
      items: ['A / D', '← / → 方向键'],
    },
    {
      heading: '跳跃 Jump',
      items: ['空格 Space'],
    },
    {
      heading: '暂停 Pause',
      items: ['ESC 键'],
    },
    {
      heading: '菜单 Menu',
      items: [
        '点击右上角 ☰ 打开菜单',
        '菜单内可暂停/继续、返回主菜单、调整设置',
        '说明书与剧情也在 ☰ 菜单中',
      ],
    },
    {
      heading: '通关 Goal',
      items: [
        '向右探索每一关，到达尽头进入下一关',
        '完成全部关卡即可胜利 Victory！',
      ],
    },
    {
      heading: '提示 Tips',
      items: [
        '起跳前确保角色站在地面或平台上',
        '避开棕色障碍物',
        '最后一关抵达终点即通关',
      ],
    },
  ],
} as const
