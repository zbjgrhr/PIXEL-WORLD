# Pixel World — Prompt to Play

Pixel World 是一个由提示词驱动的 2D 像素动作游戏制作器。使用者可以填写结构化需求，让 AI 补全 GameSpec V3，选择每项素材出现在哪些关卡，再按队列生成素材、试玩并导出可离线运行的网页游戏 ZIP。

## V3 主要能力

- Agent Studio：Director、叙事、玩法、美术、关卡、整合、双评审、修订和素材统筹按受控 DAG 协作；默认最多两轮，过程展示结构化成果而不展示内部推理。
- 双模型锁：一次 Agent 运行锁定同一个文字模型；一次素材批次锁定同一个图片模型。文字 Agent 只产出数据，不执行代码，也不直接调用图片 API。
- 人工审批：Agent 完成 GameSpec V3 后必须由用户批准，素材卡片与图片生成按钮才会开放；视觉检查只提出重新生成建议，不会自动扣费。
- 完整素材规划：主角、地面/空中/水中敌人、Boss、武器、弹射物、攻击特效、收集品、三类平台、三类障碍物、逐关背景、音乐和画面特效。
- 多素材与关卡分配：除主角外可新增、复制和删除同类素材；每项素材可以独立启用并勾选出现关卡。
- 独立动作条：站立 1 帧、走路 3 帧、跳跃 2 帧、近战/远程攻击各 3 帧、受击 1 帧、死亡 2 帧；不再把不同动作挤进一张大网格。
- 安全生成队列：单素材任务、默认并发数 2、独立状态、有限重试、取消与刷新恢复；部分成功不会因其他任务失败而丢失。
- 多图片平台：DashScope、OpenAI、OpenRouter、Cloudflare Workers AI、Together AI、腾讯 TokenHub、Pollinations 与 Hugging Face。
- 单模型整套生成：一次批量任务锁定当前所选平台和模型，主角、动作条、敌人、武器、背景等全部图片都由同一个模型生成，不按素材类别分流，也不隐藏切换备用模型。
- 完整战斗运行：近战、远程弹射物与碰撞伤害、空中俯冲、水中游动、低重力、漂浮平台、致死和弹跳障碍物。
- 程序化音频：背景音乐与攻击/行动音效由 Web Audio 根据规格合成，不需要额外音频 API。
- 本地资产持久化：大图片保存在 IndexedDB；项目元数据保留版本信息，V2 数据会自动迁移到 V3。
- 离线导出：ZIP 内含 `index.html`、`game.js`、`styles.css`、`project.json` 和全部图片素材；运行时不依赖任何图片 API。

## 在原创作流程中选择模型来源

首页直接进入 Prompt to Play 工作区，默认使用 Agent 集群：填写游戏构想、运行多 Agent 策划与评审、人工批准 GameSpec V3，然后规划图片素材、生成、试玩并导出。传统模式仍可在世界编辑器中切换。选择图片来源不会切换或重置 Agent 工作流。

- **两条独立路径**：文字 Agent 与图片素材各有“使用现成方案”和“连接我的 AI 服务”选项卡。新访客先看到现成方案：图片默认内置像素素材；文字 Agent 需先选工具。旧设置会恢复，切换选项卡也会保留另一边填写的内容。
- **文字 Agent**：现成方案包括 [Ollama](https://docs.ollama.com/api/openai-compatibility)、[LM Studio](https://lmstudio.ai/docs/developer/openai-compat)、[GPT4All](https://docs.gpt4all.io/gpt4all_api_server/home.html)、[Jan](https://jan.ai/docs/api-server)、[WebLLM](https://github.com/mlc-ai/web-llm)。前四种在本机启动兼容 OpenAI 的服务；WebLLM 在支持 WebGPU 的浏览器里首次下载模型。点击“检测模型”，再点“一键测试 GameSpec”检查复杂 JSON 输出。Jan 本地密码只保留在页面内存中。“连接我的 AI 服务”保留 OpenRouter、OpenAI、DashScope，并增加手动接入。
- **图片素材**：现成方案包含仓库内置像素 SVG、逐项上传自己的图片和浏览器直连的 ComfyUI Desktop。角色、敌人和 Boss 可以上传单张静态图，也可以按七种动作分别上传横向帧条；图片缓存在浏览器内，并进入离线 ZIP。玩家可主动使用内置素材补齐缺项，已上传图片不会被覆盖。ComfyUI 需启动本地服务并允许当前网页跨域访问。“连接我的 AI 服务”保留 DashScope、OpenAI、OpenRouter、Cloudflare Workers AI、Together AI、腾讯 TokenHub、Pollinations、Hugging Face，并增加手动接入。
- **手动接入**：文字、图片分别填写可选显示名称、公开 HTTPS API 根地址、模型 ID、API Key。文字接口需兼容 OpenAI 风格的 `/chat/completions` 并返回 Agent 所需的结构化内容；图片接口需兼容 `/images/generations` 并返回 `data[0].b64_json` 或公开可读取的 `data[0].url`。图片测试会实际生成 256×256 小图，可能产生一次服务商费用。服务端拒绝本机和内网地址、跳转以及过大的响应；本机模型仍由浏览器直连。
本地小模型的输出速度和 GameSpec 稳定性依赖设备与模型；云端通常更稳，但仍需以“一键测试 GameSpec”和实际生成结果为准。ComfyUI 当前使用标准单图工作流；角色动作可以逐项上传帧条，或使用自己的图片 API 生成。

Agent 运行记录、任务状态和 Token 统计保存在浏览器 IndexedDB，刷新后会恢复为可继续的暂停状态。文字与图片 API Key 只进入 `sessionStorage` 和当次请求，不会写入 IndexedDB、项目配置、日志、GitHub 或导出 ZIP。详细设计见 [Agent Cluster 架构](docs/AGENT_CLUSTER.md)。

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

页面输入的自备 API Key 只保存在当前浏览器会话中，不写入项目配置、导出 ZIP 或 Git 仓库。公开的 BYOK 路由不会自动使用服务器环境中的普通平台密钥。

站点无需配置共享 AI 密钥。用户可以选择内置素材、上传图片或连接自己的模型服务。

## 图片平台与模型参数

- Seedream 4.5：使用 `resolution: "2K"`，背景为 `16:9`，独立素材为 `1:1`。
- FLUX.2 Pro：不发送尺寸字段，只发送该端点支持的通用参数。
- 只有超时、限流和服务器故障会重试当前模型；认证失败、余额不足和参数错误会立即停止并展示原因。重试不会更换模型。

每个平台的免费额度、价格与模型权限不同，请先用“测试 API（生成 1 张）”确认。文字优化与图片生成是两条独立链路；图片资源始终使用界面中当前锁定的模型。

## 核心目录

- `types/index.ts`：GameSpec V3、素材、动画、音效与关卡类型。
- `lib/asset-catalog.ts`：完整素材目录与结构化提示词字段。
- `lib/game-spec.ts`：V3 默认值、校验、V2 迁移与序列化。
- `app/api/optimize-prompt`：AI/本地提示词结构化。
- `app/api/agents/execute`：每次只执行一个短 Agent 任务的文字模型接口。
- `hooks/useAgentCluster.ts`：浏览器端 DAG 调度、并发、暂停、恢复、重跑和审批。
- `components/AgentStudio.tsx`：Agent 流程、状态、成果、问题与 Token 界面。
- `lib/agent-db.ts`：不含密钥的 AgentRun IndexedDB 持久化。
- `lib/agents`：DAG、提示词、白名单、确定性 QA 和自动测试。
- `app/api/generate`：单素材生成、验证、重试和错误归类。
- `components/AssetPlanner.tsx`：素材开关、关卡分配和生成队列控制。
- `components/GameCanvas.tsx`：动作游戏物理、战斗、敌人行为、关卡与音频。
- `lib/asset-db.ts`：IndexedDB 图片缓存与刷新恢复。
- `lib/export-game.ts`：离线游戏资源改写和 ZIP 打包。
