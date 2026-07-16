import { describe, expect, it } from "vitest";
import { assertCanDeleteTask, assertRole, assertTaskPermission, assertTaskViewPermission, assertTransition, canDeleteTaskStatus, canViewTask, canWithdrawTaskStatus, getAiDecisionStatus, getPreviousIssueRound, normalizeAiOnlyStatus } from "../server/services/workflow";
import { aiImageDetail, normalizeAiReview, reviewRubric, runAiReview, toReviewIssue } from "../server/services/aiReview";
import { dashboardLanes, defaultTaskFilters, filterIssues, filterTasks } from "../src/shared/filters";
import { dashboardCommandCenter, normalizeStoredReviewNavigation, reviewTimeline, selectReviewRoundData } from "../src/shared/reviewFlow";
import { validateImageFiles } from "../src/shared/uploads";

const baseTask = {
  id: "task_1",
  title: "Homepage banner",
  contentType: "官网 Banner",
  figmaFileName: "EMKE Website",
  submitterName: "Hale",
  submitterId: "EMKE-Hale",
  status: "needs_revision",
  aiTotalScore: 76
};

const validFiveDimensionScores = {
  brand_consistency: { score: 22, max_score: 25, comment: "ok" },
  layout_standard: { score: 21, max_score: 25, comment: "ok" },
  ecommerce_expression: { score: 20, max_score: 25, comment: "ok" },
  delivery_standard: { score: 14, max_score: 15, comment: "ok" },
  design_system_discipline: { score: 9, max_score: 10, comment: "ok" }
};

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("workflow guards", () => {
  it("allows valid status transitions and rejects skipped steps", () => {
    expect(() => assertTransition("needs_revision", ["needs_revision"], "重新提交")).not.toThrow();
    expect(() => assertTransition("draft", ["needs_revision"], "重新提交")).toThrow("当前状态不允许重新提交");
  });

  it("keeps designer-owned flow with admin override", () => {
    expect(() => assertRole("管理员", ["设计师"], "开始 AI 初审")).not.toThrow();
    expect(() => assertRole("运营", ["设计师"], "开始 AI 初审")).toThrow("当前身份无权开始 AI 初审");
  });

  it("decides final status directly from AI score and veto issues", () => {
    expect(getAiDecisionStatus(92, [])).toBe("approved");
    expect(getAiDecisionStatus(84, [])).toBe("needs_revision");
    expect(getAiDecisionStatus(96, [{ title: "Logo 变形" }])).toBe("needs_revision");
  });

  it("uses only the latest previous round for issue comparison", () => {
    expect(getPreviousIssueRound(3, [1, 2, 2])).toBe(2);
    expect(getPreviousIssueRound(1, [1])).toBeUndefined();
  });

  it("allows submitted tasks to be withdrawn or deleted outside active AI review", () => {
    expect(canWithdrawTaskStatus("frame_selection")).toBe(true);
    expect(canWithdrawTaskStatus("needs_revision")).toBe(true);
    expect(canWithdrawTaskStatus("ai_reviewing")).toBe(false);
    expect(canWithdrawTaskStatus("draft")).toBe(false);

    expect(canDeleteTaskStatus("draft")).toBe(true);
    expect(canDeleteTaskStatus("frame_selection")).toBe(true);
    expect(canDeleteTaskStatus("needs_revision")).toBe(true);
    expect(canDeleteTaskStatus("ai_reviewing")).toBe(true);
  });

  it("maps legacy human-review statuses into the AI-only result model", () => {
    expect(normalizeAiOnlyStatus("operation_review", 90)).toBe("approved");
    expect(normalizeAiOnlyStatus("director_review", 76)).toBe("needs_revision");
    expect(normalizeAiOnlyStatus("approved", 72)).toBe("needs_revision");
  });

  it("allows designers to delete their own tasks and admins to delete any task", () => {
    expect(() => assertCanDeleteTask("设计师", { submitterId: "EMKE-Hale", submitterName: "Hale" }, "EMKE-Hale")).not.toThrow();
    expect(() => assertCanDeleteTask("设计师", { submitterId: "Other", submitterName: "Other" }, "EMKE-Hale")).toThrow("当前身份无权删除他人任务");
    expect(() => assertCanDeleteTask("管理员", { submitterId: "Other", submitterName: "Other" }, "Admin")).not.toThrow();
  });

  it("uses the same ownership rule for every task mutation", () => {
    const task = { submitterId: "EMKE-Hale", submitterName: "Hale" };
    expect(() => assertTaskPermission("设计师", task, "EMKE-Hale", "编辑")).not.toThrow();
    expect(() => assertTaskPermission("设计师", task, "Other", "编辑")).toThrow("当前身份无权编辑他人任务");
    expect(() => assertTaskPermission("管理员", task, "Admin", "编辑")).not.toThrow();
  });

  it("limits designers to their own tasks while privileged readers see all", () => {
    const task = { submitterId: "EMKE-Hale", submitterName: "Hale" };

    expect(canViewTask("设计师", task, "EMKE-Hale")).toBe(true);
    expect(canViewTask("设计师", task, "Other")).toBe(false);
    expect(canViewTask("运营", task, "Ops")).toBe(true);
    expect(canViewTask("管理员", task, "Admin")).toBe(true);
    expect(() => assertTaskViewPermission("设计师", task, "Other")).toThrow("当前身份无权查看他人任务");
  });
});

describe("AI schema validation", () => {
  it("defaults vision image detail to high for precise annotations", () => {
    const previous = process.env.AI_IMAGE_DETAIL;
    delete process.env.AI_IMAGE_DETAIL;
    try {
      expect(aiImageDetail()).toBe("high");
      process.env.AI_IMAGE_DETAIL = "low";
      expect(aiImageDetail()).toBe("low");
    } finally {
      restoreEnv("AI_IMAGE_DETAIL", previous);
    }
  });

  it("does not emit canvas annotation from local fallback without vision coordinates", async () => {
    const previousEnv = {
      aiConfigPath: process.env.AI_CONFIG_PATH,
      aiProviderApiKey: process.env.AI_PROVIDER_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      databaseUrl: process.env.DATABASE_URL,
      postgresUrl: process.env.POSTGRES_URL,
      postgresPrismaUrl: process.env.POSTGRES_PRISMA_URL
    };
    process.env.AI_CONFIG_PATH = `/tmp/emke-missing-ai-config-${Date.now()}.json`;
    delete process.env.AI_PROVIDER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_PRISMA_URL;

    try {
      const review = await runAiReview({
        task: {
          id: "task_fallback_annotation",
          title: "Fallback annotation",
          contentType: "Amazon A+ 页面",
          description: "",
          source: "upload",
          status: "ai_reviewing",
          priority: "普通",
          submitterName: "Hale",
          submitterRole: "设计师",
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:00:00.000Z",
          submissionRound: 1
        },
        frames: [
          {
            id: "frame_fallback_annotation",
            taskId: "task_fallback_annotation",
            figmaNodeId: "upload_1",
            pageName: "上传图片",
            frameName: "hero.jpg",
            width: 1471,
            height: 3595,
            selected: true,
            sortOrder: 0,
            exportedImageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
          }
        ],
        sections: [],
        previousIssues: []
      });

      expect(review.issues[0].annotation_suggestion).toBeUndefined();
    } finally {
      restoreEnv("AI_CONFIG_PATH", previousEnv.aiConfigPath);
      restoreEnv("AI_PROVIDER_API_KEY", previousEnv.aiProviderApiKey);
      restoreEnv("OPENAI_API_KEY", previousEnv.openaiApiKey);
      restoreEnv("DATABASE_URL", previousEnv.databaseUrl);
      restoreEnv("POSTGRES_URL", previousEnv.postgresUrl);
      restoreEnv("POSTGRES_PRISMA_URL", previousEnv.postgresPrismaUrl);
    }
  });

  it("accepts valid AI output with high-confidence annotations", () => {
    const review = normalizeAiReview({
      total_score: 86,
      conclusion: "建议小幅修改",
      dimension_scores: validFiveDimensionScores,
      issues: [
        {
          title: "CTA 不够明确",
          type: "电商表达",
          severity: "中等",
          description: "CTA 与普通文字区分不足",
          suggestion: "增强 CTA 层级",
          must_fix: true,
          annotation_suggestion: { type: "rect", x_percent: 10, y_percent: 20, width_percent: 30, height_percent: 12, confidence: 0.8 }
        }
      ]
    });

    expect(review.issues[0].annotation_suggestion.confidence).toBe(0.8);
  });

  it("normalizes alternate AI issue title fields instead of falling back to unnamed issues", () => {
    const issue = toReviewIssue(
      {
        issue_title: "Hero copy readability issue",
        type: "品牌一致性",
        severity: "严重",
        issue_description: "Hero copy has low contrast",
        revision_suggestion: "Increase contrast"
      },
      "task_1",
      "result_1"
    );

    expect(issue.title).toBe("Hero copy readability issue");
    expect(issue.description).toBe("Hero copy has low contrast");
    expect(issue.suggestion).toBe("Increase contrast");
  });

  it("preserves bilingual AI result fields for language-specific rendering", () => {
    const review = normalizeAiReview({
      total_score: 86,
      conclusion: "建议小幅修改",
      dimension_scores: {
        brand_consistency: {
          score: 22,
          max_score: 25,
          comment: "中文点评",
          comment_i18n: { zh: "中文点评", en: "English comment" },
          deduction_items: ["中文扣分"],
          deduction_items_i18n: [{ zh: "中文扣分", en: "English deduction" }]
        },
        layout_standard: validFiveDimensionScores.layout_standard,
        ecommerce_expression: validFiveDimensionScores.ecommerce_expression,
        delivery_standard: validFiveDimensionScores.delivery_standard,
        design_system_discipline: validFiveDimensionScores.design_system_discipline
      },
      issues: [
        {
          title: "中文标题",
          title_i18n: { zh: "中文标题", en: "English title" },
          description: "中文描述",
          description_i18n: { zh: "中文描述", en: "English description" },
          type: "品牌一致性",
          severity: "中等"
        }
      ]
    });
    const issue = toReviewIssue(review.issues[0], "task_1", "result_1");

    expect(review.dimension_scores.brand_consistency.comment_i18n.en).toBe("English comment");
    expect(review.dimension_scores.brand_consistency.deduction_items_i18n[0].en).toBe("English deduction");
    expect(issue.i18n?.title?.en).toBe("English title");
    expect(issue.i18n?.description?.zh).toBe("中文描述");
  });

  it("derives an issue title from description when AI omits all title fields", () => {
    const issue = toReviewIssue(
      {
        type: "品牌一致性",
        severity: "中等",
        description: "右侧上方右卡副copy存在德语语法错误。需要修正。"
      },
      "task_1",
      "result_1"
    );

    expect(issue.title).toBe("右侧上方右卡副copy存在德语语法错误");
  });

  it("normalizes annotation aliases and center-origin coordinates", () => {
    const issue = toReviewIssue(
      {
        type: "品牌一致性",
        severity: "中等",
        description: "Hero copy has low contrast",
        annotation_suggestion: { type: "rect", cx: 0.5, cy: 0.4, width: 0.2, height: 0.1, coordinate_origin: "center", confidence: 0.9 }
      },
      "task_1",
      "result_1"
    );

    expect(issue.annotationSuggestion?.xPercent).toBe(40);
    expect(issue.annotationSuggestion?.yPercent).toBe(35);
    expect(issue.annotationSuggestion?.widthPercent).toBe(20);
    expect(issue.annotationSuggestion?.heightPercent).toBe(10);
  });

  it("rejects invalid AI score and annotation coordinates", () => {
    expect(() =>
      normalizeAiReview({
        total_score: 130,
        dimension_scores: {
          brand_consistency: { score: 40, max_score: 30, comment: "bad" }
        },
        issues: [
          {
            title: "bad",
            type: "未知",
            severity: "中等",
            annotation_suggestion: { type: "rect", x_percent: 130, y_percent: 20, width_percent: 10, height_percent: 10, confidence: 0.9 }
          }
        ]
      })
    ).toThrow(/AI 输出结构不合规/);
  });

  it("rejects missing dimensions and totals that do not equal the dimension sum", () => {
    expect(() =>
      normalizeAiReview({
        total_score: 88,
        dimension_scores: {
          brand_consistency: { score: 22, max_score: 25, comment: "ok" },
          layout_standard: { score: 21, max_score: 25, comment: "ok" },
          ecommerce_expression: { score: 20, max_score: 25, comment: "ok" },
          delivery_standard: { score: 14, max_score: 15, comment: "ok" }
        },
        issues: []
      })
    ).toThrow(/缺少 design_system_discipline/);

    expect(() =>
      normalizeAiReview({
        total_score: 90,
        dimension_scores: {
          brand_consistency: { score: 22, max_score: 25, comment: "ok" },
          layout_standard: { score: 21, max_score: 25, comment: "ok" },
          ecommerce_expression: { score: 20, max_score: 25, comment: "ok" },
          delivery_standard: { score: 14, max_score: 15, comment: "ok" },
          design_system_discipline: { score: 8, max_score: 10, comment: "ok" }
        },
        issues: []
      })
    ).toThrow(/total_score 必须等于五维得分之和 85/);
  });

  it("exposes rubric definitions and maps serious must-fix issues to revision", () => {
    expect(reviewRubric.passScore).toBe(85);
    expect(reviewRubric.dimensions.map((dimension) => [dimension.key, dimension.maxScore])).toEqual([
      ["brand_consistency", 25],
      ["layout_standard", 25],
      ["ecommerce_expression", 25],
      ["delivery_standard", 15],
      ["design_system_discipline", 10]
    ]);
    expect(reviewRubric.dimensions.find((dimension) => dimension.key === "design_system_discipline")?.definition).toMatch(/VIS/);

    const review = normalizeAiReview({
      total_score: 86,
      dimension_scores: {
        brand_consistency: { score: 22, max_score: 25, comment: "ok" },
        layout_standard: { score: 21, max_score: 25, comment: "ok" },
        ecommerce_expression: { score: 20, max_score: 25, comment: "ok" },
        delivery_standard: { score: 14, max_score: 15, comment: "ok" },
        design_system_discipline: { score: 9, max_score: 10, comment: "ok" }
      },
      veto_issues: [{ title: "Logo 变形", reason: "品牌资产被拉伸" }],
      issues: [
        {
          title: "Logo 变形",
          type: "品牌一致性",
          severity: "严重",
          description: "Logo 被拉伸",
          suggestion: "使用正确比例",
          must_fix: true,
          related_standard_section: "Logo"
        }
      ]
    });

    expect(getAiDecisionStatus(review.total_score, review.veto_issues)).toBe("needs_revision");
  });

  it("accepts design-system discipline issues as a first-class VIS-based review type", () => {
    const review = normalizeAiReview({
      total_score: 86,
      dimension_scores: validFiveDimensionScores,
      issues: [
        {
          title: "跨 Frame 模块节奏不一致",
          type: "设计系统纪律",
          severity: "中等",
          description: "相同内容模块在多个 Frame 中网格、留白和标题层级不一致。",
          suggestion: "按 VIS 中的模块节奏和字体层级统一。",
          must_fix: true
        }
      ]
    });

    expect(review.issues[0].type).toBe("设计系统纪律");
  });
});

describe("front-end filters", () => {
  it("defaults designers to their own tasks while admins see the whole queue", () => {
    expect(defaultTaskFilters("设计师")).toMatchObject({ onlyMine: true });
    expect(defaultTaskFilters("管理员")).toMatchObject({ onlyMine: false });
  });

  it("filters dashboard tasks by status, content type, submitter id, keyword, and mine", () => {
    const tasks = [
      baseTask,
      { ...baseTask, id: "task_2", title: "Amazon A+", contentType: "Amazon A+ 页面", submitterId: "Other", status: "approved" }
    ] as any[];

    const result = filterTasks(tasks, {
      contentType: "官网 Banner",
      status: "needs_revision",
      submitterId: "hale",
      keyword: "website",
      onlyMine: true,
      currentUserId: "EMKE-Hale",
      currentUserName: "Hale"
    });

    expect(result.map((task) => task.id)).toEqual(["task_1"]);
  });

  it("groups dashboard lanes by the user's next action in the AI-only workflow", () => {
    const tasks = [
      { ...baseTask, id: "task_frame", status: "frame_selection", submitterId: "EMKE-Hale" },
      { ...baseTask, id: "task_failed", status: "ai_review_failed", submitterId: "Other", submitterName: "Other" },
      { ...baseTask, id: "task_mine_revision", status: "needs_revision", submitterId: "EMKE-Hale" },
      { ...baseTask, id: "task_other_revision", status: "needs_revision", submitterId: "Other", submitterName: "Other" },
      { ...baseTask, id: "task_reviewing", status: "ai_reviewing", submitterId: "Other", submitterName: "Other" },
      { ...baseTask, id: "task_approved", status: "approved", submitterId: "Other", submitterName: "Other" },
      { ...baseTask, id: "task_archived", status: "archived", submitterId: "Other", submitterName: "Other" },
      { ...baseTask, id: "task_withdrawn", status: "withdrawn", submitterId: "Other", submitterName: "Other" },
      { ...baseTask, id: "task_voided", status: "voided", submitterId: "Other", submitterName: "Other" }
    ] as any[];

    const lanes = dashboardLanes(tasks, { currentUserId: "EMKE-Hale", currentUserName: "Hale" });

    expect(lanes.find((lane) => lane.key === "action_required")?.tasks.map((task) => task.id)).toEqual(["task_frame", "task_failed", "task_mine_revision"]);
    expect(lanes.find((lane) => lane.key === "needs_revision")?.tasks.map((task) => task.id)).toEqual(["task_other_revision"]);
    expect(lanes.find((lane) => lane.key === "reviewing")?.tasks.map((task) => task.id)).toEqual(["task_reviewing"]);
    expect(lanes.find((lane) => lane.key === "approved")?.tasks.map((task) => task.id)).toEqual(["task_approved"]);
    expect(lanes.find((lane) => lane.key === "closed")?.tasks.map((task) => task.id)).toEqual(["task_archived", "task_withdrawn", "task_voided"]);
  });

  it("prioritizes the dashboard command center around next actions and live review state", () => {
    const tasks = [
      { ...baseTask, id: "task_frame", status: "frame_selection", submitterId: "EMKE-Hale", aiTotalScore: undefined },
      { ...baseTask, id: "task_failed", status: "ai_review_failed", submitterId: "Other", submitterName: "Other", aiTotalScore: undefined },
      { ...baseTask, id: "task_mine_revision", status: "needs_revision", submitterId: "EMKE-Hale", aiTotalScore: 76 },
      { ...baseTask, id: "task_other_revision", status: "needs_revision", submitterId: "Other", submitterName: "Other", aiTotalScore: 68 },
      { ...baseTask, id: "task_reviewing", status: "ai_reviewing", submitterId: "Other", submitterName: "Other", aiTotalScore: undefined },
      { ...baseTask, id: "task_approved", status: "approved", submitterId: "Other", submitterName: "Other", aiTotalScore: 94 },
      { ...baseTask, id: "task_archived", status: "archived", submitterId: "Other", submitterName: "Other", aiTotalScore: 88 }
    ] as any[];

    const commandCenter = dashboardCommandCenter(tasks, { currentUserId: "EMKE-Hale", currentUserName: "Hale" });

    expect(commandCenter.primaryAction.map((task) => task.id)).toEqual(["task_frame", "task_failed", "task_mine_revision"]);
    expect(commandCenter.liveReview.map((task) => task.id)).toEqual(["task_reviewing"]);
    expect(commandCenter.revisionRisk.map((task) => task.id)).toEqual(["task_other_revision"]);
    expect(commandCenter.reference.map((task) => task.id)).toEqual(["task_approved", "task_archived"]);
    expect(commandCenter.metrics).toMatchObject({
      total: 7,
      primaryAction: 3,
      liveReview: 1,
      revisionRisk: 1,
      approved: 1,
      exceptions: 1,
      averageScore: 82
    });
  });

  it("builds a review timeline that highlights the active workflow state", () => {
    expect(reviewTimeline("frame_selection").map((stage) => [stage.key, stage.state])).toEqual([
      ["intake", "active"],
      ["ai_review", "idle"],
      ["ai_decision", "idle"],
      ["revision", "idle"],
      ["approved", "idle"]
    ]);

    expect(reviewTimeline("ai_reviewing").map((stage) => [stage.key, stage.state])).toEqual([
      ["intake", "complete"],
      ["ai_review", "active"],
      ["ai_decision", "idle"],
      ["revision", "idle"],
      ["approved", "idle"]
    ]);

    expect(reviewTimeline("needs_revision").map((stage) => [stage.key, stage.state])).toEqual([
      ["intake", "complete"],
      ["ai_review", "complete"],
      ["ai_decision", "complete"],
      ["revision", "active"],
      ["approved", "idle"]
    ]);
  });

  it("restores task detail or Frame selection navigation only when an active task id exists", () => {
    expect(normalizeStoredReviewNavigation({ view: "detail", activeTaskId: "task_123" })).toEqual({
      view: "detail",
      activeTaskId: "task_123"
    });
    expect(normalizeStoredReviewNavigation({ view: "frames", activeTaskId: "task_123" })).toEqual({
      view: "frames",
      activeTaskId: "task_123"
    });
    expect(normalizeStoredReviewNavigation({ view: "detail" })).toEqual({
      view: "dashboard",
      activeTaskId: null
    });
    expect(normalizeStoredReviewNavigation({ view: "settings", activeTaskId: "task_123" })).toEqual({
      view: "settings",
      activeTaskId: null
    });
  });

  it("does not fall back to an older review result when the current submission round is still reviewing", () => {
    const selected = selectReviewRoundData({
      selectedRound: "latest",
      taskSubmissionRound: 2,
      results: [{ id: "result_round_1", submissionRound: 1, totalScore: 76 }],
      issues: [{ id: "issue_round_1", submissionRound: 1, title: "Old issue" }]
    });

    expect(selected.currentRound).toBe(2);
    expect(selected.result).toBeUndefined();
    expect(selected.issues).toEqual([]);
  });

  it("validates upload batches with the same helper for create and resubmit flows", () => {
    expect(() => validateImageFiles([{ name: "hero.png", type: "image/png", size: 1024 }], { currentCount: 1, maxCount: 1 })).toThrow("单个项目最多上传 1 张图片");
    expect(() => validateImageFiles([{ name: "hero.gif", type: "image/gif", size: 1024 }], { currentCount: 0, maxCount: 9 })).toThrow("仅支持 PNG、JPG、WebP 图片");
    expect(() => validateImageFiles([{ name: "hero.png", type: "image/png", size: 21 * 1024 * 1024 }], { currentCount: 0, maxCount: 9 })).toThrow("单张图片不能超过 20MB");
  });

  it("filters issues by frame, type, severity, must-fix, and resolution status", () => {
    const issues = [
      { id: "i1", frameName: "Hero", type: "电商表达", severity: "中等", mustFix: true, resolutionStatus: "待解决" },
      { id: "i2", frameName: "Footer", type: "排版规范", severity: "轻微", mustFix: false, resolutionStatus: "新增问题" }
    ] as any[];

    const result = filterIssues(issues, {
      frameName: "Hero",
      type: "电商表达",
      severity: "中等",
      mustFixOnly: true,
      resolutionStatus: "待解决"
    });

    expect(result.map((issue) => issue.id)).toEqual(["i1"]);
  });
});
