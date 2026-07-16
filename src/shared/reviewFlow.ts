export type ReviewFlowStatus =
  | "draft"
  | "figma_reading"
  | "frame_selection"
  | "ai_reviewing"
  | "needs_revision"
  | "resubmitted"
  | "approved"
  | "archived"
  | "withdrawn"
  | "voided"
  | "figma_read_failed"
  | "ai_review_failed";

export type ReviewFlowTask = {
  status?: string;
  submitterName?: string;
  submitterId?: string;
  aiTotalScore?: number;
};

export type ReviewFlowUser = {
  currentUserId?: string;
  currentUserName?: string;
};

export type ReviewTimelineStageKey = "intake" | "ai_review" | "ai_decision" | "revision" | "approved";
export type ReviewTimelineStageState = "complete" | "active" | "idle" | "blocked";

export type ReviewTimelineStage = {
  key: ReviewTimelineStageKey;
  state: ReviewTimelineStageState;
};

export type ReviewAppView = "dashboard" | "new" | "frames" | "detail" | "vis" | "settings";

export type ReviewNavigationState = {
  view: ReviewAppView;
  activeTaskId: string | null;
};

export type ReviewRoundRecord = {
  submissionRound?: number;
};

const actionStatuses = new Set(["draft", "frame_selection", "figma_read_failed", "ai_review_failed"]);
const liveReviewStatuses = new Set(["figma_reading", "ai_reviewing", "resubmitted"]);
const referenceStatuses = new Set(["approved", "archived", "withdrawn", "voided"]);
const reviewViews = new Set<ReviewAppView>(["dashboard", "new", "frames", "detail", "vis", "settings"]);

export function dashboardCommandCenter<T extends ReviewFlowTask>(tasks: T[], currentUser: ReviewFlowUser) {
  const primaryAction = tasks.filter((task) => actionStatuses.has(task.status ?? "") || (task.status === "needs_revision" && isCurrentUserTask(task, currentUser)));
  const liveReview = tasks.filter((task) => liveReviewStatuses.has(task.status ?? ""));
  const revisionRisk = tasks.filter((task) => task.status === "needs_revision" && !isCurrentUserTask(task, currentUser));
  const reference = tasks.filter((task) => referenceStatuses.has(task.status ?? ""));
  const scoredTasks = tasks.filter((task) => typeof task.aiTotalScore === "number");
  const averageScore = Math.round(scoredTasks.reduce((sum, task) => sum + Number(task.aiTotalScore), 0) / Math.max(1, scoredTasks.length));

  return {
    primaryAction,
    liveReview,
    revisionRisk,
    reference,
    metrics: {
      total: tasks.length,
      primaryAction: primaryAction.length,
      liveReview: liveReview.length,
      revisionRisk: revisionRisk.length,
      approved: tasks.filter((task) => task.status === "approved").length,
      exceptions: tasks.filter((task) => task.status === "figma_read_failed" || task.status === "ai_review_failed").length,
      averageScore: Number.isFinite(averageScore) ? averageScore : 0
    }
  };
}

export function reviewTimeline(status: ReviewFlowStatus | string): ReviewTimelineStage[] {
  const activeIndex = timelineActiveIndex(status);
  return timelineKeys.map((key, index) => ({
    key,
    state: timelineStageState(status, activeIndex, index)
  }));
}

export function isCurrentUserTask(task: ReviewFlowTask, currentUser: ReviewFlowUser) {
  const taskUserId = normalize(task.submitterId);
  const taskUserName = normalize(task.submitterName);
  return Boolean(
    (currentUser.currentUserId && taskUserId === normalize(currentUser.currentUserId)) ||
    (currentUser.currentUserName && taskUserName === normalize(currentUser.currentUserName))
  );
}

export function normalizeStoredReviewNavigation(value: unknown): ReviewNavigationState {
  const input = value && typeof value === "object" ? value as Partial<ReviewNavigationState> : {};
  const view = reviewViews.has(input.view as ReviewAppView) ? input.view as ReviewAppView : "dashboard";
  const activeTaskId = typeof input.activeTaskId === "string" && input.activeTaskId.trim() ? input.activeTaskId.trim() : null;
  if ((view === "detail" || view === "frames") && !activeTaskId) return { view: "dashboard", activeTaskId: null };
  return {
    view,
    activeTaskId: view === "detail" || view === "frames" ? activeTaskId : null
  };
}

export function selectReviewRoundData<TResult extends ReviewRoundRecord, TIssue extends ReviewRoundRecord>({
  selectedRound,
  taskSubmissionRound,
  results,
  issues
}: {
  selectedRound: number | "latest";
  taskSubmissionRound?: number;
  results: TResult[];
  issues: TIssue[];
}) {
  const fallbackRound = taskSubmissionRound ?? 1;
  const rounds = Array.from(
    new Set([
      fallbackRound,
      ...results.map((result) => result.submissionRound ?? fallbackRound),
      ...issues.map((issue) => issue.submissionRound ?? fallbackRound)
    ])
  ).filter((round) => Number.isFinite(round)).sort((a, b) => a - b);
  const currentRound = selectedRound === "latest" ? rounds.at(-1) ?? fallbackRound : selectedRound;
  return {
    rounds,
    currentRound,
    result: results.filter((result) => (result.submissionRound ?? fallbackRound) === currentRound).at(-1),
    issues: issues.filter((issue) => (issue.submissionRound ?? fallbackRound) === currentRound)
  };
}

const timelineKeys: ReviewTimelineStageKey[] = ["intake", "ai_review", "ai_decision", "revision", "approved"];

function timelineActiveIndex(status: string) {
  if (["draft", "frame_selection", "figma_reading", "figma_read_failed"].includes(status)) return 0;
  if (["ai_reviewing", "resubmitted"].includes(status)) return 1;
  if (status === "ai_review_failed") return 2;
  if (status === "needs_revision") return 3;
  if (["approved", "archived", "withdrawn", "voided"].includes(status)) return 4;
  return 0;
}

function timelineStageState(status: string, activeIndex: number, index: number): ReviewTimelineStageState {
  if (status === "figma_read_failed" && index === 0) return "blocked";
  if (status === "ai_review_failed" && index === 2) return "blocked";
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "active";
  return "idle";
}

function normalize(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}
