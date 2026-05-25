import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "../server/index";
import { createEmptyDb, getStorageMode, mutateDb, readDb } from "../server/db";

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
  delete process.env.AI_PROVIDER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("API validation and health", () => {
  it("reports API health with storage and provider readiness", async () => {
    const response = await request(app).get("/api/health").set(designerHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      storageMode: getStorageMode(),
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

  it("creates an upload-based review with selected image frames and AI result", async () => {
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

    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({
      title: "Upload review",
      source: "upload",
      status: expect.stringMatching(/approved|needs_revision/)
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
    expect(response.body.result.totalScore).toEqual(expect.any(Number));

    const db = await readDb();
    expect(db.tasks[0]).toMatchObject({ id: response.body.task.id, source: "upload" });
    expect(db.frames.filter((frame) => frame.taskId === response.body.task.id)).toHaveLength(2);
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

    expect(response.status).toBe(200);
    expect(response.body.task.status).toEqual(expect.stringMatching(/approved|needs_revision/));
    expect(response.body.result.totalScore).toEqual(expect.any(Number));
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
    expect(createResponse.body.task.status).toBe("needs_revision");

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

    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({
      id: taskId,
      source: "upload",
      submissionRound: 2,
      status: expect.stringMatching(/approved|needs_revision/)
    });
    expect(response.body.frames).toHaveLength(1);
    expect(response.body.frames[0]).toMatchObject({
      frameName: "round-2.jpg",
      figmaNodeId: "upload_1",
      selected: true,
      exportedImageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    });
    expect(response.body.result.submissionRound).toBe(2);

    const db = await readDb();
    expect(db.results.filter((result) => result.taskId === taskId).map((result) => result.submissionRound)).toEqual([1, 2]);
    expect(db.frames.filter((frame) => frame.taskId === taskId).map((frame) => frame.frameName)).toEqual(["round-2.jpg"]);
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

  it("allows designers to delete their own tasks but blocks deleting another submitter's task", async () => {
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
    });

    const ownResponse = await request(app).delete("/api/reviews/task_own_delete").set(designerHeaders);
    const otherResponse = await request(app).delete("/api/reviews/task_other_delete").set(designerHeaders);
    const adminResponse = await request(app).delete("/api/reviews/task_other_delete").set(adminHeaders);

    expect(ownResponse.status).toBe(200);
    expect(otherResponse.status).toBe(403);
    expect(otherResponse.body.error).toContain("无权删除他人任务");
    expect(adminResponse.status).toBe(200);
  });
});

describe("storage adapter", () => {
  it("uses the generic Postgres adapter when DATABASE_URL is configured", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@example.supabase.co:5432/postgres";

    expect(getStorageMode()).toBe("postgres");
  });

  it("persists mutations through the active storage adapter", async () => {
    await mutateDb((db) => {
      Object.assign(db, createEmptyDb());
      db.logs.push({ id: "log_1", actorName: "Hale", actorRole: "管理员", action: "storage smoke", createdAt: "2026-05-05T00:00:00.000Z" });
    });

    const db = await readDb();

    expect(db.logs.map((log) => log.id)).toEqual(["log_1"]);
  });
});
