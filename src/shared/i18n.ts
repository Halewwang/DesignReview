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
  [/见画面标注 #(\d+)/g, "See canvas annotation #$1"],
  [/左侧模块headline、说明、六个模式卡与右侧产品符号之间缺少清晰的 Amazon 24 栅格关系；功能卡高度较大且纵向堆叠过重，信息区压缩感明显。/g, "The left module headline, description, six mode cards, and right-side product symbol lack a clear Amazon 24 grid relationship; the function cards are too tall and vertically heavy, creating visible compression."],
  [/左侧主headline为白字叠在浅灰块面上，虽然字号较大，但局部contrast较insufficient，移动端压缩后readability会下降。/g, "The left main headline uses white text over a light gray block. Although the type is large, local contrast is insufficient and readability will drop after mobile compression."],
  [/右侧topheadline与下方四宫格之间留白较大，而四宫格内部卡片text靠近底边，模块节奏割裂后紧。/g, "There is too much spacing between the right-side top headline and the grid below, while card text sits too close to the bottom edge, making the module rhythm feel disconnected and tight."],
  [/左侧模块的六个功能卡use大量识别度半透明底色，占据视觉面积较高，且没有use EMKE Teal 作为类型识别点，整体更偏深色促销\/APP 控件风格。/g, "The six function cards on the left use large translucent blocks with high visual weight and do not use EMKE Teal as the category cue, making the design feel more like dark promotional/app UI styling."],
  [/右侧四张功能卡bottom统一use较重的深色渐变遮罩，品牌气质偏厚重，局部接近地产\/家居宣传图的氛围化表达。/g, "The four right-side function cards use a heavy dark bottom gradient, making the brand tone feel too dense and closer to atmospheric real-estate/home advertising."],
  [/整体画面未出现 EMKE Logo 或明确品牌识别元素，仅依赖产品图和通用功能copy，A\+ 页面品牌记忆点 insufficient。/g, "The overall image does not show the EMKE logo or clear brand identifiers, relying only on product imagery and generic feature copy, so the A+ page brand memory is insufficient."],
  [/右侧上方右卡副copy“Für konstanten, komfortablen Raumklima”存在德语语法错误。/g, "The subcopy on the upper-right card, \"Für konstanten, komfortablen Raumklima\", contains a German grammar error."],
  [/左侧bottom右卡“Anti-Bakteriell”本地化写法不规范。/g, "The bottom-right card on the left uses a non-standard localization of \"Anti-Bakteriell\"."],
  [/未命名问题/g, "Untitled issue"]
];

const dynamicTermTranslations: Array<[string, string]> = [
  ["左侧模块", "left module"],
  ["右侧模块", "right module"],
  ["左侧主", "left main"],
  ["右侧上方右卡", "upper-right card"],
  ["左侧bottom右卡", "bottom-right card on the left"],
  ["六个模式卡", "six mode cards"],
  ["四宫格", "four-card grid"],
  ["功能卡", "function cards"],
  ["产品符号", "product symbol"],
  ["栅格关系", "grid relationship"],
  ["信息区", "information area"],
  ["压缩感", "compressed feeling"],
  ["半透明底色", "translucent background color"],
  ["视觉面积", "visual area"],
  ["识别点", "recognition cue"],
  ["深色渐变遮罩", "dark gradient overlay"],
  ["品牌气质", "brand tone"],
  ["氛围化表达", "atmospheric expression"],
  ["品牌识别元素", "brand identity elements"],
  ["品牌记忆点", "brand memory point"],
  ["德语语法错误", "German grammar error"],
  ["本地化写法不规范", "non-standard localization"],
  ["缺少清晰的", "lacks a clear"],
  ["高度较大", "too tall"],
  ["纵向堆叠过重", "too vertically heavy"],
  ["压缩感明显", "visibly compressed"],
  ["字号较大", "large type size"],
  ["局部", "local"],
  ["移动端压缩后", "after mobile compression"],
  ["会下降", "will decrease"],
  ["之间", "between"],
  ["留白较大", "too much spacing"],
  ["内部", "inside"],
  ["靠近底边", "close to the bottom edge"],
  ["模块节奏", "module rhythm"],
  ["割裂", "disconnected"],
  ["后紧", "then tight"],
  ["占据", "occupies"],
  ["较高", "high"],
  ["没有", "does not"],
  ["作为", "as"],
  ["类型", "category"],
  ["整体", "overall"],
  ["更偏", "leans toward"],
  ["深色", "dark"],
  ["促销", "promotional"],
  ["控件风格", "control style"],
  ["统一", "uniformly"],
  ["较重", "heavy"],
  ["偏厚重", "too heavy"],
  ["接近", "close to"],
  ["地产", "real estate"],
  ["家居宣传图", "home advertising image"],
  ["画面", "image"],
  ["未出现", "does not show"],
  ["明确", "clear"],
  ["仅依赖", "only relies on"],
  ["产品图", "product image"],
  ["通用", "generic"],
  ["存在", "has"],
  ["右卡", "right card"],
  ["上方", "upper"],
  ["下方", "lower"],
  ["底边", "bottom edge"],
  ["卡片", "card"],
  ["说明", "description"],
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

export function hasHanText(value: unknown): boolean {
  return /[\u3400-\u9fff]/.test(String(value ?? ""));
}
