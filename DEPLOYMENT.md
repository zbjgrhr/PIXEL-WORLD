# Pixel World 源码部署说明

本包是完整 Next.js 应用源码，需要支持 Node.js 服务端的部署环境，不能作为纯静态 HTML 站点上传。用户所称 upma 平台的具体构建规则尚未核实，下列为通用 Node.js 部署参数。

## 构建与启动

- Node.js：22（本次检查环境为22.20）。
- 包管理器：pnpm，使用仓库内 pnpm-lock.yaml。
- 安装：`corepack enable`，然后 `pnpm install --frozen-lockfile`。
- 构建：`pnpm build`。
- 启动：`pnpm start --hostname 0.0.0.0 --port 3000`。
- 若平台分配 PORT，启动端口使用平台提供的 PORT 值，例如 Linux 启动命令 `pnpm start --hostname 0.0.0.0 --port "${PORT:-3000}"`。
- 环境变量 `PIXEL_WORLD_PREVIEW_DIST` 不要设置：它仅供本机隔离预览，部署默认使用 .next。

源码包不含 node_modules、.next、其他构建缓存、.git、真实环境配置或本地浏览器作品。平台需要联网安装依赖并执行构建；上传源码包不等于部署成功。

## 环境配置

参考 .env.example 配置部署平台的环境变量。零AI简单版保留规则草案、内置素材、试玩和导出入口，无需玩家填写模型API Key；使用AI能力时单独配置对应模型。不要将本机密钥文件上传或提交到仓库。

社区需要真实 Supabase 项目及对应环境变量。NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 是前端配置；SUPABASE_SECRET_KEY 只能用于服务端，不能加 NEXT_PUBLIC 前缀。新增部署域名后，需在 Supabase 回跳名单配置该域名的 /auth/callback。详细步骤见 docs/community-setup.md。

supabase/migrations 保留数据库迁移。已有项目不要重复运行新项目初始化SQL；先确认已执行版本。已有的本机Supabase配置不会自动迁移到部署平台。

## 此次版本的验证范围

2026-11-01：74个测试文件、523项自动测试及独立目录生产构建通过。仍未完成第05轮修复后网页/离线三关真实验收、同轮游戏ZIP与演示交付，以及社区真实登录和多账号发布验收；部署不将这些待办变为已通过。

部署后检查首页、零AI简单版创作/试玩/导出，以及社区真实配置与登录；付费模型调用应另行按预算执行。
