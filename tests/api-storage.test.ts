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

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "emke-api-storage-"));
  process.env.REVIEWS_DB_PATH = path.join(tempDir, "reviews.json");
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
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
});

describe("storage adapter", () => {
  it("persists mutations through the active storage adapter", async () => {
    await mutateDb((db) => {
      Object.assign(db, createEmptyDb());
      db.logs.push({ id: "log_1", actorName: "Hale", actorRole: "管理员", action: "storage smoke", createdAt: "2026-05-05T00:00:00.000Z" });
    });

    const db = await readDb();

    expect(db.logs.map((log) => log.id)).toEqual(["log_1"]);
  });
});
