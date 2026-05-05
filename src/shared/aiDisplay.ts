export function formatDeductionItem(item: unknown): string {
  if (item == null) return "未命名扣分项";
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
  if (Array.isArray(item)) return item.map(formatDeductionItem).filter(Boolean).join("；") || "未命名扣分项";
  if (typeof item === "object") {
    const value = item as Record<string, unknown>;
    const candidates = [value.reason, value.description, value.title, value.issue, value.comment, value.text, value.label].filter(Boolean);
    if (candidates.length) return candidates.map((candidate) => formatDeductionItem(candidate)).join("；");
    return Object.entries(value)
      .filter(([, entry]) => entry != null && typeof entry !== "object")
      .map(([key, entry]) => `${key}: ${String(entry)}`)
      .join("；") || "未命名扣分项";
  }
  return String(item);
}
