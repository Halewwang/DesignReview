import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, drainAiReviewJobsForTest } from "../server/index";
import { createEmptyDb, getStorageMode, isDurableStorage, mutateDb, readDb } from "../server/db";

const designerHeaders = {
  "x-access-code": "emke.de",
  "x-actor-name": encodeURIComponent("Hale"),
  "x-actor-role": encodeURIComponent("设计师")
};
const adminHeaders = {
  "x-access-code": "emke.de",
  "x-actor-name": encodeURIComponent("Admin"),
  "x-actor-role": encodeURIComponent("管理员")
};

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "emke-api-storage-"));
  process.env.REVIEWS_DB_PATH = path.join(tempDir, "reviews.json");
  process.env.AI_CONFIG_PATH = path.join(tempDir, "ai-config.json");
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.VERCEL;
  delete process.env.AI_PROVIDER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_REVIEW_DISABLE_BACKGROUND;
  delete process.env.AI_REVIEW_BACKGROUND_DELAY_MS;
  delete process.env.REVIEW_ADMIN_ACCESS_CODE;
  delete process.env.REVIEW_ALLOW_LEGACY_HEADER_AUTH;
});

afterEach(async () => {
  await drainAiReviewJobsForTest();
  delete process.env.AI_REVIEW_DISABLE_BACKGROUND;
  delete process.env.AI_REVIEW_BACKGROUND_DELAY_MS;
});

describe("API validation and health", () => {
  it("issues and revokes an opaque server-owned session", async () => {
    process.env.REVIEW_ALLOW_LEGACY_HEADER_AUTH = "0";
    const access = await request(app)
      .post("/api/access")
      .send({ accessCode: "emke.de", role: "设计师", name: "Hale" });

    expect(access.status).toBe(200);
    expect(access.body.session).toMatchObject({
      token: expect.any(String),
      role: "设计师",
      name: "Hale",
      userId: "Hale",
      expiresAt: expect.any(String)
    });
    expect(access.body.session).not.toHaveProperty("accessCode");

    const authorization = { Authorization: `Bearer ${access.body.session.token}` };
    expect((await request(app).get("/api/reviews").set(authorization)).status).toBe(200);
    expect((await request(app).delete("/api/session").set(authorization)).status).toBe(200);
    expect((await request(app).get("/api/reviews").set(authorization)).status).toBe(401);
  });

  it("does not trust actor role headers when legacy test auth is disabled", async () => {
    process.env.REVIEW_ALLOW_LEGACY_HEADER_AUTH = "0";

    const response = await request(app).get("/api/settings").set(adminHeaders);

    expect(response.status).toBe(401);
  });

  it("requires the separate administrator code when it is configured", async () => {
    process.env.REVIEW_ALLOW_LEGACY_HEADER_AUTH = "0";
    process.env.REVIEW_ADMIN_ACCESS_CODE = "admin-secret";

    const rejected = await request(app)
      .post("/api/access")
      .send({ accessCode: "emke.de", role: "管理员", name: "Admin" });
    const accepted = await request(app)
      .post("/api/access")
      .send({ accessCode: "admin-secret", role: "管理员", name: "Admin" });

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(accepted.body.session).toMatchObject({ role: "管理员", name: "Admin" });
  });

  it("reports API health with storage and provider readiness", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      storageMode: getStorageMode(),
      durableStorage: true,
      figmaTokenConfigured: expect.any(Boolean),
      aiKeyConfigured: expect.any(Boolean)
    });
  });

  it("rejects invalid review creation input before mutating storage", async () => {
    const response = await request(app)
      .post("/api/reviews")
      .set(designerHeaders)
      .send({ title: " ", contentType: "官网 Banner", figmaUrl: "not-a-url" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: expect.stringMatching(/任务名称|Figma/) });
  });

  it("rejects selecting more than the configured maximum frame count", async () => {
    const previous = process.env.MAX_FRAMES_PER_TASK;
    process.env.MAX_FRAMES_PER_TASK = "1";
    const taskId = "task_validation";
    await mutateDb((db) => {
      Object.assign(db, createEmptyDb());
      db.tasks.push({
        id: taskId,
        title: "Validation",
        contentType: "官网 Banner",
        description: "",
        figmaUrl: "https://www.figma.com/design/abc/Test",
        figmaFileKey: "abc",
        status: "frame_selection",
        priority: "普通",
        submitterName: "Hale",
        submitterRole: "设计师",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        submissionRound: 1
      });
      db.frames.push(
        { id: "f1", taskId, figmaNodeId: "1:1", pageName: "Page", frameName: "A", width: 100, height: 100, selected: false, sortOrder: 0 },
        { id: "f2", taskId, figmaNodeId: "1:2", pageName: "Page", frameName: "B", width: 100, height: 100, selected: false, sortOrder: 1 }
      );
    });

    const response = await request(app)
      .post(`/api/reviews/${taskId}/select-frames`)
      .set(designerHeaders)
      .send({ frameIds: ["f1", "f2"] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("单次最多审核 1 个 Frame");
    if (previous) process.env.MAX_FRAMES_PER_TASK = previous;
    else delete process.env.MAX_FRAMES_PER_TASK;
  });

  it("creates an upload-based review as a durable in-progress task with selected image frames", async () => {
    process.env.AI_REVIEW_DISABLE_BACKGROUND = "1";

    const response = await request(app)
      .post("/api/reviews/upload-images")
      .set(designerHeaders)
      .send({
        title: "Upload review",
        contentType: "官网 Banner",
        description: "Review uploaded screenshots",
        priority: "普通",
        submitterId: "EMKE-Hale",
        images: [
          {
            fileName: "hero.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,iVBORw0KGgo="
          },
          {
            fileName: "detail.jpg",
            mimeType: "image/jpeg",
            dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
          }
        ]
      });

    expect(response.status).toBe(202);
    expect(response.body.accepted).toBe(true);
    expect(response.body.task).toMatchObject({
      title: "Upload review",
      source: "upload",
      status: "ai_reviewing"
    });
    expect(response.body.task).not.toHaveProperty("figmaUrl");
    expect(response.body.frames).toHaveLength(2);
    expect(response.body.frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          frameName: "hero.png",
          figmaNodeId: "upload_1",
          pageName: "上传图片",
          selected: true,
          exportedImageUrl: "data:image/png;base64,iVBORw0KGgo="
        })
      ])
    );
    expect(response.body).not.toHaveProperty("result");

    const db = await readDb();
    expect(db.tasks[0]).toMatchObject({ id: response.body.task.id, source: "upload" });
    expect(db.frames.filter((frame) => frame.taskId === response.body.task.id)).toHaveLength(2);
    expect(db.results.filter((result) => result.taskId === response.body.task.id)).toHaveLength(0);
    expect(db.jobs.find((job) => job.taskId === response.body.task.id)).toMatchObject({ status: "queued", stage: "queued", submissionRound: 1 });

    const detail = await request(app).get(`/api/reviews/${response.body.task.id}`).set(designerHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.task.status).toBe("ai_reviewing");
    expect(detail.body.frames).toHaveLength(2);
    expect(detail.body.results).toHaveLength(0);
    expect(detail.body.job).toMatchObject({ status: "queued", stage: "queued" });
  });

  it("starts selected Frame AI review as a durable in-progress task before the model finishes", async () => {
    process.env.AI_REVIEW_DISABLE_BACKGROUND = "1";

    await mutateDb((db) => {
      db.tasks.push({
        id: "task_async_frame",
        title: "Async frame review",
        contentType: "官网 Banner",
        description: "",
        source: "upload",
        status: "frame_selection",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
        submissionRound: 1
      });
      db.frames.push({
        id: "frame_async_review",
        taskId: "task_async_frame",
        figmaNodeId: "upload_1",
        pageName: "上传图片",
        frameName: "hero.png",
        width: 0,
        height: 0,
        thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=",
        exportedImageUrl: "data:image/png;base64,iVBORw0KGgo=",
        selected: true,
        sortOrder: 0
      });
    });

    const response = await request(app)
      .post("/api/reviews/task_async_frame/start-ai-review")
      .set(designerHeaders)
      .send({});

    expect(response.status).toBe(202);
    expect(response.body.accepted).toBe(true);
    expect(response.body.task).toMatchObject({ id: "task_async_frame", status: "ai_reviewing" });
    expect(response.body).not.toHaveProperty("result");

    const detail = await request(app).get("/api/reviews/task_async_frame").set(designerHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.task.status).toBe("ai_reviewing");
    expect(detail.body.results).toHaveLength(0);
    expect(detail.body.job).toMatchObject({ taskId: "task_async_frame", status: "queued" });
  });

  it("runs a persisted AI job once and keeps its final stage readable", async () => {
    process.env.AI_REVIEW_DISABLE_BACKGROUND = "1";
    const created = await request(app)
      .post("/api/reviews/upload-images")
      .set(designerHeaders)
      .send({
        title: "Persisted job",
        contentType: "官网 Banner",
        images: [{ fileName: "hero.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }]
      });
    const taskId = created.body.task.id;

    const firstRun = await request(app).post(`/api/reviews/${taskId}/run-ai-review`).set(designerHeaders).send({});
    const secondRun = await request(app).post(`/api/reviews/${taskId}/run-ai-review`).set(designerHeaders).send({});
    const detail = await request(app).get(`/api/reviews/${taskId}`).set(designerHeaders);
    const db = await readDb();

    expect(firstRun.status).toBe(200);
    expect(firstRun.body.job).toMatchObject({ status: "succeeded", stage: "succeeded", attempt: 1 });
    expect(secondRun.status).toBe(202);
    expect(secondRun.body).toMatchObject({ claimed: false, job: { status: "succeeded" } });
    expect(detail.body.job).toMatchObject({ status: "succeeded", stage: "succeeded" });
    expect(db.results.filter((result) => result.taskId === taskId)).toHaveLength(1);
  });

  it("marks stale AI reviews as failed when the queue is read", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_stale",
        title: "Stale review",
        contentType: "官网 Banner",
        description: "",
        source: "upload",
        status: "ai_reviewing",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
        submissionRound: 1
      });
    });

    const response = await request(app).get("/api/reviews").set(designerHeaders);
    const task = response.body.find((item: any) => item.id === "task_stale");
    const db = await readDb();

    expect(response.status).toBe(200);
    expect(task.status).toBe("ai_review_failed");
    expect(db.logs[0]).toMatchObject({ taskId: "task_stale", action: "AI 初审超时，请刷新后重新发起" });
  });

  it("keeps an old AI review resumable when it still has a persisted job", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_resumable",
        title: "Resumable review",
        contentType: "官网 Banner",
        description: "",
        source: "upload",
        status: "ai_reviewing",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
        submissionRound: 1
      });
      db.jobs.push({
        id: "job_resumable",
        taskId: "task_resumable",
        submissionRound: 1,
        status: "queued",
        stage: "queued",
        attempt: 0,
        actorName: "Hale",
        actorRole: "设计师",
        actorId: "Hale",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z"
      });
    });

    const response = await request(app).get("/api/reviews").set(designerHeaders);

    expect(response.body.find((item: any) => item.id === "task_resumable")?.status).toBe("ai_reviewing");
    expect((await readDb()).jobs.find((job) => job.id === "job_resumable")?.status).toBe("queued");
  });

  it("retries failed upload-based AI reviews without requiring Figma data", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_upload_retry",
        title: "Upload retry",
        contentType: "Amazon A+ 页面",
        description: "",
        source: "upload",
        status: "ai_review_failed",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
        submissionRound: 1
      });
      db.frames.push({
        id: "frame_upload_retry",
        taskId: "task_upload_retry",
        figmaNodeId: "upload_1",
        pageName: "上传图片",
        frameName: "upload.png",
        width: 0,
        height: 0,
        thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=",
        exportedImageUrl: "data:image/png;base64,iVBORw0KGgo=",
        selected: true,
        sortOrder: 0
      });
    });

    const response = await request(app)
      .post("/api/reviews/task_upload_retry/start-ai-review")
      .set(designerHeaders)
      .send({});

    expect(response.status).toBe(202);
    expect(response.body.task.status).toBe("ai_reviewing");
    expect(response.body.accepted).toBe(true);

    await drainAiReviewJobsForTest();
    const detail = await request(app).get("/api/reviews/task_upload_retry").set(designerHeaders);
    expect(detail.body.task.status).toEqual(expect.stringMatching(/approved|needs_revision/));
    expect(detail.body.results.at(-1).totalScore).toEqual(expect.any(Number));
  });

  it("rejects upload-based reviews with more than nine images", async () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      fileName: `image-${index + 1}.png`,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo="
    }));

    const response = await request(app)
      .post("/api/reviews/upload-images")
      .set(designerHeaders)
      .send({
        title: "Too many images",
        contentType: "官网 Banner",
        images
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("最多上传 9 张图片");
  });

  it("resubmits upload-based reviews with replacement images and a new AI result", async () => {
    const createResponse = await request(app)
      .post("/api/reviews/upload-images")
      .set(designerHeaders)
      .send({
        title: "Upload resubmit",
        contentType: "官网 Banner",
        images: [
          {
            fileName: "round-1.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,iVBORw0KGgo="
          }
        ]
      });

    const taskId = createResponse.body.task.id;
    expect(createResponse.status).toBe(202);
    expect(createResponse.body.task.status).toBe("ai_reviewing");
    await drainAiReviewJobsForTest();
    const createdDetail = await request(app).get(`/api/reviews/${taskId}`).set(designerHeaders);
    expect(createdDetail.body.task.status).toBe("needs_revision");

    const response = await request(app)
      .post(`/api/reviews/${taskId}/resubmit`)
      .set(designerHeaders)
      .send({
        images: [
          {
            fileName: "round-2.jpg",
            mimeType: "image/jpeg",
            dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
          }
        ]
      });

    expect(response.status).toBe(202);
    expect(response.body.task).toMatchObject({
      id: taskId,
      source: "upload",
      submissionRound: 2,
      status: "ai_reviewing"
    });
    expect(response.body.frames).toHaveLength(1);
    expect(response.body.frames[0]).toMatchObject({
      frameName: "round-2.jpg",
      figmaNodeId: "upload_1",
      selected: true,
      exportedImageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    });
    expect(response.body).not.toHaveProperty("result");

    await drainAiReviewJobsForTest();
    const db = await readDb();
    expect(db.results.filter((result) => result.taskId === taskId).map((result) => result.submissionRound)).toEqual([1, 2]);
    expect(db.frames.filter((frame) => frame.taskId === taskId).map((frame) => frame.frameName)).toEqual(["round-2.jpg"]);
  });

  it("does not advance the round when upload resubmit validation fails", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_atomic_resubmit",
        title: "Atomic resubmit",
        contentType: "官网 Banner",
        description: "",
        source: "upload",
        status: "needs_revision",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
        submissionRound: 1
      });
    });

    const response = await request(app).post("/api/reviews/task_atomic_resubmit/resubmit").set(designerHeaders).send({ images: [] });
    const task = (await readDb()).tasks.find((item) => item.id === "task_atomic_resubmit");

    expect(response.status).toBe(400);
    expect(task).toMatchObject({ status: "needs_revision", submissionRound: 1 });
  });

  it("keeps retired human review endpoints explicit for legacy clients", async () => {
    const operationResponse = await request(app)
      .post("/api/reviews/task_legacy/operation-review")
      .set(designerHeaders)
      .send({});
    const directorResponse = await request(app)
      .post("/api/reviews/task_legacy/director-decision")
      .set(designerHeaders)
      .send({});

    expect(operationResponse.status).toBe(410);
    expect(operationResponse.body.error).toContain("AI 审核直接给出结论");
    expect(directorResponse.status).toBe(410);
    expect(directorResponse.body.error).toContain("AI 审核直接给出结论");
  });

  it("lets admins approve only reviewable failures with a recorded reason", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_admin_approve",
        title: "Admin approve",
        contentType: "Amazon A+ 页面",
        description: "",
        source: "upload",
        status: "needs_revision",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        aiTotalScore: 76,
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
        submissionRound: 1
      });
    });

    const designerResponse = await request(app)
      .post("/api/reviews/task_admin_approve/admin-approve")
      .set(designerHeaders)
      .send({ reason: "人工复核确认可发布" });
    const missingReasonResponse = await request(app)
      .post("/api/reviews/task_admin_approve/admin-approve")
      .set(adminHeaders)
      .send({});
    const adminResponse = await request(app)
      .post("/api/reviews/task_admin_approve/admin-approve")
      .set(adminHeaders)
      .send({ reason: "人工复核确认可发布" });

    expect(designerResponse.status).toBe(403);
    expect(designerResponse.body.error).toContain("无权通过归档");
    expect(missingReasonResponse.status).toBe(400);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toMatchObject({ id: "task_admin_approve", status: "approved", finalReason: "人工复核确认可发布" });

    const db = await readDb();
    expect(db.tasks.find((task) => task.id === "task_admin_approve")?.status).toBe("approved");
    expect(db.logs[0]).toMatchObject({
      taskId: "task_admin_approve",
      actorName: "Admin",
      actorRole: "管理员",
      action: "管理员通过归档：人工复核确认可发布"
    });
  });

  it("soft-deletes owned tasks while preserving their audit history", async () => {
    await mutateDb((db) => {
      db.tasks.push(
        {
          id: "task_own_delete",
          title: "Own task",
          contentType: "官网 Banner",
          description: "",
          source: "upload",
          status: "needs_revision",
          priority: "普通",
          submitterName: "Hale",
          submitterId: "Hale",
          submitterRole: "设计师",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
          submissionRound: 1
        },
        {
          id: "task_other_delete",
          title: "Other task",
          contentType: "官网 Banner",
          description: "",
          source: "upload",
          status: "needs_revision",
          priority: "普通",
          submitterName: "Other",
          submitterId: "Other",
          submitterRole: "设计师",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
          submissionRound: 1
        }
      );
      db.logs.push({ id: "log_own_delete", taskId: "task_own_delete", actorName: "Hale", actorRole: "设计师", action: "历史记录", createdAt: "2026-05-13T00:00:00.000Z" });
    });

    const ownResponse = await request(app).delete("/api/reviews/task_own_delete").set(designerHeaders);
    const otherResponse = await request(app).delete("/api/reviews/task_other_delete").set(designerHeaders);
    const adminResponse = await request(app).delete("/api/reviews/task_other_delete").set(adminHeaders);

    expect(ownResponse.status).toBe(200);
    expect(otherResponse.status).toBe(403);
    expect(otherResponse.body.error).toContain("无权删除他人任务");
    expect(adminResponse.status).toBe(200);
    const db = await readDb();
    expect(db.tasks.find((task) => task.id === "task_own_delete")?.status).toBe("voided");
    expect(db.tasks.find((task) => task.id === "task_other_delete")?.status).toBe("voided");
    expect(db.logs.some((item) => item.id === "log_own_delete")).toBe(true);
  });

  it("blocks designers from editing or withdrawing another owner's task", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_other_mutation",
        title: "Other task",
        contentType: "官网 Banner",
        description: "",
        source: "upload",
        status: "needs_revision",
        priority: "普通",
        submitterName: "Other",
        submitterId: "Other",
        submitterRole: "设计师",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
        submissionRound: 1
      });
    });

    const edit = await request(app).patch("/api/reviews/task_other_mutation").set(designerHeaders).send({ title: "Claimed" });
    const withdraw = await request(app).post("/api/reviews/task_other_mutation/withdraw").set(designerHeaders).send({});

    expect(edit.status).toBe(403);
    expect(withdraw.status).toBe(403);
    expect((await readDb()).tasks.find((task) => task.id === "task_other_mutation")).toMatchObject({ title: "Other task", status: "needs_revision" });
  });

  it("filters generic placeholder annotations from review detail while preserving specific annotations", async () => {
    await mutateDb((db) => {
      db.tasks.push({
        id: "task_annotation_filter",
        title: "Annotation filter",
        contentType: "Amazon A+ 页面",
        description: "",
        source: "upload",
        status: "needs_revision",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-06-16T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
        submissionRound: 1
      });
      db.issues.push(
        {
          id: "issue_generic_annotation",
          taskId: "task_annotation_filter",
          reviewResultId: "result_annotation_filter",
          submissionRound: 1,
          title: "Generic placeholder",
          type: "电商表达",
          severity: "中等",
          frameName: "hero.jpg",
          locationDescription: "主视觉右侧卖点区域",
          description: "Generic placeholder coordinates should not be rendered as precise.",
          suggestion: "Use text location instead.",
          relatedStandardSource: "品牌设计规范.md",
          relatedStandardSection: "Amazon PDP / A+ Content Rules",
          mustFix: true,
          resolutionStatus: "待解决",
          annotationSuggestion: { type: "rect", xPercent: 7, yPercent: 28, widthPercent: 36, heightPercent: 30, confidence: 0.8, source: "ai" },
          createdAt: "2026-06-16T00:00:00.000Z"
        },
        {
          id: "issue_known_om03_annotation",
          taskId: "task_annotation_filter",
          reviewResultId: "result_annotation_filter",
          submissionRound: 1,
          title: "卖点层级与产品证明信息需要加强",
          type: "电商表达",
          severity: "中等",
          frameName: "iwEcAqNqcGcDAQTRM6wF0RStBrABj6hVj31bTgnPcqKdlGkAB9IP2gviCAAJomltCgAL0gBZbx8.jpg",
          locationDescription: "主视觉右侧卖点区域",
          description: "Known OM03 seed issue should use its verified visual target.",
          suggestion: "Use precise text-module coordinates.",
          relatedStandardSource: "品牌设计规范.md",
          relatedStandardSection: "Amazon PDP / A+ Content Rules",
          mustFix: true,
          resolutionStatus: "待解决",
          annotationSuggestion: { type: "rect", xPercent: 7, yPercent: 28, widthPercent: 36, heightPercent: 30, confidence: 0.8, source: "ai" },
          createdAt: "2026-06-16T00:00:00.000Z"
        },
        {
          id: "issue_specific_annotation",
          taskId: "task_annotation_filter",
          reviewResultId: "result_annotation_filter",
          submissionRound: 1,
          title: "Specific annotation",
          type: "电商表达",
          severity: "中等",
          frameName: "hero.jpg",
          locationDescription: "模块标题区域",
          description: "Specific coordinates should remain renderable.",
          suggestion: "Keep this annotation.",
          relatedStandardSource: "品牌设计规范.md",
          relatedStandardSection: "Amazon PDP / A+ Content Rules",
          mustFix: true,
          resolutionStatus: "待解决",
          annotationSuggestion: { type: "rect", xPercent: 12, yPercent: 34, widthPercent: 18, heightPercent: 9, confidence: 0.82, source: "ai" },
          createdAt: "2026-06-16T00:00:00.000Z"
        }
      );
    });

    const response = await request(app).get("/api/reviews/task_annotation_filter").set(designerHeaders);

    expect(response.status).toBe(200);
    expect(response.body.issues.find((issue: any) => issue.id === "issue_generic_annotation")).not.toHaveProperty("annotationSuggestion");
    expect(response.body.issues.find((issue: any) => issue.id === "issue_known_om03_annotation").annotationSuggestion).toMatchObject({
      xPercent: 7.14,
      yPercent: 21.97,
      widthPercent: 42.15,
      heightPercent: 10.85,
      source: "manual"
    });
    expect(response.body.issues.find((issue: any) => issue.id === "issue_specific_annotation").annotationSuggestion).toMatchObject({ xPercent: 12, yPercent: 34, widthPercent: 18, heightPercent: 9 });
  });
});

describe("storage adapter", () => {
  it("uses the generic Postgres adapter when DATABASE_URL is configured", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@example.supabase.co:5432/postgres";

    expect(getStorageMode()).toBe("postgres");
    delete process.env.DATABASE_URL;
  });

  it("persists mutations through the active storage adapter", async () => {
    await mutateDb((db) => {
      Object.assign(db, createEmptyDb());
      db.logs.push({ id: "log_1", actorName: "Hale", actorRole: "管理员", action: "storage smoke", createdAt: "2026-05-05T00:00:00.000Z" });
    });

    const db = await readDb();

    expect(db.logs.map((log) => log.id)).toEqual(["log_1"]);
  });

  it("serializes overlapping mutations so stale background writes cannot resurrect deleted tasks", async () => {
    await mutateDb((db) => {
      Object.assign(db, createEmptyDb());
      db.tasks.push({
        id: "task_race_delete",
        title: "Race delete",
        contentType: "官网 Banner",
        description: "",
        source: "upload",
        status: "ai_reviewing",
        priority: "普通",
        submitterName: "Hale",
        submitterId: "Hale",
        submitterRole: "设计师",
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
        submissionRound: 1
      });
    });

    let releaseSlowWrite!: () => void;
    let slowWriteStarted!: () => void;
    const slowWriteEntered = new Promise<void>((resolve) => {
      slowWriteStarted = resolve;
    });
    const slowWriteCanFinish = new Promise<void>((resolve) => {
      releaseSlowWrite = resolve;
    });
    const slowWrite = mutateDb(async (db) => {
      slowWriteStarted();
      db.logs.push({ id: "log_background", taskId: "task_race_delete", actorName: "System", actorRole: "管理员", action: "background write", createdAt: "2026-06-18T00:00:01.000Z" });
      await slowWriteCanFinish;
    });

    await slowWriteEntered;
    const deleteWrite = mutateDb((db) => {
      db.tasks = db.tasks.filter((task) => task.id !== "task_race_delete");
      db.logs = db.logs.filter((log) => log.taskId !== "task_race_delete");
    });

    await Promise.race([deleteWrite, new Promise((resolve) => setTimeout(resolve, 20))]);
    releaseSlowWrite();
    await Promise.all([slowWrite, deleteWrite]);
    const db = await readDb();

    expect(db.tasks.some((task) => task.id === "task_race_delete")).toBe(false);
    expect(db.logs.some((log) => log.taskId === "task_race_delete")).toBe(false);
  });

  it("rejects Vercel mutations when Postgres is not configured", async () => {
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "emke-vercel-cwd-"));
    const runtimeDir = path.join(os.tmpdir(), "emke-design-review");
    const runtimePath = path.join(runtimeDir, "reviews.json");
    fs.mkdirSync(path.join(tempCwd, "data"), { recursive: true });
    fs.writeFileSync(path.join(tempCwd, "data", "reviews.json"), JSON.stringify(createEmptyDb(), null, 2));
    fs.rmSync(runtimeDir, { recursive: true, force: true });

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempCwd);
    delete process.env.REVIEWS_DB_PATH;
    process.env.VERCEL = "1";

    try {
      expect(isDurableStorage()).toBe(false);
      await expect(mutateDb((db) => {
        db.logs.push({ id: "log_vercel_tmp", actorName: "Hale", actorRole: "管理员", action: "vercel tmp smoke", createdAt: "2026-06-16T00:00:00.000Z" });
      })).rejects.toThrow("持久数据库");
      expect(fs.existsSync(runtimePath)).toBe(false);
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });
});
