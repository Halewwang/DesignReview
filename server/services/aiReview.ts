import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { Annotation, ContentType, DimensionKey, ReviewFrame, ReviewIssue, ReviewTask } from "../types.js";
import { readStoreValue, uid, writeStoreValue } from "../db.js";
import { selectRelevantSections, VisRuleSection } from "./vis.js";

export const reviewRubric = {
  passScore: 85,
  vetoPolicy: "总分 >= 85 且没有一票否决项才可通过。",
  vetoIssues: ["Logo 变形", "核心信息缺失", "尺寸严重错误", "严重不可读", "产品失真", "错别字/错误参数", "竞品或错误品牌资产"],
  dimensions: [
    {
      key: "brand_consistency",
      label: "品牌一致性",
      maxScore: 30,
      definition: "是否符合 EMKE warm-minimal、理性、清晰、可信赖的品牌气质，并正确使用品牌资产。",
      deductionGuide: ["Logo、色彩、字体、图片气质与 VIS 不一致", "过度奢华、廉价促销感或装饰噪音削弱品牌识别"]
    },
    {
      key: "layout_standard",
      label: "排版规范",
      maxScore: 30,
      definition: "是否有稳定栅格、清晰层级、合理留白和可读的视觉动线。",
      deductionGuide: ["标题、卖点、规格、CTA 层级不清", "对齐、间距、模块节奏或移动端压缩可读性不足"]
    },
    {
      key: "ecommerce_expression",
      label: "电商表达",
      maxScore: 25,
      definition: "是否把产品、利益点、证明信息和行动路径表达清楚，帮助用户快速决策。",
      deductionGuide: ["核心卖点泛化或缺少 proof/specification", "CTA、价格、活动机制或购买理由不明确"]
    },
    {
      key: "delivery_standard",
      label: "交付规范",
      maxScore: 15,
      definition: "是否满足渠道尺寸、素材完整性、文案准确性和基础交付质量。",
      deductionGuide: ["尺寸/安全区/导出质量不满足渠道要求", "错别字、错误参数、素材缺失或产品图失真"]
    }
  ] as const,
  severityDeductionGuide: {
    严重: "通常扣 8 分以上，并应标记 must_fix；若命中一票否决必须加入 veto_issues。",
    中等: "通常扣 4-8 分，影响主要理解或转化效率。",
    轻微: "通常扣 1-4 分，属于局部一致性或精修问题。",
    建议: "通常扣 0-2 分，只用于非阻断优化。"
  }
};

const dimensionDefaults = Object.fromEntries(
  reviewRubric.dimensions.map((dimension) => [
    dimension.key,
    { score: 0, max_score: dimension.maxScore, comment: "", deduction_items: [] as string[] }
  ])
) as Record<DimensionKey, { score: number; max_score: number; comment: string; deduction_items: string[] }>;

export type AiProviderConfig = {
  providerName: string;
  apiKey?: string;
  baseURL?: string;
  model: string;
  configured: boolean;
  keyPreview?: string;
  source: "env" | "runtime" | "preset";
};

const derouterPreset = {
  providerName: "Derouter",
  baseURL: "https://api.derouter.ai/openai/v1",
  model: "claude-sonnet-4-6"
};

const aiConfigPath = () => process.env.AI_CONFIG_PATH || path.resolve(process.cwd(), "data", "ai-provider.json");

function readRuntimeAiConfig() {
  const configPath = aiConfigPath();
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<AiProviderConfig>;
}

async function readRuntimeAiConfigAsync() {
  if (!usesDatabaseRuntimeConfig()) return readRuntimeAiConfig();
  return (await readStoreValue<Partial<AiProviderConfig>>("ai-provider")) ?? {};
}

export function saveAiProviderConfig(input: Partial<AiProviderConfig>) {
  const current = readRuntimeAiConfig();
  const next = normalizeAiProviderInput(input, current);
  const targetPath = aiConfigPath();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(next, null, 2), "utf8");
  return getAiProviderConfig();
}

export async function saveAiProviderConfigAsync(input: Partial<AiProviderConfig>) {
  if (!usesDatabaseRuntimeConfig()) return saveAiProviderConfig(input);
  const current = await readRuntimeAiConfigAsync();
  const next = normalizeAiProviderInput(input, current);
  await writeStoreValue("ai-provider", next);
  return getAiProviderConfigAsync();
}

function normalizeAiProviderInput(input: Partial<AiProviderConfig>, current: Partial<AiProviderConfig>) {
  const next = {
    providerName: String(input.providerName || derouterPreset.providerName).trim(),
    apiKey: typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : current.apiKey,
    baseURL: String(input.baseURL || derouterPreset.baseURL).trim(),
    model: String(input.model || derouterPreset.model).trim()
  };
  if (!next.baseURL) throw new Error("AI Base URL 不能为空");
  if (!next.model) throw new Error("AI 模型不能为空");
  return next;
}

export function maskApiKey(apiKey?: string) {
  if (!apiKey) return undefined;
  if (apiKey.length <= 10) return "已配置";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function getAiProviderConfig(): AiProviderConfig {
  const runtime = readRuntimeAiConfig();
  return composeAiProviderConfig(runtime);
}

export async function getAiProviderConfigAsync(): Promise<AiProviderConfig> {
  const runtime = await readRuntimeAiConfigAsync();
  return composeAiProviderConfig(runtime);
}

function composeAiProviderConfig(runtime: Partial<AiProviderConfig>): AiProviderConfig {
  const envKey = process.env.AI_PROVIDER_API_KEY || process.env.OPENAI_API_KEY;
  const apiKey = runtime.apiKey || envKey;
  const source = runtime.apiKey || runtime.baseURL || runtime.model ? "runtime" : envKey || process.env.AI_PROVIDER_BASE_URL || process.env.AI_MODEL ? "env" : "preset";
  const baseURL = process.env.AI_PROVIDER_BASE_URL || runtime.baseURL || derouterPreset.baseURL;
  const model = process.env.AI_MODEL || runtime.model || derouterPreset.model;
  return {
    providerName: runtime.providerName || derouterPreset.providerName,
    apiKey,
    baseURL,
    model,
    configured: Boolean(apiKey),
    keyPreview: maskApiKey(apiKey),
    source
  };
}

function usesDatabaseRuntimeConfig() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL);
}

export function normalizeAiReview(input: any) {
  validateAiReviewShape(input);
  const dimension_scores = normalizeDimensionScores(input.dimension_scores ?? input.dimensionScores ?? {});
  const total =
    typeof input.total_score === "number"
      ? input.total_score
      : Object.values(dimension_scores).reduce((sum: number, score: any) => sum + Number(score?.score ?? 0), 0);

  return {
    total_score: Math.max(0, Math.min(100, Math.round(total))),
    conclusion: input.conclusion ?? conclusionFromScore(total),
    standard_source: input.standard_source ?? { file_name: "品牌设计规范.md", brand: "EMKE", version: "Draft v0.1" },
    dimension_scores,
    veto_issues: Array.isArray(input.veto_issues) ? input.veto_issues : [],
    issues: Array.isArray(input.issues) ? normalizeIssueAnnotations(input.issues) : [],
    revision_comparison: input.revision_comparison ?? { resolved: [], unresolved: [], new_issues: [], unknown: [] }
  };
}

function normalizeDimensionScores(input: any) {
  return Object.fromEntries(
    Object.entries(dimensionDefaults).map(([key, defaults]) => {
      const item = input[key] ?? {};
      return [
        key,
        {
          ...defaults,
          ...item,
          deduction_items: Array.isArray(item.deduction_items ?? item.deductionItems) ? item.deduction_items ?? item.deductionItems : []
        }
      ];
    })
  );
}

const issueTypes = new Set(["品牌一致性", "排版规范", "电商表达", "交付规范"]);
const issueSeverities = new Set(["严重", "中等", "轻微", "建议"]);
const resolutionStatuses = new Set(["待解决", "疑似已解决", "仍未解决", "新增问题", "无法判断"]);

function validateAiReviewShape(input: any) {
  const errors: string[] = [];
  const totalScore = input.total_score;
  if (typeof totalScore === "number" && (totalScore < 0 || totalScore > 100)) errors.push("total_score 必须在 0-100");

  const dimensions = input.dimension_scores ?? input.dimensionScores ?? {};
  const dimensionSum = reviewRubric.dimensions.reduce((sum, dimension) => {
    const item = dimensions[dimension.key];
    return sum + Number(item?.score ?? 0);
  }, 0);
  for (const [key, defaultValue] of Object.entries(dimensionDefaults)) {
    const item = dimensions[key];
    if (!item) {
      errors.push(`缺少 ${key} 维度评分`);
      continue;
    }
    if (typeof item.max_score === "number" && item.max_score !== defaultValue.max_score) {
      errors.push(`${key}.max_score 必须等于 ${defaultValue.max_score}`);
    }
    if (typeof item.score === "number" && (item.score < 0 || item.score > defaultValue.max_score)) {
      errors.push(`${key}.score 必须在 0-${defaultValue.max_score}`);
    }
  }
  if (typeof totalScore === "number" && totalScore !== dimensionSum) {
    errors.push(`total_score 必须等于四维得分之和 ${dimensionSum}`);
  }

  if (Array.isArray(input.issues)) {
    input.issues.forEach((issue: any, index: number) => {
      if (issue.type && !issueTypes.has(issue.type)) errors.push(`issues[${index}].type 不合法`);
      if (issue.severity && !issueSeverities.has(issue.severity)) errors.push(`issues[${index}].severity 不合法`);
      const status = issue.resolutionStatus ?? issue.resolution_status;
      if (status && !resolutionStatuses.has(status)) errors.push(`issues[${index}].resolutionStatus 不合法`);
      const annotation = issue.annotation_suggestion ?? issue.annotationSuggestion;
      if (annotation) {
        for (const field of ["x_percent", "y_percent", "width_percent", "height_percent", "xPercent", "yPercent", "widthPercent", "heightPercent"]) {
          if (typeof annotation[field] === "number" && (annotation[field] < 0 || annotation[field] > 100)) {
            errors.push(`issues[${index}].annotation_suggestion.${field} 必须在 0-100`);
          }
        }
        const confidence = annotation.confidence ?? annotation.annotation_confidence ?? issue.annotation_confidence ?? issue.annotationConfidence;
        if (typeof confidence === "number" && (confidence < 0 || confidence > 1)) {
          errors.push(`issues[${index}].annotation_suggestion.confidence 必须在 0-1`);
        }
      }
    });
  }

  if (errors.length) throw new Error(`AI 输出结构不合规：${errors.join("；")}`);
}

function normalizeIssueAnnotations(issues: any[]) {
  return issues.map((issue) => {
    const annotation = issue.annotation_suggestion ?? issue.annotationSuggestion;
    if (!annotation) return issue;
    const confidence = annotation.confidence ?? annotation.annotation_confidence ?? issue.annotation_confidence ?? issue.annotationConfidence;
    return {
      ...issue,
      annotation_suggestion: {
        ...annotation,
        confidence: typeof confidence === "number" ? confidence : 0.7
      }
    };
  });
}

function conclusionFromScore(score: number) {
  if (score >= 85) return "建议通过";
  if (score >= 70) return "建议小幅修改";
  if (score >= 60) return "建议退回修改";
  return "不建议通过";
}

export function compareIssues(previous: Array<Partial<ReviewIssue>>, current: Array<Partial<ReviewIssue>>) {
  const unresolved: Partial<ReviewIssue>[] = [];
  const resolved: Partial<ReviewIssue>[] = [];
  const unknown: Partial<ReviewIssue>[] = [];
  const newIssues: Partial<ReviewIssue>[] = [];
  const matchedCurrent = new Set<number>();

  for (const oldIssue of previous) {
    const index = current.findIndex((issue, currentIndex) => {
      if (matchedCurrent.has(currentIndex)) return false;
      return issueKey(issue) === issueKey(oldIssue) || similarity(issue.title, oldIssue.title) > 0.62;
    });
    if (index >= 0) {
      unresolved.push({ ...oldIssue, resolutionStatus: "仍未解决" as const });
      matchedCurrent.add(index);
    } else if (oldIssue.mustFix) {
      unknown.push({ ...oldIssue, resolutionStatus: "无法判断" as const });
    } else {
      resolved.push({ ...oldIssue, resolutionStatus: "疑似已解决" as const });
    }
  }

  current.forEach((issue, index) => {
    if (!matchedCurrent.has(index)) newIssues.push({ ...issue, resolutionStatus: "新增问题" as const });
  });

  return { resolved, unresolved, new_issues: newIssues, unknown };
}

function issueKey(issue: Partial<ReviewIssue>) {
  return `${issue.frameName ?? ""}::${issue.title ?? ""}`.toLowerCase();
}

function similarity(a = "", b = "") {
  const aChars = new Set(a);
  const bChars = new Set(b);
  const overlap = [...aChars].filter((char) => bChars.has(char)).length;
  return overlap / Math.max(1, Math.max(aChars.size, bChars.size));
}

export async function runAiReview(args: {
  task: ReviewTask;
  frames: ReviewFrame[];
  sections: VisRuleSection[];
  previousIssues: ReviewIssue[];
  standardSource?: { fileName: string; brand: string; version: string; path?: string };
}) {
  const relevantSections = selectRelevantSections(args.sections, args.task.contentType);
  const aiConfig = await getAiProviderConfigAsync();
  const raw = !aiConfig.configured
    ? mockReview(args.task, args.frames, args.previousIssues, args.standardSource)
    : await callVisionModel(args.task, args.frames, relevantSections, args.previousIssues, args.standardSource, aiConfig);
  return normalizeAiReview(raw);
}

export function getDefaultAiModel() {
  return getAiProviderConfig().model;
}

export async function getDefaultAiModelAsync() {
  return (await getAiProviderConfigAsync()).model;
}

async function callVisionModel(
  task: ReviewTask,
  frames: ReviewFrame[],
  sections: VisRuleSection[],
  previousIssues: ReviewIssue[],
  standardSource: { fileName: string; brand: string; version: string; path?: string } | undefined,
  aiConfig: AiProviderConfig
) {
  const client = new OpenAI({
    apiKey: aiConfig.apiKey,
    baseURL: aiConfig.baseURL
  });
  const prompt = buildPrompt(task, sections, previousIssues, standardSource);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...frames
      .filter((frame) => frame.exportedImageUrl)
      .map((frame) => ({
        type: "image_url" as const,
        image_url: { url: frame.exportedImageUrl!, detail: "high" as const }
      }))
  ];
  const completion = await client.chat.completions.create({
    model: aiConfig.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是资深品牌设计审核专家。必须严格基于用户消息中的 VIS 标准源审核 EMKE 设计图，只输出合法 JSON，不输出 Markdown。"
      },
      { role: "user", content }
    ],
    temperature: 0.2
  });
  return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
}

function buildPrompt(
  task: ReviewTask,
  sections: VisRuleSection[],
  previousIssues: ReviewIssue[],
  standardSource?: { fileName: string; brand: string; version: string; path?: string }
) {
  const sourceName = standardSource?.fileName ?? "品牌设计规范.md";
  const sourceVersion = standardSource?.version ?? "Draft v0.1";
  return [
    `任务名称：${task.title}`,
    `内容类型：${task.contentType}`,
    `项目说明：${task.description || "无"}`,
    `审核标准来源：${sourceName} / EMKE / ${sourceVersion}`,
    "以下 VIS 标准源是本次审核的唯一规则依据。必须理解并应用这些章节，不能只概括文件名。",
    sections.map((section) => `## ${section.title}\n${section.content}`).join("\n\n"),
    "评分规则：",
    reviewRubric.dimensions.map((dimension) => `- ${dimension.key} / ${dimension.label}：${dimension.maxScore} 分。${dimension.definition} 典型扣分：${dimension.deductionGuide.join("；")}`).join("\n"),
    `通过规则：${reviewRubric.vetoPolicy}`,
    `一票否决：${reviewRubric.vetoIssues.join("、")}。命中时必须加入 veto_issues，即使总分高于 ${reviewRubric.passScore}。`,
    `严重度扣分参考：${JSON.stringify(reviewRubric.severityDeductionGuide)}`,
    `上一轮问题清单：${JSON.stringify(previousIssues)}`,
    "请使用视觉模型能力直接观察图片区域，对每个明确问题给出可标注位置。坐标必须以对应图片自身左上角为 (0,0)、右下角为 (100,100)，不能按页面留白、浏览器画布或截图外框计算。",
    "total_score 必须等于四个 dimension_scores.*.score 的加总；不要单独估算总分。",
    "dimension_scores 中每个维度必须包含 deduction_items 数组，逐条列出扣分原因；每条扣分必须写清：具体画面/模块/文字或产品元素、违反的标准点、对业务表达的影响。不要只写“层级不足”“品牌感弱”这类泛化结论；没有扣分则返回空数组。",
    "所有 AI 生成的自然语言审核结果必须同时返回中文和英文两个版本。dimension_scores.* 必须包含 comment_i18n:{zh,en} 与 deduction_items_i18n:[{zh,en}]；issues.* 必须包含 title_i18n、location_description_i18n、description_i18n、suggestion_i18n、related_standard_section_i18n。原有中文字段仍保留用于旧流程兼容，英文必须是完整自然英文，不能中英混写。前端会按当前语言直接读取对应版本。",
    `standard_source 必须返回 file_name=${sourceName}, brand=EMKE, version=${sourceVersion}。`,
    "输出字段必须包含 total_score, conclusion, standard_source, dimension_scores, veto_issues, issues, revision_comparison。问题必须尽量关联 related_standard_section，并提供 annotation_suggestion 百分比坐标。annotation_suggestion 必须框选图片中实际问题区域，优先使用 rect，x_percent/y_percent/width_percent/height_percent 均为 0-100；coordinate_origin 必须返回 top_left。如果只能给出中心点坐标，coordinate_origin 返回 center，并保证 width_percent/height_percent 是区域尺寸。如果问题对应文字或模块，框选该文字/模块，不要框选整张图或空白区域。"
  ].join("\n\n");
}

function mockReview(
  task: ReviewTask,
  frames: ReviewFrame[],
  previousIssues: ReviewIssue[],
  standardSource: { fileName: string; brand: string; version: string; path?: string } | undefined
) {
  const issues = frames.slice(0, 3).map((frame, index) => ({
    title: index === 0 ? "卖点层级与产品证明信息需要加强" : "局部信息节奏不够稳定",
    type: index === 0 ? "电商表达" : "排版规范",
    severity: index === 0 ? "中等" : "轻微",
    frame_name: frame.frameName,
    location_description: index === 0 ? "主视觉右侧卖点区域" : "模块标题与说明文字区域",
    description:
      task.contentType === "Amazon A+ 页面"
        ? "当前模块有产品信息，但 feature headline、benefit 与 proof/specification 的关系还不够清楚。"
        : "当前画面具备基础方向，但核心承诺、产品质感和行动路径需要更直接。",
    suggestion: "压缩泛化文案，保留一个核心卖点，并补充可验证的规格或场景证明。",
    related_standard_source: "品牌设计规范.md",
    related_standard_section: task.contentType === "Amazon A+ 页面" ? "Amazon PDP / A+ Content Rules" : "Design Principles",
    must_fix: index === 0,
    annotation_suggestion:
      index === 0
        ? { type: "rect", x_percent: 7, y_percent: 28, width_percent: 36, height_percent: 30, confidence: 0.8 }
        : undefined
  }));

  const dimension_scores = previousIssues.length
    ? {
        brand_consistency: { score: 25, max_score: 30, comment: "品牌气质比上一轮更稳定，但仍需减少泛化视觉语言。", deduction_items: ["产品质感与 EMKE 克制理性气质的关联还可加强"] },
        layout_standard: { score: 25, max_score: 30, comment: "层级和阅读路径已有改善，局部模块节奏仍可收紧。", deduction_items: ["局部留白节奏与画面主体未形成足够明确的阅读路径"] },
        ecommerce_expression: { score: 20, max_score: 25, comment: "卖点表达更直接，但 proof/specification 仍不足。", deduction_items: ["核心卖点缺少 proof/specification 支撑"] },
        delivery_standard: { score: 12, max_score: 15, comment: "未发现严重交付错误，需继续确认渠道尺寸适配。", deduction_items: ["需确认最终渠道尺寸与移动端压缩可读性"] }
      }
    : {
        brand_consistency: { score: 23, max_score: 30, comment: "整体接近 warm-minimal 与 rational clarity，但仍需控制视觉噪音。", deduction_items: ["局部氛围偏泛化，品牌识别点不够集中", "产品质感与 EMKE 克制理性气质的关联还可加强"] },
        layout_standard: { score: 22, max_score: 30, comment: "有基础栅格感，局部模块节奏和阅读路径需要收紧。", deduction_items: ["标题、促销数字和说明文字之间层级关系不够稳定", "局部留白节奏与画面主体未形成明确阅读路径"] },
        ecommerce_expression: { score: 19, max_score: 25, comment: "产品优先级明确，但卖点证明和规格支撑不足。", deduction_items: ["核心卖点缺少 proof/specification 支撑", "CTA 或行动路径不够明确"] },
        delivery_standard: { score: 12, max_score: 15, comment: "未发现严重交付错误，需继续确认渠道尺寸适配。", deduction_items: ["需确认最终渠道尺寸与移动端压缩可读性"] }
      };

  return {
    total_score: Object.values(dimension_scores).reduce((sum, dimension) => sum + dimension.score, 0),
    conclusion: previousIssues.length ? "建议小幅修改" : "建议修改后通过",
    standard_source: { file_name: standardSource?.fileName ?? "品牌设计规范.md", brand: "EMKE", version: standardSource?.version ?? "Draft v0.1" },
    dimension_scores,
    veto_issues: [],
    issues,
    revision_comparison: compareIssues(previousIssues, issues as any)
  };
}

export function toReviewIssue(raw: any, taskId: string, reviewResultId: string, frame?: ReviewFrame, submissionRound = 1): ReviewIssue {
  const description = pickString(raw.description, raw.detail, raw.reason, raw.issue_description, raw.issueDescription);
  const suggestion = pickString(raw.suggestion, raw.recommendation, raw.fix, raw.action, raw.revision_suggestion, raw.revisionSuggestion);
  const locationDescription = pickString(raw.location_description, raw.locationDescription, raw.location, raw.area) ?? "";
  const relatedStandardSection = raw.related_standard_section ?? raw.relatedStandardSection ?? "未关联章节";
  const title = pickString(
    raw.title,
    raw.issue_title,
    raw.issueTitle,
    raw.problem_title,
    raw.problemTitle,
    raw.name,
    raw.summary,
    raw.issue,
    raw.problem
  ) || titleFromText(description, suggestion);
  const annotationSuggestion = normalizeAnnotation(raw.annotation_suggestion ?? raw.annotationSuggestion, raw);

  return {
    id: uid("issue"),
    taskId,
    frameId: frame?.id,
    reviewResultId,
    submissionRound,
    title: title || "未命名问题",
    type: raw.type ?? "品牌一致性",
    severity: raw.severity ?? "建议",
    frameName: raw.frame_name ?? raw.frameName ?? frame?.frameName,
    locationDescription,
    description: description ?? "",
    suggestion: suggestion ?? "",
    relatedStandardSource: raw.related_standard_source ?? raw.relatedStandardSource ?? "品牌设计规范.md",
    relatedStandardSection,
    i18n: normalizeIssueI18n(raw, { title, description, suggestion, locationDescription, relatedStandardSection }),
    mustFix: Boolean(raw.must_fix ?? raw.mustFix),
    resolutionStatus: raw.resolutionStatus ?? raw.resolution_status ?? "待解决",
    annotationSuggestion,
    createdAt: new Date().toISOString()
  };
}

function normalizeAnnotation(annotation: any, raw: any): Annotation | undefined {
  if (!annotation) return undefined;
  const confidence = numberFrom(annotation.confidence, annotation.annotation_confidence, raw.annotation_confidence, raw.annotationConfidence) ?? 0.7;
  if (confidence < 0.7) return undefined;
  const width = percentFrom(annotation.width_percent, annotation.widthPercent, annotation.width, annotation.w) ?? 20;
  const height = percentFrom(annotation.height_percent, annotation.heightPercent, annotation.height, annotation.h) ?? 12;
  const origin = String(annotation.coordinate_origin ?? annotation.coordinateOrigin ?? annotation.origin ?? annotation.anchor ?? "top_left").toLowerCase();
  const rawX = percentFrom(annotation.x_percent, annotation.xPercent, annotation.x, annotation.left, annotation.cx, annotation.center_x, annotation.centerX) ?? 50;
  const rawY = percentFrom(annotation.y_percent, annotation.yPercent, annotation.y, annotation.top, annotation.cy, annotation.center_y, annotation.centerY) ?? 30;
  const isCenter = origin.includes("center") || annotation.cx !== undefined || annotation.cy !== undefined || annotation.center_x !== undefined || annotation.centerY !== undefined;
  const x = isCenter ? rawX - width / 2 : rawX;
  const y = isCenter ? rawY - height / 2 : rawY;
  const safeX = clampPercent(x);
  const safeY = clampPercent(y);
  return {
    type: annotation.type === "point" ? "point" : "rect",
    xPercent: safeX,
    yPercent: safeY,
    widthPercent: Math.min(clampPercent(width), 100 - safeX),
    heightPercent: Math.min(clampPercent(height), 100 - safeY),
    confidence,
    source: annotation.source === "manual" || annotation.source === "migrated" || annotation.source === "mock" ? annotation.source : "ai"
  };
}

function normalizeIssueI18n(raw: any, fallback: Record<string, string | undefined>) {
  const i18n = raw.i18n ?? {};
  const result = {
    title: localizedFrom(raw.title_i18n, raw.titleI18n, i18n.title, fallback.title),
    locationDescription: localizedFrom(raw.location_description_i18n, raw.locationDescriptionI18n, i18n.locationDescription, i18n.location_description, fallback.locationDescription),
    description: localizedFrom(raw.description_i18n, raw.descriptionI18n, i18n.description, fallback.description),
    suggestion: localizedFrom(raw.suggestion_i18n, raw.suggestionI18n, i18n.suggestion, fallback.suggestion),
    relatedStandardSection: localizedFrom(raw.related_standard_section_i18n, raw.relatedStandardSectionI18n, i18n.relatedStandardSection, i18n.related_standard_section, fallback.relatedStandardSection)
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function localizedFrom(...values: unknown[]) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "object") {
      const input = value as Record<string, unknown>;
      const zh = pickString(input.zh, input.zh_cn, input.zhCN, input.cn, input.chinese);
      const en = pickString(input.en, input.en_us, input.enUS, input.english);
      if (zh || en) return { zh, en };
    }
  }
  return undefined;
}

function percentFrom(...values: unknown[]) {
  const value = numberFrom(...values);
  if (value === undefined) return undefined;
  return value > 0 && value <= 1 ? value * 100 : value;
}

function numberFrom(...values: unknown[]) {
  const value = values.find((item) => typeof item === "number" && Number.isFinite(item));
  return typeof value === "number" ? value : undefined;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function pickString(...values: unknown[]) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value.trim() : undefined;
}

function titleFromText(...values: Array<string | undefined>) {
  const source = values.find((value) => value?.trim());
  if (!source) return undefined;
  return source
    .split(/[。.!！?？；;]/)
    .find(Boolean)
    ?.trim()
    .slice(0, 48);
}
