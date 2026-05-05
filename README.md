# EMKE Design Review Command Center

内部设计审核 MVP。设计师提交 Figma 链接后，服务端用团队统一 `FIGMA_TOKEN` 读取 Page 与顶层 Frame，前端展示缩略图、名称和尺寸。设计师手动选择 Frame 后，服务端导出图片并调用视觉 AI，AI 仅基于导出图片和 `品牌设计规范.md` 进行结构化初审。

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

默认入口：

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- 默认访问口令：`emke-internal`

## Environment

- `FIGMA_TOKEN`: 团队统一 Figma Token，只在服务端使用。
- `AI_PROVIDER_API_KEY` 或 `OPENAI_API_KEY`: 视觉模型 API Key。也可以在管理员「系统设置」里保存运行时 Key。
- `AI_PROVIDER_BASE_URL`: 兼容 OpenAI Chat Completions 的 Provider Base URL。未配置时预设为 `https://api.derouter.ai/openai/v1`。
- `AI_MODEL`: 默认视觉模型。未配置时预设为 `claude-sonnet-4-6`。
- `BRAND_STANDARD_PATH`: EMKE VIS 标准源。未配置时优先读取管理员上传的 `data/brand-standard.md`，再读取项目根目录 `品牌设计规范.md`。
- `DATABASE_URL` / `POSTGRES_URL`: Neon Postgres 连接串。配置后 API 使用 Neon 持久化任务、结果、日志、运行时 AI 配置和线上上传的 VIS 标准源；未配置时本地 fallback 到 `data/reviews.json`。

未配置 AI Key 时，系统会返回开发占位审核结果，用于本地验证流程；接入真实审核必须配置视觉模型 API Key。未配置 Figma Token 时，Figma 读取会明确报错。

## Deploy on Vercel

项目包含 `vercel.json` 和 `api/index.ts`，同一个 Vercel 项目会部署 Vite 前端和 `/api/*` Serverless Function。

1. 在 Vercel Marketplace 创建 Neon Postgres，并把 `DATABASE_URL` 注入 Production/Preview。
2. 在 Vercel 环境变量中配置 `REVIEW_ACCESS_CODE`、`FIGMA_TOKEN`、`AI_PROVIDER_API_KEY`、`AI_PROVIDER_BASE_URL`、`AI_MODEL`、`MAX_FRAMES_PER_TASK`。
3. 推送到 GitHub 后通过 Vercel Git 集成部署，或运行 `vercel deploy --prod`。
4. 部署后访问 `/api/health`，确认 `storageMode` 为 `neon` 且 Figma/AI 配置状态符合预期。

## MVP Scope

- 访问口令 + 身份选择 + 姓名输入
- 工作台、新建任务、Frame 选择、审核详情
- Figma URL 解析、文件结构读取、顶层 Frame 缩略图、选中 Frame 导出
- AI 初审 JSON 结果、四维评分、问题清单、一票否决列表字段、区域标注建议
- 审核通过规则：总分 `>=85` 且无一票否决。四维权重为品牌一致性 30、排版规范 30、电商表达 25、交付规范 15。
- 重新提交后重新读取 Figma，并在 AI 阶段带入上一轮问题清单用于比对
- VIS 标准源上传、章节解析、展示，并作为模型审核的唯一规则源
- 管理员可切换 OpenAI 兼容模型接口、Base URL、模型名和运行时 Key
- 本地 JSON 基础记录，路径为 `data/reviews.json`
