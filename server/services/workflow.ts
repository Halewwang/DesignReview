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
  return ["draft", "figma_reading", "frame_selection", "ai_reviewing", "needs_revision", "resubmitted", "approved", "figma_read_failed", "ai_review_failed", "archived", "withdrawn"].includes(status);
}

export function assertCanDeleteTask(currentRole: Role, task: { submitterId?: string; submitterName?: string }, actorName: string) {
  assertTaskPermission(currentRole, task, actorName, "删除");
}

export function canViewTask(
  currentRole: Role,
  task: { submitterId?: string; submitterName?: string },
  actorIdentity: string
) {
  if (currentRole === "运营" || currentRole === "管理员") return true;
  if (currentRole !== "设计师") return false;
  const actor = normalizeActor(actorIdentity);
  const ownerIdentity = normalizeActor(task.submitterId ?? task.submitterName);
  return Boolean(actor && ownerIdentity === actor);
}

export function assertTaskViewPermission(
  currentRole: Role,
  task: { submitterId?: string; submitterName?: string },
  actorIdentity: string
) {
  if (!canViewTask(currentRole, task, actorIdentity)) {
    throw new Error("当前身份无权查看他人任务");
  }
}

export function assertTaskPermission(currentRole: Role, task: { submitterId?: string; submitterName?: string }, actorIdentity: string, action: string) {
  if (currentRole === "管理员") return;
  if (currentRole !== "设计师") throw new Error(`当前身份无权${action}任务`);
  const actor = normalizeActor(actorIdentity);
  const ownerIds = [task.submitterId, task.submitterName].map(normalizeActor).filter(Boolean);
  if (!actor || !ownerIds.includes(actor)) {
    throw new Error(`当前身份无权${action}他人任务`);
  }
}

function normalizeActor(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}
