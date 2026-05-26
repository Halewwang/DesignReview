import { describe, expect, it } from "vitest";
import { hasHanText } from "../src/shared/i18n";
import { reviewText } from "../src/shared/localizedReviewText";

describe("localized review text selection", () => {
  it("uses explicit English AI text without mixing fallback Chinese", () => {
    expect(
      reviewText(
        "en",
        { zh: "当前模块有产品信息，但 feature headline、benefit 与 proof/specification 的关系还不够清楚。", en: "The current module includes product information, but the relationship between the feature headline, benefit, and proof or specification is still unclear." },
        "当前模块有产品信息，但 feature headline、benefit 与 proof/specification 的关系还不够清楚。"
      )
    ).toBe("The current module includes product information, but the relationship between the feature headline, benefit, and proof or specification is still unclear.");
  });

  it("does not fabricate mixed Chinese-English text when English AI text is missing", () => {
    const text = reviewText(
      "en",
      undefined,
      "这是一条尚未提供英文版本的全新审核意见。"
    );

    expect(text).toBe("English review text is unavailable for this item.");
    expect(hasHanText(text)).toBe(false);
  });
});
