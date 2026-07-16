type TaskLike = {
  title?: string;
  contentType?: string;
  status?: string;
  submitterName?: string;
  submitterId?: string;
  figmaFileName?: string;
};

type IssueLike = {
  frameName?: string;
  type?: string;
  severity?: string;
  mustFix?: boolean;
  resolutionStatus?: string;
};

export type TaskFilters = {
  contentType?: string;
  status?: string;
  submitterId?: string;
  keyword?: string;
  onlyMine?: boolean;
  currentUserId?: string;
  currentUserName?: string;
};

export type DashboardLaneKey = "action_required" | "reviewing" | "needs_revision" | "approved" | "closed";

export type DashboardLane<T extends TaskLike> = {
  key: DashboardLaneKey;
  tasks: T[];
};

export type IssueFilters = {
  frameName?: string;
  type?: string;
  severity?: string;
  mustFixOnly?: boolean;
  resolutionStatus?: string;
};

export function defaultTaskFilters(role: string): TaskFilters {
  return { contentType: "", status: "", submitterId: "", keyword: "", onlyMine: role === "设计师" };
}

export function filterTasks<T extends TaskLike>(tasks: T[], filters: TaskFilters) {
  const keyword = normalize(filters.keyword);
  const submitterId = normalize(filters.submitterId);
  const currentUserId = normalize(filters.currentUserId);
  const currentUserName = normalize(filters.currentUserName);

  return tasks.filter((task) => {
    if (filters.contentType && task.contentType !== filters.contentType) return false;
    if (filters.status === "failed") {
      if (task.status !== "figma_read_failed" && task.status !== "ai_review_failed") return false;
    } else if (filters.status === "action_required") {
      const taskUserId = normalize(task.submitterId);
      const taskUserName = normalize(task.submitterName);
      const isMine = taskUserId === currentUserId || taskUserName === currentUserName;
      if (!["draft", "frame_selection", "figma_read_failed", "ai_review_failed"].includes(task.status ?? "") && !(task.status === "needs_revision" && isMine)) return false;
    } else if (filters.status === "reviewing") {
      if (!["figma_reading", "ai_reviewing", "resubmitted"].includes(task.status ?? "")) return false;
    } else if (filters.status === "closed") {
      if (!["archived", "withdrawn", "voided", "figma_read_failed", "ai_review_failed"].includes(task.status ?? "")) return false;
    } else if (filters.status && task.status !== filters.status) return false;
    if (submitterId && !normalize(task.submitterId).includes(submitterId)) return false;
    if (filters.onlyMine) {
      const taskUserId = normalize(task.submitterId);
      const taskUserName = normalize(task.submitterName);
      if (taskUserId !== currentUserId && taskUserName !== currentUserName) return false;
    }
    if (keyword) {
      const haystack = [task.title, task.figmaFileName, task.submitterName, task.submitterId, task.contentType].map(normalize).join(" ");
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

export function filterIssues<T extends IssueLike>(issues: T[], filters: IssueFilters) {
  return issues.filter((issue) => {
    if (filters.frameName && issue.frameName !== filters.frameName) return false;
    if (filters.type && issue.type !== filters.type) return false;
    if (filters.severity && issue.severity !== filters.severity) return false;
    if (filters.resolutionStatus && issue.resolutionStatus !== filters.resolutionStatus) return false;
    if (filters.mustFixOnly && !issue.mustFix) return false;
    return true;
  });
}

export function dashboardLanes<T extends TaskLike>(tasks: T[], currentUser: Pick<TaskFilters, "currentUserId" | "currentUserName">): DashboardLane<T>[] {
  const isCurrentUserTask = (task: T) => {
    const taskUserId = normalize(task.submitterId);
    const taskUserName = normalize(task.submitterName);
    return Boolean(
      (currentUser.currentUserId && taskUserId === normalize(currentUser.currentUserId)) ||
      (currentUser.currentUserName && taskUserName === normalize(currentUser.currentUserName))
    );
  };
  const actionStatuses = new Set(["draft", "frame_selection", "figma_read_failed", "ai_review_failed"]);
  const actionRequired = tasks.filter((task) => actionStatuses.has(task.status ?? "") || (task.status === "needs_revision" && isCurrentUserTask(task)));

  return [
    { key: "action_required", tasks: actionRequired },
    { key: "reviewing", tasks: tasks.filter((task) => ["figma_reading", "ai_reviewing", "resubmitted"].includes(task.status ?? "")) },
    { key: "needs_revision", tasks: tasks.filter((task) => task.status === "needs_revision" && !isCurrentUserTask(task)) },
    { key: "approved", tasks: tasks.filter((task) => task.status === "approved") },
    { key: "closed", tasks: tasks.filter((task) => ["archived", "withdrawn", "voided"].includes(task.status ?? "")) }
  ];
}

function normalize(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}
