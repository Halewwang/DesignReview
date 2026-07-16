import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reviewUiPermissions, runAiReviewJobIfAllowed, submitOperationReviewDraft } from "../src/shared/reviewFlow";

const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const visComponentSource = mainSource.slice(mainSource.indexOf("function VisPage"), mainSource.indexOf("function SettingsPage"));
const settingsComponentSource = mainSource.slice(mainSource.indexOf("function SettingsPage"), mainSource.indexOf("function Metric"));

describe("operations review UI behavior", () => {
  it.each([
    ["运营", { canMutateVis: false, canMutateSettings: false }],
    ["设计师", { canMutateVis: false, canMutateSettings: false }],
    ["管理员", { canMutateVis: true, canMutateSettings: true }]
  ] as const)("defines executable VIS and Settings mutation permissions for %s", (role, expected) => {
    expect(reviewUiPermissions(role)).toEqual(expected);
  });

  it("connects App rendering and navigation updates to the role-aware navigation policy", () => {
    expect(mainSource).toContain("const resolvedNavigation = normalizeStoredReviewNavigation(navigation, session?.role);");
    expect(mainSource).toContain("const { view, activeTaskId } = resolvedNavigation;");
    expect(mainSource).toMatch(/setNavigation\(\(current\) => normalizeStoredReviewNavigation\([\s\S]*?session\?\.role\)\);/);
  });

  it("keeps VIS mutation controls inside the administrator-only branch and renders full read-only source otherwise", () => {
    expect(visComponentSource).toContain("const permissions = reviewUiPermissions(session.role);");
    expect(visComponentSource).toMatch(/permissions\.canMutateVis && \([\s\S]*?Upload standard source[\s\S]*?\)/);
    expect(visComponentSource).toMatch(/permissions\.canMutateVis \? \([\s\S]*?<textarea[\s\S]*?\) : \([\s\S]*?vis-readonly[\s\S]*?data\?\.content/);
  });

  it("resolves Settings to an immediate read-only explanation for non-administrators", () => {
    expect(settingsComponentSource).toContain("const permissions = reviewUiPermissions(session.role);");
    expect(settingsComponentSource).toMatch(/if \(!permissions\.canMutateSettings\) {[\s\S]*?Only admins can edit system settings[\s\S]*?return \([\s\S]*?ai-config-form/);
  });

  it("does not run an active AI review job when operations opens the task", async () => {
    const requests: string[] = [];

    const started = await runAiReviewJobIfAllowed({
      role: "运营",
      aiReviewing: true,
      job: { status: "queued" },
      run: async () => { requests.push("/run-ai-review"); }
    });

    expect(started).toBe(false);
    expect(requests).toEqual([]);
  });

  it.each(["设计师", "管理员"] as const)("preserves automatic AI job execution for %s", async (role) => {
    const requests: string[] = [];

    const started = await runAiReviewJobIfAllowed({
      role,
      aiReviewing: true,
      job: { status: "queued" },
      run: async () => { requests.push("/run-ai-review"); }
    });

    expect(started).toBe(true);
    expect(requests).toEqual(["/run-ai-review"]);
  });

  it("posts trimmed operations review fields, clears the draft, and reloads after success", async () => {
    const payloads: Array<{ focus: string; comment: string }> = [];
    let draft = { focus: "  Conversion  ", comment: "  Strengthen the CTA  " };
    let error = "stale error";
    let busy = false;
    let reloads = 0;

    await submitOperationReviewDraft({
      draft,
      post: async (payload) => { payloads.push(payload); },
      reload: () => { reloads += 1; },
      onDraftChange: (nextDraft) => { draft = nextDraft; },
      onError: (message) => { error = message; },
      onBusyChange: (nextBusy) => { busy = nextBusy; },
      messages: { emptyComment: "请输入运营补充评价", failed: "运营补充评价提交失败" }
    });

    expect(payloads).toEqual([{ focus: "Conversion", comment: "Strengthen the CTA" }]);
    expect(draft).toEqual({ focus: "", comment: "" });
    expect(error).toBe("");
    expect(busy).toBe(false);
    expect(reloads).toBe(1);
  });

  it("surfaces the empty-comment error without posting, clearing, or reloading", async () => {
    const originalDraft = { focus: "Conversion", comment: "   " };
    let draft = originalDraft;
    let error = "";
    let posts = 0;
    let reloads = 0;

    await submitOperationReviewDraft({
      draft,
      post: async () => { posts += 1; },
      reload: () => { reloads += 1; },
      onDraftChange: (nextDraft) => { draft = nextDraft; },
      onError: (message) => { error = message; },
      onBusyChange: () => undefined,
      messages: { emptyComment: "请输入运营补充评价", failed: "运营补充评价提交失败" }
    });

    expect(error).toBe("请输入运营补充评价");
    expect(draft).toBe(originalDraft);
    expect(posts).toBe(0);
    expect(reloads).toBe(0);
  });

  it("preserves the draft and surfaces a request failure without reloading", async () => {
    const originalDraft = { focus: "Conversion", comment: "Strengthen the CTA" };
    let draft = originalDraft;
    let error = "";
    let busy = false;
    let reloads = 0;

    await submitOperationReviewDraft({
      draft,
      post: async () => { throw new Error("Request denied"); },
      reload: () => { reloads += 1; },
      onDraftChange: (nextDraft) => { draft = nextDraft; },
      onError: (message) => { error = message; },
      onBusyChange: (nextBusy) => { busy = nextBusy; },
      messages: { emptyComment: "请输入运营补充评价", failed: "运营补充评价提交失败" }
    });

    expect(error).toBe("Request denied");
    expect(draft).toBe(originalDraft);
    expect(busy).toBe(false);
    expect(reloads).toBe(0);
  });

  it("uses the localized failure copy when a request rejects without an Error", async () => {
    let error = "";

    await submitOperationReviewDraft({
      draft: { focus: "", comment: "Context" },
      post: async () => { throw "network unavailable"; },
      reload: () => undefined,
      onDraftChange: () => undefined,
      onError: (message) => { error = message; },
      onBusyChange: () => undefined,
      messages: { emptyComment: "请输入运营补充评价", failed: "运营补充评价提交失败" }
    });

    expect(error).toBe("运营补充评价提交失败");
  });
});
