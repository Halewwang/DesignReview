export type Role = "设计师" | "运营" | "设计总监" | "管理员";
export type ContentType = "电商页面" | "Amazon A+ 页面" | "官网 Banner";
export type ReviewStatus =
  | "draft"
  | "figma_reading"
  | "frame_selection"
  | "ai_reviewing"
  | "operation_review"
  | "director_review"
  | "needs_revision"
  | "resubmitted"
  | "approved"
  | "archived"
  | "withdrawn"
  | "voided"
  | "figma_read_failed"
  | "ai_review_failed";

export type ReviewTask = {
  id: string;
  title: string;
  contentType: ContentType;
  description: string;
  figmaUrl?: string;
  figmaFileKey?: string;
  figmaFileName?: string;
  source?: "figma" | "upload";
  status: ReviewStatus;
  priority: "普通" | "加急";
  submitterName: string;
  submitterId?: string;
  submitterRole: "设计师";
  aiTotalScore?: number;
  finalDecision?: "通过" | "退回";
  finalReason?: string;
  createdAt: string;
  updatedAt: string;
  submissionRound: number;
};

export type ReviewFrame = {
  id: string;
  taskId: string;
  figmaNodeId: string;
  pageName: string;
  frameName: string;
  width: number;
  height: number;
  thumbnailUrl?: string;
  exportedImageUrl?: string;
  selected: boolean;
  sortOrder: number;
};

export type DimensionKey =
  | "brand_consistency"
  | "layout_standard"
  | "ecommerce_expression"
  | "delivery_standard"
  | "design_system_discipline";

export type LocalizedText = {
  zh?: string;
  en?: string;
};

export type ReviewIssueI18n = {
  title?: LocalizedText;
  locationDescription?: LocalizedText;
  description?: LocalizedText;
  suggestion?: LocalizedText;
  relatedStandardSection?: LocalizedText;
};

export type ReviewIssue = {
  id: string;
  taskId: string;
  frameId?: string;
  reviewResultId: string;
  submissionRound: number;
  title: string;
  type: "品牌一致性" | "排版规范" | "电商表达" | "交付规范" | "设计系统纪律";
  severity: "严重" | "中等" | "轻微" | "建议";
  frameName?: string;
  locationDescription?: string;
  description: string;
  suggestion: string;
  relatedStandardSource: string;
  relatedStandardSection: string;
  i18n?: ReviewIssueI18n;
  mustFix: boolean;
  resolutionStatus: "待解决" | "疑似已解决" | "仍未解决" | "新增问题" | "无法判断";
  annotationSuggestion?: Annotation;
  createdAt: string;
};

export type Annotation = {
  id?: string;
  issueId?: string;
  frameId?: string;
  type: "point" | "rect";
  xPercent: number;
  yPercent: number;
  widthPercent?: number;
  heightPercent?: number;
  comment?: string;
  confidence?: number;
  source?: "ai" | "manual" | "migrated" | "mock";
};

export type ReviewResult = {
  id: string;
  taskId: string;
  submissionRound: number;
  totalScore: number;
  conclusion: string;
  dimensionScores: Record<DimensionKey, { score: number; max_score: number; comment: string; comment_i18n?: LocalizedText; deduction_items?: string[]; deduction_items_i18n?: Array<LocalizedText | string> }>;
  rawAiResponse: unknown;
  createdAt: string;
};

export type OperationReview = {
  id: string;
  taskId: string;
  submissionRound: number;
  reviewerName: string;
  comment: string;
  focus: string;
  createdAt: string;
};

export type DirectorDecision = {
  id: string;
  taskId: string;
  submissionRound: number;
  reviewerName: string;
  decision: "通过" | "退回";
  reason: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  taskId?: string;
  actorName: string;
  actorRole: Role;
  action: string;
  createdAt: string;
};

export type ReviewSession = {
  id: string;
  tokenHash: string;
  role: "设计师" | "管理员";
  name: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type ReviewJobStage = "queued" | "preparing" | "exporting" | "analyzing" | "reporting" | "succeeded" | "failed" | "cancelled";

export type ReviewJob = {
  id: string;
  taskId: string;
  submissionRound: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: ReviewJobStage;
  attempt: number;
  actorName: string;
  actorRole: Role;
  actorId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseExpiresAt?: string;
  error?: string;
};
