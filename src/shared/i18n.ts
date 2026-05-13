export type Language = "zh" | "en";

const languages: Language[] = ["zh", "en"];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && languages.includes(value as Language);
}

export function detectPreferredLanguage(savedLanguage: unknown, browserLanguages: readonly string[]): Language {
  if (isLanguage(savedLanguage)) return savedLanguage;
  const normalized = browserLanguages.map((language) => language.toLowerCase());
  if (normalized.some((language) => language.startsWith("zh"))) return "zh";
  return "en";
}

const labels: Record<Language, Record<string, string>> = {
  zh: {
    "needs_revision": "需修改",
    "approved": "已通过",
    "frame_selection": "待选择 Frame",
    "ai_reviewing": "AI 审核中",
    "figma_reading": "读取 Figma 中",
    "resubmitted": "已重新提交",
    "draft": "草稿",
    "archived": "已撤回",
    "figma_read_failed": "Figma 读取失败",
    "ai_review_failed": "AI 审核失败",
    "failed": "失败",
    "in_progress": "进行中",
    "电商页面": "电商页面",
    "Amazon A+ 页面": "Amazon A+ 页面",
    "官网 Banner": "官网 Banner",
    "设计师": "设计师",
    "运营": "运营",
    "设计总监": "设计总监",
    "管理员": "管理员",
    "普通": "普通",
    "加急": "加急",
    "品牌一致性": "品牌一致性",
    "排版规范": "排版规范",
    "电商表达": "电商表达",
    "交付规范": "交付规范",
    "严重": "严重",
    "中等": "中等",
    "轻微": "轻微",
    "建议": "建议"
  },
  en: {
    "needs_revision": "Needs revision",
    "approved": "Approved",
    "frame_selection": "Frame selection",
    "ai_reviewing": "AI reviewing",
    "figma_reading": "Reading Figma",
    "resubmitted": "Resubmitted",
    "draft": "Draft",
    "archived": "Withdrawn",
    "figma_read_failed": "Figma read failed",
    "ai_review_failed": "AI review failed",
    "failed": "Failed",
    "in_progress": "In progress",
    "电商页面": "E-commerce page",
    "Amazon A+ 页面": "Amazon A+ page",
    "官网 Banner": "Website banner",
    "设计师": "Designer",
    "运营": "Operations",
    "设计总监": "Design director",
    "管理员": "Admin",
    "普通": "Normal",
    "加急": "Urgent",
    "品牌一致性": "Brand consistency",
    "排版规范": "Layout standards",
    "电商表达": "Commerce expression",
    "交付规范": "Delivery standards",
    "严重": "Critical",
    "中等": "Medium",
    "轻微": "Minor",
    "建议": "Suggestion"
  }
};

export function languageLabel(language: Language, value: string): string {
  return labels[language][value] ?? value;
}

const exactDynamicTranslations: Record<string, string> = {
  "更新任务名称或提交人 ID": "Updated task name or submitter ID",
  "完成 AI 初审": "Completed AI pre-review",
  "创建审核任务": "Created review task",
  "读取 Figma 文件结构": "Read Figma file structure",
  "重新提交": "Resubmitted",
  "撤回审核任务": "Withdrew review task",
  "未指定区域": "Unspecified area",
  "无明确扣分项": "No clear deduction items",
  "建议小幅修改": "Minor revisions suggested",
  "建议修改": "Revision suggested",
  "通过": "Approved",
  "未通过": "Not approved",
  "Logo 背后是密集横向百叶窗纹理，未满足 EMKE Logo 在图片上应避开复杂区域、保持强对比和净空的要求。": "The logo sits over dense horizontal shutter texture, which does not meet EMKE requirements to avoid complex image areas and keep strong contrast and clear space.",
  "Hero Logo 放在复杂百叶窗背景上": "Hero logo is placed over a complex shutter background",
  "Hero 文案可读性受百叶窗纹理干扰": "Hero copy readability is disrupted by shutter texture"
};

const dynamicPhraseTranslations: Array<[RegExp, string]> = [
  [/^上传 (\d+) 张图片并创建审核任务$/, "Uploaded $1 image(s) and created review task"],
  [/^上传 (\d+) 张图片并重新提交$/, "Uploaded $1 image(s) and resubmitted"],
  [/^选择 (\d+) 个 Frame$/, "Selected $1 Frame(s)"],
  [/^第 (\d+) 轮提交$/, "Round $1 submission"],
  [/画面标注 #(\d+)/g, "canvas annotation #$1"],
  [/见画面标注 #(\d+)/g, "See canvas annotation #$1"]
];

const dynamicTermTranslations: Array<[string, string]> = [
  ["品牌一致性", "brand consistency"],
  ["排版规范", "layout standards"],
  ["电商表达", "commerce expression"],
  ["交付规范", "delivery standards"],
  ["严重", "critical"],
  ["中等", "medium"],
  ["轻微", "minor"],
  ["建议", "suggestion"],
  ["左上角", "top-left"],
  ["右下角", "bottom-right"],
  ["底部", "bottom"],
  ["顶部", "top"],
  ["背景", "background"],
  ["复杂", "complex"],
  ["百叶窗", "shutter"],
  ["纹理", "texture"],
  ["图片", "image"],
  ["文字", "text"],
  ["文案", "copy"],
  ["标题", "headline"],
  ["副标题", "subheading"],
  ["区域", "area"],
  ["可读性", "readability"],
  ["对比", "contrast"],
  ["不足", "insufficient"],
  ["不完全一致", "not fully consistent"],
  ["建议", "recommend"],
  ["增强", "increase"],
  ["使用", "use"],
  ["保持", "keep"],
  ["调整", "adjust"],
  ["避免", "avoid"],
  ["放置", "placement"],
  ["未满足", "does not meet"],
  ["要求", "requirements"],
  ["审核任务", "review task"],
  ["提交人", "submitter"]
];

export function localizeDynamicText(language: Language, value: unknown): string {
  const text = String(value ?? "");
  if (language === "zh" || !text) return text;
  if (exactDynamicTranslations[text]) return exactDynamicTranslations[text];
  const matchedPattern = dynamicPhraseTranslations.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  );
  if (matchedPattern !== text) return matchedPattern;
  return dynamicTermTranslations.reduce(
    (current, [source, replacement]) => current.replaceAll(source, replacement),
    text
  );
}
