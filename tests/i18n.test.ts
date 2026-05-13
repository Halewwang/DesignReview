import { describe, expect, it } from "vitest";
import { detectPreferredLanguage, languageLabel } from "../src/shared/i18n";

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
});
