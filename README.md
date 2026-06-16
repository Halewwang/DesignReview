# EMKE Design Review Command Center

内部设计审核 MVP。当前产品流程收敛为 AI-only 自助审核：设计师上传图片或导入 Figma Frame，服务端将审核图送入视觉 AI 初审，系统直接给出通过或需返修结论。上传图片是默认主路径，Figma 链接导入作为高级可选路径：服务端可用团队统一 `FIGMA_TOKEN` 读取 Page 与顶层 Frame，前端展示缩略图、名称和尺寸。AI 仅基于审核图片和 `品牌设计规范.md` 进行结构化初审。

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

默认入口：

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- 默认访问口令：`emke.de`

## Environment

- `FIGMA_TOKEN`: 团队统一 Figma Token，只在服务端使用。
- `MAX_UPLOAD_IMAGES_PER_TASK`: 单个上传或返修审核项目最多图片数，默认 `9`。
- `MAX_FRAMES_PER_TASK`: 单个 Figma 审核项目最多 Frame 数，默认 `12`。
- `API_JSON_LIMIT`: API JSON 请求体上限，默认 `240mb`，用于承载最多 9 张、单张 20MB 的上传图片 data URL。
- `AI_PROVIDER_API_KEY` 或 `OPENAI_API_KEY`: 视觉模型 API Key。也可以在管理员「系统设置」里保存运行时 Key。
- `AI_PROVIDER_BASE_URL`: 兼容 OpenAI Chat Completions 的 Provider Base URL。未配置时预设为 `https://api.derouter.ai/openai/v1`。
- `AI_MODEL`: 默认视觉模型。未配置时预设为 `claude-sonnet-4-6`。
- `BRAND_STANDARD_PATH`: EMKE VIS 标准源。未配置时优先读取管理员上传的 `data/brand-standard.md`，再读取项目根目录 `品牌设计规范.md`。
- `DATABASE_URL` / `POSTGRES_URL`: Postgres 连接串，推荐使用 Supabase Transaction Pooler 或 Vercel Marketplace 数据库。配置后 API 使用 Postgres 持久化任务、结果、日志、运行时 AI 配置和线上上传的 VIS 标准源；未配置时本地 fallback 到 `data/reviews.json`。

未配置 AI Key 时，系统会返回开发占位审核结果，用于本地验证流程；接入真实审核必须配置视觉模型 API Key。未配置 Figma Token 时，Figma 读取会明确报错。

## Deploy on Vercel

项目包含 `vercel.json` 和 `api/index.ts`，同一个 Vercel 项目会部署 Vite 前端和 `/api/*` Serverless Function。

1. 在 Supabase 创建项目，复制 Transaction Pooler 连接串，或使用任意 Vercel 可访问的 Postgres，把连接串配置到 Vercel 的 `DATABASE_URL`。
2. 在 Vercel 环境变量中配置 `REVIEW_ACCESS_CODE`、`FIGMA_TOKEN`、`AI_PROVIDER_API_KEY`、`AI_PROVIDER_BASE_URL`、`AI_MODEL`、`MAX_UPLOAD_IMAGES_PER_TASK`、`MAX_FRAMES_PER_TASK`。
3. 推送到 GitHub 后通过 Vercel Git 集成部署，或运行 `vercel deploy --prod`。
4. 部署后访问 `/api/health`，确认 `storageMode` 为 `postgres` 且 Figma/AI 配置状态符合预期。

## MVP Scope

- 访问口令 + 设计师/管理员身份选择 + 姓名输入
- 工作台、新建任务、Frame 选择、AI 审核详情
- 上传图片创建审核项目，单个项目最多 9 张图，返修上传复用同一限制
- Figma URL 解析、文件结构读取、顶层 Frame 缩略图、选中 Frame 导出
- AI 初审 JSON 结果、五维评分、问题清单、一票否决列表字段、区域标注建议
- 审核通过规则：总分 `>=85` 且无一票否决。五维权重为品牌一致性 25、排版规范 25、电商表达 25、交付规范 15、设计系统纪律 10；所有维度均以 EMKE VIS 标准源为最高依据。
- 重新提交后重新读取 Figma，并在 AI 阶段带入上一轮问题清单用于比对
- VIS 标准源上传、章节解析、展示，并作为模型审核的唯一规则源
- 管理员可切换 OpenAI 兼容模型接口、Base URL、模型名和运行时 Key；设计师负责提交、返修、撤回和删除本人任务
- 本地 JSON 基础记录，路径为 `data/reviews.json`
