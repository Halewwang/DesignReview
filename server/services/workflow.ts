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

export function normalizeAiOnlyStatus(status: ReviewStatus, score?: number): ReviewStatus {
  if (status === "operation_review" || status === "director_review") {
    return typeof score === "number" && score >= 85 ? "approved" : "needs_revision";
  }
  if (status === "approved" && typeof score === "number" && score < 85) {
    return "needs_revision";
  }
  return status;
}

export function canWithdrawTaskStatus(status: ReviewStatus) {
  return ["frame_selection", "needs_revision", "resubmitted", "figma_read_failed", "ai_review_failed"].includes(status);
}

export function canDeleteTaskStatus(status: ReviewStatus) {
  return ["draft", "figma_reading", "frame_selection", "ai_reviewing", "needs_revision", "resubmitted", "approved", "figma_read_failed", "ai_review_failed", "archived"].includes(status);
}

export function assertCanDeleteTask(currentRole: Role, task: { submitterId?: string; submitterName?: string }, actorName: string) {
  if (currentRole === "管理员") return;
  if (currentRole !== "设计师") throw new Error("当前身份无权删除任务");
  const actor = normalizeActor(actorName);
  const ownerIds = [task.submitterId, task.submitterName].map(normalizeActor).filter(Boolean);
  if (!actor || !ownerIds.includes(actor)) {
    throw new Error("当前身份无权删除他人任务");
  }
}

function normalizeActor(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}
