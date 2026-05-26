import { hasHanText, localizeDynamicText, type Language } from "./i18n";

export type LocalizedText = { zh?: string; en?: string };

export const missingEnglishReviewText = "English review text is unavailable for this item.";

export function reviewText(language: Language, value: unknown, fallback: unknown) {
  if (value && typeof value === "object") {
    const localized = value as LocalizedText;
    const exact = clean(localized[language]);
    if (exact) return exact;
    const alternate = clean(language === "en" ? localized.zh : localized.en);
    if (language === "zh" && alternate) return localizeDynamicText(language, alternate);
  }

  const direct = clean(value);
  if (direct) {
    if (language === "en" && hasHanText(direct)) return completeEnglishOrMissing(direct);
    return localizeDynamicText(language, direct);
  }

  const fallbackText = clean(fallback);
  if (!fallbackText) return "";
  if (language === "en" && hasHanText(fallbackText)) return completeEnglishOrMissing(fallbackText);
  return localizeDynamicText(language, fallbackText);
}

export function localizedArrayItem(values: unknown, index: number) {
  return Array.isArray(values) ? values[index] : undefined;
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function completeEnglishOrMissing(value: string) {
  const translated = localizeDynamicText("en", value);
  return hasHanText(translated) ? missingEnglishReviewText : translated;
}
