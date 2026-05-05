export type ScoreTone = "danger" | "orange" | "warning" | "success";

export function scoreTone(score: unknown): ScoreTone {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 60) return "danger";
  if (value < 70) return "orange";
  if (value < 85) return "warning";
  return "success";
}
