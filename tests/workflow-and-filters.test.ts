import { describe, expect, it } from "vitest";
import { assertRole, assertTransition, canDeleteTaskStatus, canWithdrawTaskStatus, getAiDecisionStatus, getPreviousIssueRound } from "../server/services/workflow";
import { normalizeAiReview, reviewRubric, toReviewIssue } from "../server/services/aiReview";
import { filterIssues, filterTasks } from "../src/shared/filters";

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
});

describe("AI schema validation", () => {
  it("accepts valid AI output with high-confidence annotations", () => {
    const review = normalizeAiReview({
      total_score: 80,
      conclusion: "建议小幅修改",
      dimension_scores: {
        brand_consistency: { score: 24, max_score: 30, comment: "ok" },
        layout_standard: { score: 22, max_score: 30, comment: "ok" },
        ecommerce_expression: { score: 20, max_score: 25, comment: "ok" },
        delivery_standard: { score: 14, max_score: 15, comment: "ok" }
      },
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
          brand_consistency: { score: 24, max_score: 30, comment: "ok" },
          layout_standard: { score: 24, max_score: 30, comment: "ok" },
          ecommerce_expression: { score: 21, max_score: 25, comment: "ok" }
        },
        issues: []
      })
    ).toThrow(/缺少 delivery_standard/);

    expect(() =>
      normalizeAiReview({
        total_score: 90,
        dimension_scores: {
          brand_consistency: { score: 24, max_score: 30, comment: "ok" },
          layout_standard: { score: 24, max_score: 30, comment: "ok" },
          ecommerce_expression: { score: 21, max_score: 25, comment: "ok" },
          delivery_standard: { score: 14, max_score: 15, comment: "ok" }
        },
        issues: []
      })
    ).toThrow(/total_score 必须等于四维得分之和 83/);
  });

  it("exposes rubric definitions and maps serious must-fix issues to revision", () => {
    expect(reviewRubric.passScore).toBe(85);
    expect(reviewRubric.dimensions.map((dimension) => [dimension.key, dimension.maxScore])).toEqual([
      ["brand_consistency", 30],
      ["layout_standard", 30],
      ["ecommerce_expression", 25],
      ["delivery_standard", 15]
    ]);

    const review = normalizeAiReview({
      total_score: 86,
      dimension_scores: {
        brand_consistency: { score: 26, max_score: 30, comment: "ok" },
        layout_standard: { score: 25, max_score: 30, comment: "ok" },
        ecommerce_expression: { score: 22, max_score: 25, comment: "ok" },
        delivery_standard: { score: 13, max_score: 15, comment: "ok" }
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
});

describe("front-end filters", () => {
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
