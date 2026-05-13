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
