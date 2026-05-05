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

export type IssueFilters = {
  frameName?: string;
  type?: string;
  severity?: string;
  mustFixOnly?: boolean;
  resolutionStatus?: string;
};

export function filterTasks<T extends TaskLike>(tasks: T[], filters: TaskFilters) {
  const keyword = normalize(filters.keyword);
  const submitterId = normalize(filters.submitterId);
  const currentUserId = normalize(filters.currentUserId);
  const currentUserName = normalize(filters.currentUserName);

  return tasks.filter((task) => {
    if (filters.contentType && task.contentType !== filters.contentType) return false;
    if (filters.status === "failed") {
      if (task.status !== "figma_read_failed" && task.status !== "ai_review_failed") return false;
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

function normalize(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}
