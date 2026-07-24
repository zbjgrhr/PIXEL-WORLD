# Pixel World Agent Cluster

## 目标与边界

Agent Studio 将游戏构想拆成多个职责清晰的短任务，并把最终结果收敛为现有引擎可以直接读取的 GameSpec V3。Agent 只能生产结构化数据，不能生成、执行或修改 JavaScript、API 配置与导出代码。图片生成仍由已有素材队列负责，且必须经过用户批准。

## 受控 DAG

```text
Director
   ├─ Narrative ─┐
   ├─ Mechanics ─┼─ Level Designer ─ Integrator ─┬─ Consistency Critic ─┐
   └─ Art Director┘                               └─ Engine QA ──────────┼─ Revision
                                                                          └─ (最多第二轮)
Revision ─ Asset Coordinator ─ 用户批准 ─ 图片素材队列
图片完成 ─┬─ Visual QA ─┐
          └─ Playtest ──┼─ Publisher Report
```

浏览器按依赖顺序调度，每次最多并发三个文字 Agent；服务端接口一次只执行一个任务，避免长请求。已经成功且输入摘要未变化的任务不会重复执行。手动重跑上游任务时，其下游任务和旧成果会一并失效，防止混用不同版本的规划。

## 数据与恢复

- `AgentRun`：运行状态、项目、固定文字模型、轮次、审批状态、任务与成果。
- `AgentTask`：角色、依赖、状态、尝试次数、输入摘要、Token、错误和时间。
- `AgentArtifacts`：创作简报、叙事、玩法、美术、关卡、GameSpec、QA 和发布报告。
- `AgentIssue`：`info / warning / blocking`、来源、GameSpec 路径、说明和建议。

AgentRun 保存在独立 IndexedDB 中。刷新时，未结束的 `running` 任务会安全恢复为 `waiting`，整个运行进入 `paused`，由用户点击继续。图片大数据仍使用原有素材数据库。API Key 不属于任何持久化数据结构。

## 模型锁与接口

`POST /api/agents/execute` 支持 OpenRouter、OpenAI 和 DashScope。启动运行后，平台和文字模型被锁定，所有 Agent 都使用同一模型标识。OpenRouter 使用明确模型而不是自动路由器，以免同一运行切换底层模型。图片平台和图片模型在素材生成区另行锁定。

请求失败策略：认证、余额和参数错误立即停止；超时、限流和服务器错误最多重试一次。JSON 解析失败允许一次结构修复。模型输出会经过角色字段白名单、字符串/数组限制、危险键过滤、GameSpec V3 标准化和确定性引擎检查。

## 审批与质量检查

在评审和修订完成前，Agent 模式不会显示素材生成区。两轮后仍有阻断问题时停止，要求用户调整构想或重新运行相关 Agent。没有阻断项时，用户点击批准才会开放素材卡片和图片 API。

图片生成后，支持图片输入的文字模型可检查少量 HTTPS 图片；不支持视觉输入或图片仅在本地时，系统使用尺寸、格式、动作条、URL、透明度相关元数据和素材完整性规则检查。检查只给出建议，绝不会自动重新生成图片。

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm build
```

测试覆盖 DAG 解锁顺序、发布依赖、龙之城堡五关 GameSpec、缺失素材识别、Agent 字段白名单和无真实额度消耗的 Agent API 模拟请求。网页内“测试 Agent API”用于正式验收时的一次低成本真实调用。
