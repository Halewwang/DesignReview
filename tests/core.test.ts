import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "../server/services/figma";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBrandStandard, parseMarkdownSections, saveUploadedBrandStandard, selectRelevantSections } from "../server/services/vis";
import { compareIssues, getAiProviderConfig, getDefaultAiModel, normalizeAiReview, saveAiProviderConfig } from "../server/services/aiReview";
import { decodeHeaderValue, encodeHeaderValue } from "../src/shared/headerEncoding";

describe("parseFigmaUrl", () => {
  it("extracts file key and node id from design URLs", () => {
    expect(
      parseFigmaUrl("https://www.figma.com/design/AbC1234567890/EMKE?node-id=12-34&t=x")
    ).toEqual({ fileKey: "AbC1234567890", nodeId: "12:34" });
  });

  it("rejects non-Figma URLs", () => {
    expect(() => parseFigmaUrl("https://example.com/file/abc")).toThrow(/Figma/);
  });
});

describe("VIS markdown parsing", () => {
  const markdown = [
    "# EMKE",
    "Intro",
    "## 1. Style Essence",
    "Warm minimal.",
    "## 4. Color Tokens",
    "Use teal sparingly.",
    "## 13. Amazon PDP / A+ Content Rules",
    "Product first."
  ].join("\n");

  it("splits markdown headings into typed rule sections", () => {
    const sections = parseMarkdownSections(markdown);

    expect(sections.map((section) => section.title)).toEqual([
      "EMKE",
      "1. Style Essence",
      "4. Color Tokens",
      "13. Amazon PDP / A+ Content Rules"
    ]);
    expect(sections[2].ruleType).toBe("color");
    expect(sections[3].ruleType).toBe("amazon");
  });

  it("selects Amazon-specific sections for Amazon A+ reviews", () => {
    const selected = selectRelevantSections(parseMarkdownSections(markdown), "Amazon A+ 页面");

    expect(selected.some((section) => section.ruleType === "amazon")).toBe(true);
    expect(selected.some((section) => section.ruleType === "color")).toBe(true);
  });

  it("saves uploaded VIS markdown as the active model standard source", () => {
    const originalPath = process.env.BRAND_STANDARD_UPLOAD_PATH;
    const originalEnvPath = process.env.BRAND_STANDARD_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "emke-vis-"));
    const uploadPath = path.join(tempDir, "uploaded-standard.md");
    process.env.BRAND_STANDARD_UPLOAD_PATH = uploadPath;
    delete process.env.BRAND_STANDARD_PATH;

    saveUploadedBrandStandard("# Uploaded VIS\n\n## Color\nUse exact teal.");
    const standard = loadBrandStandard();

    expect(standard.path).toBe(uploadPath);
    expect(standard.fileName).toBe("uploaded-standard.md");
    expect(standard.content).toContain("Use exact teal.");

    if (originalPath) process.env.BRAND_STANDARD_UPLOAD_PATH = originalPath;
    else delete process.env.BRAND_STANDARD_UPLOAD_PATH;
    if (originalEnvPath) process.env.BRAND_STANDARD_PATH = originalEnvPath;
  });
});

describe("AI review normalization", () => {
  it("defaults to the preset Derouter model for AI review", () => {
    const original = process.env.AI_MODEL;
    delete process.env.AI_MODEL;

    expect(getDefaultAiModel()).toBe("claude-sonnet-4-6");

    if (original) process.env.AI_MODEL = original;
  });

  it("uses the preset Derouter provider and can switch runtime key/model info", () => {
    const originalConfigPath = process.env.AI_CONFIG_PATH;
    const originalKey = process.env.AI_PROVIDER_API_KEY;
    const originalBaseUrl = process.env.AI_PROVIDER_BASE_URL;
    const originalModel = process.env.AI_MODEL;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "emke-ai-"));
    process.env.AI_CONFIG_PATH = path.join(tempDir, "ai-config.json");
    delete process.env.AI_PROVIDER_API_KEY;
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_MODEL;

    expect(getAiProviderConfig()).toMatchObject({
      providerName: "Derouter",
      baseURL: "https://api.derouter.ai/openai/v1",
      model: "claude-sonnet-4-6",
      configured: false
    });

    saveAiProviderConfig({
      providerName: "Derouter",
      apiKey: "sk-runtime-new-key",
      baseURL: "https://api.derouter.ai/openai/v1",
      model: "claude-sonnet-4-6"
    });

    expect(getAiProviderConfig()).toMatchObject({
      apiKey: "sk-runtime-new-key",
      keyPreview: "sk-r...-key",
      configured: true,
      model: "claude-sonnet-4-6"
    });

    if (originalConfigPath) process.env.AI_CONFIG_PATH = originalConfigPath;
    else delete process.env.AI_CONFIG_PATH;
    if (originalKey) process.env.AI_PROVIDER_API_KEY = originalKey;
    if (originalBaseUrl) process.env.AI_PROVIDER_BASE_URL = originalBaseUrl;
    if (originalModel) process.env.AI_MODEL = originalModel;
  });

  it("normalizes missing totals from dimension scores", () => {
    const review = normalizeAiReview({
      conclusion: "建议小幅修改",
      dimension_scores: {
        brand_consistency: { score: 24, max_score: 30, comment: "ok" },
        layout_standard: { score: 23, max_score: 30, comment: "ok" },
        ecommerce_expression: { score: 20, max_score: 25, comment: "ok" },
        delivery_standard: { score: 12, max_score: 15, comment: "ok" }
      },
      issues: []
    });

    expect(review.total_score).toBe(79);
    expect(review.veto_issues).toEqual([]);
  });

  it("marks exact recurring issues as unresolved and unmatched previous issues as unknown", () => {
    const result = compareIssues(
      [{ title: "Logo 复杂背景不可读", frameName: "Hero", description: "Logo 识别困难" }],
      [{ title: "Logo 复杂背景不可读", frameName: "Hero", description: "Logo 仍然识别困难" }]
    );

    expect(result.unresolved).toHaveLength(1);
    expect(result.resolved).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);
  });
});

describe("header encoding", () => {
  it("keeps Chinese actor metadata safe for fetch headers", () => {
    const encoded = encodeHeaderValue("管理员");

    expect(() => new Headers({ "x-actor-role": encoded })).not.toThrow();
    expect(decodeHeaderValue(encoded)).toBe("管理员");
  });
});
