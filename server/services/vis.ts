import fs from "node:fs";
import path from "node:path";
import { ContentType } from "../types";
import { getStorageMode, readStoreValue, writeStoreValue } from "../db";

export type RuleType =
  | "brand"
  | "color"
  | "typography"
  | "logo"
  | "layout"
  | "image"
  | "amazon"
  | "web"
  | "copy"
  | "accessibility"
  | "agent"
  | "general";

export type VisRuleSection = {
  id: string;
  title: string;
  headingLevel: number;
  content: string;
  ruleType: RuleType;
  applicableContentTypes: ContentType[];
};

const allTypes: ContentType[] = ["电商页面", "Amazon A+ 页面", "官网 Banner"];
const defaultUploadedStandardPath = () => path.resolve(process.cwd(), "data", "brand-standard.md");

export function loadBrandStandard() {
  const candidates = [
    process.env.BRAND_STANDARD_PATH,
    process.env.BRAND_STANDARD_UPLOAD_PATH,
    defaultUploadedStandardPath(),
    path.resolve(process.cwd(), "品牌设计规范.md"),
    "/Users/hale/Downloads/品牌设计规范.md"
  ].filter(Boolean) as string[];
  const standardPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!standardPath) throw new Error("未找到品牌设计规范.md，请设置 BRAND_STANDARD_PATH");
  const content = fs.readFileSync(standardPath, "utf8");
  return {
    fileName: path.basename(standardPath),
    brand: "EMKE",
    version: "Draft v0.1",
    path: standardPath,
    content
  };
}

export async function loadBrandStandardAsync() {
  if (getStorageMode() === "postgres") {
    const uploaded = await readStoreValue<{ fileName: string; content: string }>("brand-standard");
    if (uploaded?.content) {
      return {
        fileName: uploaded.fileName || "brand-standard.md",
        brand: "EMKE",
        version: "Draft v0.1",
        path: "postgres://emke_design_review_store/brand-standard",
        content: uploaded.content
      };
    }
  }
  return loadBrandStandard();
}

export function saveUploadedBrandStandard(content: string, fileName = "brand-standard.md") {
  const normalized = content.trim();
  if (!normalized) throw new Error("VIS 标准源内容不能为空");
  if (!/^#{1,6}\s+/m.test(normalized)) throw new Error("VIS 标准源必须是包含 Markdown 标题的文本");

  const targetPath = process.env.BRAND_STANDARD_UPLOAD_PATH || defaultUploadedStandardPath();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, normalized.endsWith("\n") ? normalized : `${normalized}\n`, "utf8");
  return {
    fileName: path.basename(fileName || targetPath),
    storedFileName: path.basename(targetPath),
    path: targetPath,
    content: fs.readFileSync(targetPath, "utf8")
  };
}

export async function saveUploadedBrandStandardAsync(content: string, fileName = "brand-standard.md") {
  const normalized = validateBrandStandardContent(content);
  if (getStorageMode() === "postgres") {
    await writeStoreValue("brand-standard", { fileName: fileName || "brand-standard.md", content: normalized });
    return {
      fileName: fileName || "brand-standard.md",
      storedFileName: "brand-standard",
      path: "postgres://emke_design_review_store/brand-standard",
      content: normalized
    };
  }
  return saveUploadedBrandStandard(content, fileName);
}

function validateBrandStandardContent(content: string) {
  const normalized = content.trim();
  if (!normalized) throw new Error("VIS 标准源内容不能为空");
  if (!/^#{1,6}\s+/m.test(normalized)) throw new Error("VIS 标准源必须是包含 Markdown 标题的文本");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function parseMarkdownSections(markdown: string): VisRuleSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: VisRuleSection[] = [];
  let current: { title: string; headingLevel: number; content: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      if (current) sections.push(toSection(current));
      current = { headingLevel: heading[1].length, title: heading[2].trim(), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(toSection(current));
  return sections;
}

function toSection(section: { title: string; headingLevel: number; content: string[] }): VisRuleSection {
  const ruleType = inferRuleType(section.title);
  return {
    id: section.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-|-$/g, ""),
    title: section.title,
    headingLevel: section.headingLevel,
    content: section.content.join("\n").trim(),
    ruleType,
    applicableContentTypes: applicableTypes(ruleType)
  };
}

export function inferRuleType(title: string): RuleType {
  const text = title.toLowerCase();
  if (/color|色彩/.test(text)) return "color";
  if (/typography|typeface|font|字体/.test(text)) return "typography";
  if (/logo/.test(text)) return "logo";
  if (/layout|grid|spatial|排版|栅格/.test(text)) return "layout";
  if (/image|photo|图片|imagery/.test(text)) return "image";
  if (/amazon|a\+|pdp/.test(text)) return "amazon";
  if (/web|banner|官网/.test(text)) return "web";
  if (/tone|copy|communication|文案/.test(text)) return "copy";
  if (/accessibility|readability|可读/.test(text)) return "accessibility";
  if (/agent|ai/.test(text)) return "agent";
  if (/style|positioning|principle|brand|essence|品牌/.test(text)) return "brand";
  return "general";
}

function applicableTypes(ruleType: RuleType): ContentType[] {
  if (ruleType === "amazon") return ["Amazon A+ 页面"];
  if (ruleType === "web") return ["电商页面", "官网 Banner"];
  return allTypes;
}

export function selectRelevantSections(sections: VisRuleSection[], contentType: ContentType) {
  return sections.filter((section) => section.applicableContentTypes.includes(contentType));
}
