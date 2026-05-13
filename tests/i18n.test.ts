import { describe, expect, it } from "vitest";
import { detectPreferredLanguage, hasHanText, languageLabel, localizeDynamicText } from "../src/shared/i18n";

describe("language preference", () => {
  it("uses a saved language before browser languages", () => {
    expect(detectPreferredLanguage("en", ["zh-CN"])).toBe("en");
    expect(detectPreferredLanguage("zh", ["en-US"])).toBe("zh");
  });

  it("falls back to browser languages when no valid language is saved", () => {
    expect(detectPreferredLanguage(null, ["zh-CN", "en-US"])).toBe("zh");
    expect(detectPreferredLanguage("de", ["en-US", "zh-CN"])).toBe("en");
    expect(detectPreferredLanguage(null, [])).toBe("en");
  });

  it("returns localized labels for business values without changing stored values", () => {
    expect(languageLabel("zh", "needs_revision")).toBe("需修改");
    expect(languageLabel("en", "needs_revision")).toBe("Needs revision");
    expect(languageLabel("en", "官网 Banner")).toBe("Website banner");
  });

  it("localizes stored review logs and AI text for English display", () => {
    expect(localizeDynamicText("en", "更新任务名称或提交人 ID")).toBe("Updated task name or submitter ID");
    expect(localizeDynamicText("en", "AI 初审超时，请刷新后重新发起")).toBe("AI pre-review timed out. Refresh and retry.");
    expect(localizeDynamicText("en", "上传 1 张图片并创建审核任务")).toBe("Uploaded 1 image(s) and created review task");
    expect(localizeDynamicText("en", "Hero Logo 放在复杂百叶窗背景上")).toBe("Hero logo is placed over a complex shutter background");
  });

  it("localizes observed Chinese AI review sentences without leaving Han characters", () => {
    const localized = localizeDynamicText(
      "en",
      "左侧主headline为白字叠在浅灰块面上，虽然字号较大，但局部contrast较insufficient，移动端压缩后readability会下降。"
    );

    expect(localized).toContain("contrast is insufficient");
    expect(hasHanText(localized)).toBe(false);
  });
});
