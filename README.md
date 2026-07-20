# Pixel World — Prompt to Play

Pixel World 是一个由提示词驱动的 2D 像素动作游戏制作器。使用者可以填写结构化需求，让 AI 补全 GameSpec V3，选择每项素材出现在哪些关卡，再按队列生成素材、试玩并导出可离线运行的网页游戏 ZIP。

## V3 主要能力

- 完整素材规划：主角、地面/空中/水中敌人、Boss、武器、弹射物、攻击特效、收集品、三类平台、三类障碍物、逐关背景、音乐和画面特效。
- 多素材与关卡分配：除主角外可新增、复制和删除同类素材；每项素材可以独立启用并勾选出现关卡。
- 固定动画规格：角色类素材统一使用 `6 列 × 5 行` 精灵表，五行依次为待机、移动、攻击、受击和死亡。
- 安全生成队列：单素材任务、默认并发数 2、独立状态、有限重试、取消与刷新恢复；部分成功不会因其他任务失败而丢失。
- OpenRouter 新图片接口：默认 Seedream 4.5，暂时性故障时回退 FLUX.2 Pro；请求字段按模型能力分别生成。
- 完整战斗运行：近战、远程弹射物与碰撞伤害、空中俯冲、水中游动、低重力、漂浮平台、致死和弹跳障碍物。
- 程序化音频：背景音乐与攻击/行动音效由 Web Audio 根据规格合成，不需要额外音频 API。
- 本地资产持久化：大图片保存在 IndexedDB；项目元数据保留版本信息，V2 数据会自动迁移到 V3。
- 离线导出：ZIP 内含 `index.html`、`game.js`、`styles.css`、`project.json` 和全部图片素材；运行时不依赖 OpenRouter。

## 使用流程

1. 选择图片服务商和模型，填入 API Key。
2. 选择“龙之城堡五关冒险”模板，或填写自己的结构化游戏构想。
3. 点击“一键优化提示词”，检查 GameSpec V3 规划。
4. 在素材规划区启用、关闭、新增或复制素材，并勾选出现关卡。
5. 先点击“测试 API（生成 1 张）”，确认密钥、模型和余额可用。
6. 点击“生成已选素材”；任务以两个并发工作线程依次完成。
7. 在右侧预览区单独重新生成素材或逐关背景，然后点击 Start Game 试玩。
8. 素材齐全后点击 Export ZIP；缺少已启用素材时会停止导出并列出缺失项。

## 游戏操作

- `A/D` 或 `←/→`：移动
- `W`、`Space` 或 `↑`：跳跃
- `J`：近战攻击
- `K` 或 `F`：远程攻击
- `Esc`：暂停或继续

鼠标和触屏可以使用游戏画布下方的移动、跳跃、Slash 和 Shoot 按钮。击败当前关卡全部敌人后，进入右侧发光传送门即可进入下一关。

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。

也可以在 `.env.local` 中配置服务端密钥：

```env
DASHSCOPE_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here
OPENROUTER_API_KEY=your-key-here
```

页面输入的 API Key 只保存在当前浏览器会话中，不写入项目配置、导出 ZIP 或 Git 仓库。不要把真实密钥提交到 GitHub；如果密钥曾出现在历史提交中，应在服务商后台撤销并重新生成。

## OpenRouter 模型参数

- Seedream 4.5：使用 `resolution: "2K"`，背景为 `16:9`，独立素材为 `1:1`。
- FLUX.2 Pro：不发送尺寸字段，只发送该端点支持的通用参数。
- 只有超时、限流和服务器故障会触发重试或备用模型；认证失败、余额不足和参数错误会立即停止并展示原始原因。

Seedream 4.5 与 FLUX.2 Pro 都可能产生费用。文字优化可以使用 OpenRouter 免费文字路由，但图片生成仍取决于账户余额和图片模型价格。

## 核心目录

- `types/index.ts`：GameSpec V3、素材、动画、音效与关卡类型。
- `lib/asset-catalog.ts`：完整素材目录与结构化提示词字段。
- `lib/game-spec.ts`：V3 默认值、校验、V2 迁移与序列化。
- `app/api/optimize-prompt`：AI/本地提示词结构化。
- `app/api/generate`：单素材生成、验证、重试和错误归类。
- `components/AssetPlanner.tsx`：素材开关、关卡分配和生成队列控制。
- `components/GameCanvas.tsx`：动作游戏物理、战斗、敌人行为、关卡与音频。
- `lib/asset-db.ts`：IndexedDB 图片缓存与刷新恢复。
- `lib/export-game.ts`：离线游戏资源改写和 ZIP 打包。
