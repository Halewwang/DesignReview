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
  | "delivery_standard";

export type ReviewIssue = {
  id: string;
  taskId: string;
  frameId?: string;
  reviewResultId: string;
  submissionRound: number;
  title: string;
  type: "品牌一致性" | "排版规范" | "电商表达" | "交付规范";
  severity: "严重" | "中等" | "轻微" | "建议";
  frameName?: string;
  locationDescription?: string;
  description: string;
  suggestion: string;
  relatedStandardSource: string;
  relatedStandardSection: string;
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
  dimensionScores: Record<DimensionKey, { score: number; max_score: number; comment: string; deduction_items?: string[] }>;
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
