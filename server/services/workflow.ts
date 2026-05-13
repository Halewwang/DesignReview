import { ReviewStatus, Role } from "../types.js";

export function assertTransition(current: ReviewStatus, allowed: ReviewStatus[], action: string) {
  if (!allowed.includes(current)) {
    throw new Error(`当前状态不允许${action}`);
  }
}

export function assertRole(current: Role, allowed: Role[], action: string) {
  if (current === "管理员") return;
  if (!allowed.includes(current)) {
    throw new Error(`当前身份无权${action}`);
  }
}

export function getPreviousIssueRound(currentRound: number, issueRounds: number[]) {
  const previousRounds = issueRounds.filter((round) => round < currentRound);
  if (previousRounds.length === 0) return undefined;
  return Math.max(...previousRounds);
}

export function getAiDecisionStatus(totalScore: number, vetoIssues: unknown[]) {
  return totalScore >= 85 && vetoIssues.length === 0 ? "approved" : "needs_revision";
}

export function canWithdrawTaskStatus(status: ReviewStatus) {
  return ["frame_selection", "needs_revision", "resubmitted", "figma_read_failed", "ai_review_failed"].includes(status);
}

export function canDeleteTaskStatus(status: ReviewStatus) {
  return ["draft", "figma_reading", "frame_selection", "ai_reviewing", "needs_revision", "resubmitted", "approved", "figma_read_failed", "ai_review_failed", "archived"].includes(status);
}
