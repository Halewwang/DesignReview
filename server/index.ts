import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import { getStorageMode, isDurableStorage, mutateDb, now, readDb, uid, type Database } from "./db.js";
import { getFrameImages, parseFigmaUrl, readFileStructure } from "./services/figma.js";
import { loadBrandStandardAsync, parseMarkdownSections, saveUploadedBrandStandardAsync } from "./services/vis.js";
import { getAiProviderConfig, getAiProviderConfigAsync, getDefaultAiModel, getDefaultAiModelAsync, runAiReview, saveAiProviderConfigAsync, toReviewIssue } from "./services/aiReview.js";
import { ContentType, ReviewFrame, ReviewIssue, ReviewJob, ReviewTask, Role } from "./types.js";
import { decodeHeaderValue } from "../src/shared/headerEncoding.js";
import { assertCanDeleteTask, assertRole, assertTaskPermission, assertTransition, canDeleteTaskStatus, canWithdrawTaskStatus, getAiDecisionStatus, getPreviousIssueRound, normalizeAiOnlyStatus } from "./services/workflow.js";

dotenv.config();

export const app = express();
const port = Number(process.env.API_PORT ?? 8787);
const accessCode = process.env.REVIEW_ACCESS_CODE ?? "emke.de";
type RequestActor = { actorName: string; actorRole: Role; actorId?: string };
const requestActors = new WeakMap<express.Request, RequestActor>();

app.use(cors());
app.use(express.json({ limit: process.env.API_JSON_LIMIT ?? "240mb" }));

function actor(req: express.Request): RequestActor {
  const sessionActor = requestActors.get(req);
  if (sessionActor) return sessionActor;
  const actorName = decodeHeaderValue(req.header("x-actor-name"), "未命名");
  return {
    actorName,
    actorRole: decodeHeaderValue(req.header("x-actor-role"), "设计师") as Role,
    actorId: decodeHeaderValue(req.header("x-actor-id"), actorName)
  };
}

function assertTaskActorPermission(req: express.Request, task: Pick<ReviewTask, "submitterId" | "submitterName">, action: string) {
  const requestActor = actor(req);
  assertTaskPermission(requestActor.actorRole, task, requestActor.actorId ?? requestActor.actorName, action);
}

function bearerToken(req: express.Request) {
  const authorization = req.header("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function legacyHeaderAuthAllowed() {
  if (process.env.REVIEW_ALLOW_LEGACY_HEADER_AUTH === "1") return true;
  return process.env.NODE_ENV === "test" && process.env.REVIEW_ALLOW_LEGACY_HEADER_AUTH !== "0";
}

function expectedAccessCode(role: Role) {
  if (role !== "管理员") return accessCode;
  const adminAccessCode = process.env.REVIEW_ADMIN_ACCESS_CODE?.trim();
  if (adminAccessCode) return adminAccessCode;
  return process.env.VERCEL === "1" ? undefined : accessCode;
}

async function requireAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === "/api/access" || req.path === "/api/health") return next();
  const token = bearerToken(req);
  if (token) {
    const db = await readDb();
    const session = db.sessions.find((item) => item.tokenHash === hashSessionToken(token) && Date.parse(item.expiresAt) > Date.now());
    if (session) {
      requestActors.set(req, { actorName: session.name, actorRole: session.role, actorId: session.userId });
      return next();
    }
  }
  if (legacyHeaderAuthAllowed() && req.header("x-access-code") === accessCode) return next();
  return res.status(401).json({ error: "会话已失效，请重新登录" });
}

async function log(taskId: string | undefined, req: express.Request, action: string) {
  await mutateDb((db) => {
    db.logs.unshift({ id: uid("log"), taskId, ...actor(req), action, createdAt: now() });
  });
}

app.use(requireAccess);

app.post("/api/access", async (req, res) => {
  const role = req.body?.role as Role;
  const name = String(req.body?.name ?? "").trim();
  const expectedCode = expectedAccessCode(role);
  if (!(["设计师", "管理员"] as Role[]).includes(role) || !name || !expectedCode || req.body?.accessCode !== expectedCode) {
    const error = role === "管理员"
      ? expectedCode ? "管理员访问口令错误" : "管理员访问口令未配置"
      : "访问口令错误";
    return res.status(401).json({ error });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const userId = name;
  try {
    await mutateDb((db) => {
      db.sessions = db.sessions.filter((item) => Date.parse(item.expiresAt) > Date.now());
      db.sessions.push({
        id: uid("session"),
        tokenHash: hashSessionToken(token),
        role: role as "设计师" | "管理员",
        name,
        userId,
        createdAt,
        expiresAt
      });
    });
    res.json({ session: { token, role, name, userId, expiresAt } });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.delete("/api/session", async (req, res) => {
  const token = bearerToken(req);
  if (token) {
    const tokenHash = hashSessionToken(token);
    await mutateDb((db) => {
      db.sessions = db.sessions.filter((item) => item.tokenHash !== tokenHash);
    });
  }
  res.json({ ok: true });
});

app.get("/api/health", async (_req, res) => {
  const aiProvider = await getAiProviderConfigAsync();
  res.json({
    ok: true,
    storageMode: getStorageMode(),
    durableStorage: isDurableStorage(),
    sessionReady: isDurableStorage() && (process.env.VERCEL !== "1" || Boolean(process.env.REVIEW_ADMIN_ACCESS_CODE?.trim())),
    figmaTokenConfigured: Boolean(process.env.FIGMA_TOKEN),
    aiKeyConfigured: aiProvider.configured,
    aiModel: aiProvider.model,
    maxFramesPerTask: Number(process.env.MAX_FRAMES_PER_TASK ?? 12),
    maxUploadImagesPerTask: maxUploadImagesPerTask()
  });
});

app.get("/api/settings", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["管理员"], "查看系统设置");
  } catch (error) {
    return res.status(403).json({ error: errorMessage(error) });
  }
  const aiProvider = await getAiProviderConfigAsync();
  res.json({
    aiProvider: withoutSecret(aiProvider),
    figmaTokenConfigured: Boolean(process.env.FIGMA_TOKEN),
    aiKeyConfigured: aiProvider.configured,
    aiModel: await getDefaultAiModelAsync(),
    maxFramesPerTask: Number(process.env.MAX_FRAMES_PER_TASK ?? 12),
    maxUploadImagesPerTask: maxUploadImagesPerTask(),
    brandStandardPath: (await loadBrandStandardAsync()).path,
    storageMode: getStorageMode()
  });
});

app.post("/api/settings/ai-config", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["管理员"], "更新 AI 配置");
    const saved = await saveAiProviderConfigAsync({
      providerName: req.body.providerName,
      apiKey: req.body.apiKey,
      baseURL: req.body.baseURL,
      model: req.body.model
    });
    res.json({ aiProvider: withoutSecret(saved) });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/figma/parse-url", (req, res) => {
  try {
    res.json(parseFigmaUrl(req.body.figmaUrl));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

app.get("/api/vis/current", async (_req, res) => {
  try {
    const standard = await loadBrandStandardAsync();
    const sections = parseMarkdownSections(standard.content);
    res.json({ ...standard, sections, content: standard.content });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/vis/current", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["管理员"], "上传 VIS 标准源");
    const saved = await saveUploadedBrandStandardAsync(String(req.body.content ?? ""), req.body.fileName);
    const sections = parseMarkdownSections(saved.content);
    res.json({ ...saved, sections, content: saved.content });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.get("/api/reviews", async (_req, res) => {
  const db = await reconcileStaleAiReviews();
  const tasks = db.tasks.map((task) => ({
    ...normalizeAiOnlyTask(task),
    frameCount: db.frames.filter((frame) => frame.taskId === task.id).length,
    issueCount: db.issues.filter((issue) => issue.taskId === task.id).length
  }));
  res.json(tasks);
});

app.get("/api/reviews/:id", async (req, res) => {
  const db = await reconcileStaleAiReviews();
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  const taskIssues = db.issues.filter((issue) => issue.taskId === task.id).map((issue) => {
    const issueWithRound = { ...issue, submissionRound: issue.submissionRound ?? task.submissionRound ?? 1 };
    if (issue.relatedStandardSection === "Design Principles" && issue.locationDescription?.includes("主视觉右侧卖点区域")) {
      return normalizeAnnotationForResponse({
        ...issueWithRound,
        locationDescription: "左侧促销文案与核心卖点区域",
        annotationSuggestion: {
          type: "rect" as const,
          xPercent: 7,
          yPercent: 28,
          widthPercent: 36,
          heightPercent: 30,
          confidence: 0.8,
          source: "migrated" as const
        }
      });
    }
    return normalizeAnnotationForResponse(issueWithRound);
  });
  const rounds = Array.from(new Set([task.submissionRound, ...db.results.filter((result) => result.taskId === task.id).map((result) => result.submissionRound)])).filter(Boolean).sort((a, b) => a - b);
  res.json({
    task: normalizeAiOnlyTask(task),
    frames: db.frames.filter((frame) => frame.taskId === task.id).sort((a, b) => a.sortOrder - b.sortOrder),
    results: db.results.filter((result) => result.taskId === task.id),
    issues: taskIssues,
    operationReviews: db.operationReviews.filter((review) => review.taskId === task.id).map((review) => ({ ...review, submissionRound: review.submissionRound ?? task.submissionRound ?? 1 })),
    directorDecisions: db.directorDecisions.filter((decision) => decision.taskId === task.id).map((decision) => ({ ...decision, submissionRound: decision.submissionRound ?? task.submissionRound ?? 1 })),
    rounds,
    logs: db.logs.filter((item) => item.taskId === task.id),
    job: latestReviewJob(db.jobs.filter((job) => job.taskId === task.id && job.submissionRound === task.submissionRound))
  });
});

app.post("/api/reviews", async (req, res) => {
  const requestActor = actor(req);
  const { actorName } = requestActor;
  try {
    assertRole(actor(req).actorRole, ["设计师"], "创建审核任务");
    validateCreateTaskInput(req.body);
  } catch (error) {
    return res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
  const task = await mutateDb((db) => {
    const created: ReviewTask = {
      id: uid("task"),
      title: req.body.title,
      contentType: req.body.contentType as ContentType,
      description: req.body.description ?? "",
      figmaUrl: req.body.figmaUrl,
      source: "figma",
      status: "draft",
      priority: req.body.priority ?? "普通",
      submitterName: actorName,
      submitterId: requestActor.actorId ?? actorName,
      submitterRole: "设计师",
      createdAt: now(),
      updatedAt: now(),
      submissionRound: 1
    };
    db.tasks.unshift(created);
    db.logs.unshift({ id: uid("log"), taskId: created.id, ...requestActor, action: "创建审核任务", createdAt: now() });
    return created;
  });
  res.json(task);
});

app.post("/api/reviews/upload-images", async (req, res) => {
  const requestActor = actor(req);
  try {
    assertRole(requestActor.actorRole, ["设计师"], "创建图片审核任务");
    validateCreateUploadTaskInput(req.body);
    const images = normalizeUploadedImages(req.body.images);
    const created = await mutateDb((db) => {
      const task: ReviewTask = {
        id: uid("task"),
        title: req.body.title.trim(),
        contentType: req.body.contentType as ContentType,
        description: req.body.description ?? "",
        source: "upload",
        status: "ai_reviewing",
        priority: req.body.priority ?? "普通",
        submitterName: requestActor.actorName,
        submitterId: requestActor.actorId ?? requestActor.actorName,
        submitterRole: "设计师",
        createdAt: now(),
        updatedAt: now(),
        submissionRound: 1
      };
      const frames: ReviewFrame[] = images.map((image, index) => ({
        id: `${task.id}_upload_${index + 1}`,
        taskId: task.id,
        figmaNodeId: `upload_${index + 1}`,
        pageName: "上传图片",
        frameName: image.fileName,
        width: 0,
        height: 0,
        thumbnailUrl: image.dataUrl,
        exportedImageUrl: image.dataUrl,
        selected: true,
        sortOrder: index
      }));
      db.tasks.unshift(task);
      db.frames.push(...frames);
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...requestActor, action: `上传 ${frames.length} 张图片并创建审核任务`, createdAt: now() });
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...requestActor, action: "开始 AI 初审", createdAt: now() });
      enqueueAiReviewJob(db, task, requestActor);
      return { task, frames };
    });
    res.status(202).json({ accepted: true, task: created.task, frames: created.frames });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.patch("/api/reviews/:id", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["设计师"], "编辑任务信息");
    const saved = await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      assertTaskActorPermission(req, task, "编辑");
      if (typeof req.body.title === "string" && req.body.title.trim()) task.title = req.body.title.trim();
      task.updatedAt = now();
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: "更新任务名称", createdAt: now() });
      return task;
    });
    res.json(saved);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/withdraw", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["设计师"], "撤回任务");
    const saved = await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      assertTaskActorPermission(req, task, "撤回");
      if (!canWithdrawTaskStatus(normalizeAiOnlyStatus(task.status, task.aiTotalScore))) throw new Error("当前状态不允许撤回任务");
      task.status = "withdrawn";
      task.updatedAt = now();
      cancelActiveReviewJobs(db, task.id);
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: "撤回审核任务", createdAt: now() });
      return task;
    });
    res.json(saved);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.delete("/api/reviews/:id", async (req, res) => {
  try {
    const currentActor = actor(req);
    assertRole(currentActor.actorRole, ["设计师"], "删除任务");
    await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      if (!canDeleteTaskStatus(normalizeAiOnlyStatus(task.status, task.aiTotalScore))) throw new Error("当前状态不允许删除任务");
      assertCanDeleteTask(currentActor.actorRole, task, currentActor.actorId ?? currentActor.actorName);
      task.status = "voided";
      task.updatedAt = now();
      cancelActiveReviewJobs(db, task.id);
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...currentActor, action: "作废审核任务", createdAt: now() });
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/read-figma", async (req, res) => {
  let startedReading = false;
  try {
    assertRole(actor(req).actorRole, ["设计师"], "读取 Figma");
    const existing = await getTask(req.params.id);
    assertTaskActorPermission(req, existing, "读取");
    assertTransition(existing.status, ["draft", "figma_read_failed"], "读取 Figma");
    const task = await setTaskStatus(req.params.id, "figma_reading");
    startedReading = true;
    if (!task.figmaUrl) throw new Error("任务没有 Figma 项目链接");
    const parsed = parseFigmaUrl(task.figmaUrl);
    const structure = await readFileStructure(parsed.fileKey, task.id);
    const updated = await mutateDb((db) => {
      const current = db.tasks.find((item) => item.id === task.id)!;
      current.status = "frame_selection";
      current.figmaFileKey = parsed.fileKey;
      current.figmaFileName = structure.fileName;
      current.updatedAt = now();
      db.frames = db.frames.filter((frame) => frame.taskId !== task.id);
      db.frames.push(...structure.frames);
      return current;
    });
    await log(task.id, req, "读取 Figma 文件结构");
    res.json({ task: updated, frames: structure.frames });
  } catch (error) {
    if (startedReading) await setTaskStatus(req.params.id, "figma_read_failed");
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/select-frames", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["设计师"], "选择 Frame");
    const task = await getTask(req.params.id);
    assertTaskActorPermission(req, task, "选择");
    assertTransition(task.status, ["frame_selection"], "选择 Frame");
    const selectedIds: string[] = req.body.frameIds ?? [];
    const maxFrames = Number(process.env.MAX_FRAMES_PER_TASK ?? 12);
    if (selectedIds.length > maxFrames) throw new Error(`单次最多审核 ${maxFrames} 个 Frame`);
    const frames = await mutateDb((db) => {
      db.frames.forEach((frame) => {
        if (frame.taskId === req.params.id) frame.selected = selectedIds.includes(frame.id);
      });
      const current = db.tasks.find((item) => item.id === req.params.id);
      if (current) current.updatedAt = now();
      return db.frames.filter((frame) => frame.taskId === req.params.id);
    });
    await log(req.params.id, req, `选择 ${selectedIds.length} 个 Frame`);
    res.json(frames);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/start-ai-review", async (req, res) => {
  let startedAiReview = false;
  const requestActor = actor(req);
  try {
    assertRole(requestActor.actorRole, ["设计师"], "开始 AI 初审");
    const maxFrames = Number(process.env.MAX_FRAMES_PER_TASK ?? 12);
    const db = await readDb();
    const task = db.tasks.find((item) => item.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    assertTaskActorPermission(req, task, "审核");
    assertTransition(task.status, ["frame_selection", "ai_review_failed"], "开始 AI 初审");
    const selectedFrames = db.frames.filter((frame) => frame.taskId === task.id && frame.selected);
    if (selectedFrames.length === 0) return res.status(400).json({ error: "请先选择需要审核的 Frame" });
    if (selectedFrames.length > maxFrames) return res.status(400).json({ error: `单次最多审核 ${maxFrames} 个 Frame` });
    if (task.source === "upload") {
      if (selectedFrames.some((frame) => !frame.exportedImageUrl && !frame.thumbnailUrl)) {
        throw new Error("上传图片数据缺失，请重新上传图片");
      }
    } else {
      if (!task.figmaFileKey) return res.status(400).json({ error: "任务尚未读取 Figma 文件" });
    }

    const current = await mutateDb((currentDb) => {
      const currentTask = currentDb.tasks.find((item) => item.id === task.id);
      if (!currentTask) throw new Error("任务不存在");
      currentTask.status = "ai_reviewing";
      currentTask.updatedAt = now();
      currentDb.logs.unshift({ id: uid("log"), taskId: currentTask.id, ...requestActor, action: "开始 AI 初审", createdAt: now() });
      enqueueAiReviewJob(currentDb, currentTask, requestActor);
      return currentTask;
    });
    startedAiReview = true;
    res.status(202).json({ accepted: true, task: current, frames: selectedFrames });
  } catch (error) {
    if (startedAiReview) await setTaskStatus(req.params.id, "ai_review_failed", `AI 初审失败：${errorMessage(error)}`, requestActor);
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/operation-review", (req, res) => {
  res.status(410).json({ error: "运营复审流程已取消，任务现在由 AI 审核直接给出结论" });
});

app.post("/api/reviews/:id/director-decision", (req, res) => {
  res.status(410).json({ error: "设计总监终审流程已取消，任务现在由 AI 审核直接给出结论" });
});

app.post("/api/reviews/:id/admin-approve", async (req, res) => {
  const currentActor = actor(req);
  try {
    assertRole(currentActor.actorRole, [], "通过归档任务");
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) throw new Error("请输入管理员通过原因");
    const saved = await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      assertTransition(normalizeAiOnlyStatus(task.status, task.aiTotalScore), ["needs_revision", "ai_review_failed"], "管理员通过归档");
      task.status = "approved";
      task.finalDecision = "通过";
      task.finalReason = reason;
      task.updatedAt = now();
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...currentActor, action: `管理员通过归档：${reason}`, createdAt: now() });
      return task;
    });
    res.json(saved);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/resubmit", async (req, res) => {
  const requestActor = actor(req);
  try {
    assertRole(requestActor.actorRole, ["设计师"], "重新提交");
    const existing = await getTask(req.params.id);
    assertTaskActorPermission(req, existing, "重新提交");
    assertTransition(normalizeAiOnlyStatus(existing.status), ["needs_revision"], "重新提交");
    if (existing.source === "upload") {
      const images = normalizeUploadedImages(req.body.images);
      const created = await mutateDb((db) => {
        const current = db.tasks.find((item) => item.id === existing.id);
        if (!current) throw new Error("任务不存在");
        assertTransition(normalizeAiOnlyStatus(current.status), ["needs_revision"], "重新提交");
        current.submissionRound += 1;
        current.status = "ai_reviewing";
        current.updatedAt = now();
        db.frames = db.frames.filter((frame) => frame.taskId !== current.id);
        const frames: ReviewFrame[] = images.map((image, index) => ({
          id: `${current.id}_upload_${current.submissionRound}_${index + 1}`,
          taskId: current.id,
          figmaNodeId: `upload_${index + 1}`,
          pageName: "上传图片",
          frameName: image.fileName,
          width: 0,
          height: 0,
          thumbnailUrl: image.dataUrl,
          exportedImageUrl: image.dataUrl,
          selected: true,
          sortOrder: index
        }));
        db.frames.push(...frames);
        db.logs.unshift({ id: uid("log"), taskId: current.id, ...requestActor, action: "重新提交", createdAt: now() });
        db.logs.unshift({ id: uid("log"), taskId: current.id, ...requestActor, action: `上传 ${frames.length} 张图片并重新提交`, createdAt: now() });
        db.logs.unshift({ id: uid("log"), taskId: current.id, ...requestActor, action: "开始 AI 初审", createdAt: now() });
        enqueueAiReviewJob(db, current, requestActor);
        return { task: current, frames };
      });
      return res.status(202).json({ accepted: true, task: created.task, frames: created.frames });
    }
    const figmaUrl = typeof req.body.figmaUrl === "string" && req.body.figmaUrl.trim() ? req.body.figmaUrl.trim() : existing.figmaUrl;
    if (!figmaUrl) throw new Error("任务没有 Figma 项目链接");
    const parsed = parseFigmaUrl(figmaUrl);
    const structure = await readFileStructure(parsed.fileKey, existing.id);
    const updated = await mutateDb((db) => {
      const current = db.tasks.find((item) => item.id === existing.id);
      if (!current) throw new Error("任务不存在");
      assertTransition(normalizeAiOnlyStatus(current.status), ["needs_revision"], "重新提交");
      current.submissionRound += 1;
      current.status = "frame_selection";
      current.figmaUrl = figmaUrl;
      current.figmaFileKey = parsed.fileKey;
      current.figmaFileName = structure.fileName;
      current.updatedAt = now();
      db.frames = db.frames.filter((frame) => frame.taskId !== current.id);
      db.frames.push(...structure.frames);
      db.logs.unshift({ id: uid("log"), taskId: current.id, ...requestActor, action: "重新提交", createdAt: now() });
      return current;
    });
    res.json({ task: updated, frames: structure.frames });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/run-ai-review", async (req, res) => {
  const requestActor = actor(req);
  try {
    const task = await getTask(req.params.id);
    assertTaskActorPermission(req, task, "审核");
    const claim = await claimAiReviewJob(task.id);
    if (!claim.claimed) return res.status(202).json(claim);
    const job = await runAiReviewJob(claim.job.id);
    res.json({ claimed: true, job });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

function enqueueAiReviewJob(db: Database, task: ReviewTask, requestActor: RequestActor) {
  const createdAt = now();
  db.jobs.forEach((job) => {
    if (job.taskId === task.id && job.submissionRound === task.submissionRound && (job.status === "queued" || job.status === "running")) {
      job.status = "cancelled";
      job.stage = "cancelled";
      job.updatedAt = createdAt;
      job.finishedAt = createdAt;
    }
  });
  const job: ReviewJob = {
    id: uid("job"),
    taskId: task.id,
    submissionRound: task.submissionRound,
    status: "queued",
    stage: "queued",
    attempt: 0,
    actorName: requestActor.actorName,
    actorRole: requestActor.actorRole,
    actorId: requestActor.actorId,
    createdAt,
    updatedAt: createdAt
  };
  db.jobs.push(job);
  return job;
}

async function claimAiReviewJob(taskId: string) {
  return mutateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const job = latestReviewJob(db.jobs.filter((item) => item.taskId === taskId && item.submissionRound === task.submissionRound));
    if (!job) throw new Error("AI 审核作业不存在，请重新发起审核");
    const leaseExpired = job.status === "running" && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now());
    if (job.status !== "queued" && !leaseExpired) return { claimed: false, job: { ...job } };
    const startedAt = now();
    job.status = "running";
    job.stage = "preparing";
    job.attempt += 1;
    job.startedAt = startedAt;
    job.updatedAt = startedAt;
    job.leaseExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    delete job.error;
    return { claimed: true, job: { ...job } };
  });
}

export async function drainAiReviewJobsForTest() {
  while (true) {
    const db = await readDb();
    const job = db.jobs.find((item) => item.status === "queued" || (item.status === "running" && (!item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= Date.now())));
    if (!job) return;
    const claim = await claimAiReviewJob(job.taskId);
    if (claim.claimed) await runAiReviewJob(claim.job.id);
  }
}

async function runAiReviewJob(jobId: string) {
  const initialDb = await readDb();
  const job = initialDb.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error("AI 审核作业不存在");
  const requestActor: RequestActor = { actorName: job.actorName, actorRole: job.actorRole, actorId: job.actorId };
  try {
    await completeAiReview(job.taskId, job.submissionRound, requestActor, job.id);
  } catch (error) {
    console.error("AI review job failed", errorMessage(error));
    await markAiReviewFailed(job.taskId, job.submissionRound, requestActor, errorMessage(error), job.id);
  }
  return (await readDb()).jobs.find((item) => item.id === jobId);
}

async function completeAiReview(taskId: string, submissionRound: number, requestActor: RequestActor, jobId: string) {
  let db = await readDb();
  let task = db.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "ai_reviewing" || task.submissionRound !== submissionRound) throw new Error("任务已不在当前 AI 审核轮次");
  const currentTask = task;
  let selectedFrames = db.frames.filter((frame) => frame.taskId === currentTask.id && frame.selected);
  if (selectedFrames.length === 0) throw new Error("请先选择需要审核的 Frame");

  if (currentTask.source === "upload") {
    if (selectedFrames.some((frame) => !frame.exportedImageUrl && !frame.thumbnailUrl)) {
      throw new Error("上传图片数据缺失，请重新上传图片");
    }
    selectedFrames = selectedFrames.map((frame) => ({
      ...frame,
      exportedImageUrl: frame.exportedImageUrl || frame.thumbnailUrl
    }));
    await updateReviewJobStage(jobId, "analyzing");
  } else {
    if (!currentTask.figmaFileKey) throw new Error("任务尚未读取 Figma 文件");
    await updateReviewJobStage(jobId, "exporting");
    await logWithActor(currentTask.id, requestActor, "导出 Figma Frame 图片");
    const exports = await getFrameImages(currentTask.figmaFileKey, selectedFrames.map((frame) => frame.figmaNodeId), "png", 2);
    selectedFrames = await mutateDb((currentDb) => {
      currentDb.frames.forEach((frame) => {
        if (frame.taskId === taskId && exports[frame.figmaNodeId]) frame.exportedImageUrl = exports[frame.figmaNodeId];
      });
      return currentDb.frames.filter((frame) => frame.taskId === taskId && frame.selected);
    });
    await updateReviewJobStage(jobId, "analyzing");
  }

  await logWithActor(task.id, requestActor, "AI 正在分析图片并生成报告");
  db = await readDb();
  task = db.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "ai_reviewing" || task.submissionRound !== submissionRound) return;
  const previousRound = getPreviousIssueRound(submissionRound, db.issues.filter((issue) => issue.taskId === task.id).map((issue) => issue.submissionRound ?? 1));
  const previousIssues = previousRound ? db.issues.filter((issue) => issue.taskId === task.id && (issue.submissionRound ?? 1) === previousRound) : [];
  const standard = await loadBrandStandardAsync();
  const sections = parseMarkdownSections(standard.content);
  const review = await runAiReview({ task, frames: selectedFrames, sections, previousIssues, standardSource: standard });
  const resultId = uid("result");
  await updateReviewJobStage(jobId, "reporting");

  await mutateDb((currentDb) => {
    const currentTask = currentDb.tasks.find((item) => item.id === taskId);
    if (!currentTask || currentTask.status !== "ai_reviewing" || currentTask.submissionRound !== submissionRound) return;
    currentTask.status = getAiDecisionStatus(review.total_score, review.veto_issues);
    currentTask.aiTotalScore = review.total_score;
    currentTask.updatedAt = now();
    currentDb.results = currentDb.results.filter((result) => !(result.taskId === taskId && result.submissionRound === submissionRound));
    currentDb.issues = currentDb.issues.filter((issue) => !(issue.taskId === taskId && issue.submissionRound === submissionRound));
    const result = {
      id: resultId,
      taskId,
      submissionRound,
      totalScore: review.total_score,
      conclusion: review.conclusion,
      dimensionScores: review.dimension_scores as any,
      rawAiResponse: review,
      createdAt: now()
    };
    currentDb.results.push(result);
    const frames = currentDb.frames.filter((frame) => frame.taskId === taskId && frame.selected);
    const issues = review.issues.map((issue: any) => {
      const frame = frames.find((item) => item.frameName === (issue.frame_name ?? issue.frameName));
      return toReviewIssue(issue, taskId, resultId, frame, submissionRound);
    });
    currentDb.issues.push(...issues);
    currentDb.logs.unshift({ id: uid("log"), taskId, ...requestActor, action: "完成 AI 初审", createdAt: now() });
    const currentJob = currentDb.jobs.find((item) => item.id === jobId);
    if (currentJob) {
      const finishedAt = now();
      currentJob.status = "succeeded";
      currentJob.stage = "succeeded";
      currentJob.updatedAt = finishedAt;
      currentJob.finishedAt = finishedAt;
      delete currentJob.leaseExpiresAt;
    }
  });
}

async function markAiReviewFailed(taskId: string, submissionRound: number, requestActor: RequestActor, message: string, jobId?: string) {
  await mutateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (task && task.status === "ai_reviewing" && task.submissionRound === submissionRound) {
      task.status = "ai_review_failed";
      task.updatedAt = now();
      db.logs.unshift({ id: uid("log"), taskId, ...requestActor, action: `AI 初审失败：${message}`, createdAt: now() });
    }
    const job = jobId ? db.jobs.find((item) => item.id === jobId) : undefined;
    if (job) {
      const finishedAt = now();
      job.status = "failed";
      job.stage = "failed";
      job.error = message;
      job.updatedAt = finishedAt;
      job.finishedAt = finishedAt;
      delete job.leaseExpiresAt;
    }
  });
}

async function updateReviewJobStage(jobId: string, stage: ReviewJob["stage"]) {
  await mutateDb((db) => {
    const job = db.jobs.find((item) => item.id === jobId);
    if (!job || job.status !== "running") return;
    job.stage = stage;
    job.updatedAt = now();
    job.leaseExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  });
}

function latestReviewJob(jobs: ReviewJob[]) {
  return [...jobs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function cancelActiveReviewJobs(db: Database, taskId: string) {
  const finishedAt = now();
  db.jobs.forEach((job) => {
    if (job.taskId !== taskId || (job.status !== "queued" && job.status !== "running")) return;
    job.status = "cancelled";
    job.stage = "cancelled";
    job.updatedAt = finishedAt;
    job.finishedAt = finishedAt;
    delete job.leaseExpiresAt;
  });
}

async function logWithActor(taskId: string | undefined, requestActor: RequestActor, action: string) {
  await mutateDb((db) => {
    db.logs.unshift({ id: uid("log"), taskId, ...requestActor, action, createdAt: now() });
  });
}

function actorFrom(source?: express.Request | RequestActor): RequestActor {
  if (!source) return { actorName: "System", actorRole: "管理员" };
  if (typeof (source as express.Request).header === "function") return actor(source as express.Request);
  return source as RequestActor;
}

async function setTaskStatus(id: string, status: ReviewTask["status"], action?: string, source?: express.Request | RequestActor) {
  return mutateDb((db) => {
    const task = db.tasks.find((item) => item.id === id);
    if (!task) throw new Error("任务不存在");
    task.status = status;
    task.updatedAt = now();
    if (action) {
      db.logs.unshift({
        id: uid("log"),
        taskId: task.id,
        ...actorFrom(source),
        action,
        createdAt: now()
      });
    }
    return task;
  });
}

async function reconcileStaleAiReviews() {
  const db = await readDb();
  const staleTasks = db.tasks.filter((task) => isStaleAiReview(task, db.results, db.jobs));
  if (staleTasks.length === 0) return db;
  return mutateDb((currentDb) => {
    currentDb.tasks.forEach((task) => {
      if (!isStaleAiReview(task, currentDb.results, currentDb.jobs)) return;
      task.status = "ai_review_failed";
      task.updatedAt = now();
      currentDb.logs.unshift({
        id: uid("log"),
        taskId: task.id,
        actorName: "System",
        actorRole: "管理员",
        action: "AI 初审超时，请刷新后重新发起",
        createdAt: now()
      });
    });
    return currentDb;
  });
}

function isStaleAiReview(task: ReviewTask, results: Array<{ taskId: string; submissionRound: number }>, jobs: ReviewJob[]) {
  if (task.status !== "ai_reviewing") return false;
  if (results.some((result) => result.taskId === task.id && result.submissionRound === task.submissionRound)) return false;
  if (jobs.some((job) => job.taskId === task.id && job.submissionRound === task.submissionRound && (job.status === "queued" || job.status === "running"))) return false;
  const updatedAt = Date.parse(task.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  const staleMs = Number(process.env.AI_REVIEW_STALE_MINUTES ?? 6) * 60 * 1000;
  return Date.now() - updatedAt > staleMs;
}

async function getTask(id: string) {
  const task = (await readDb()).tasks.find((item) => item.id === id);
  if (!task) throw new Error("任务不存在");
  return task;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function validateCreateTaskInput(body: any) {
  if (typeof body?.title !== "string" || !body.title.trim()) throw new Error("任务名称不能为空");
  if (!["电商页面", "Amazon A+ 页面", "官网 Banner"].includes(body.contentType)) throw new Error("内容类型不合法");
  parseFigmaUrl(body.figmaUrl);
}

function validateCreateUploadTaskInput(body: any) {
  if (typeof body?.title !== "string" || !body.title.trim()) throw new Error("任务名称不能为空");
  if (!["电商页面", "Amazon A+ 页面", "官网 Banner"].includes(body.contentType)) throw new Error("内容类型不合法");
  normalizeUploadedImages(body.images);
}

function maxUploadImagesPerTask() {
  return Number(process.env.MAX_UPLOAD_IMAGES_PER_TASK ?? 9);
}

function normalizeUploadedImages(images: any[]) {
  if (!Array.isArray(images) || images.length === 0) throw new Error("请至少上传 1 张图片");
  const maxImages = maxUploadImagesPerTask();
  if (images.length > maxImages) throw new Error(`单个项目最多上传 ${maxImages} 张图片`);
  return images.map((image, index) => {
    const fileName = typeof image?.fileName === "string" && image.fileName.trim() ? image.fileName.trim() : `图片 ${index + 1}`;
    const mimeType = typeof image?.mimeType === "string" ? image.mimeType : "";
    const dataUrl = typeof image?.dataUrl === "string" ? image.dataUrl : "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new Error("仅支持 PNG、JPG、WebP 图片");
    if (!dataUrl.startsWith(`data:${mimeType};base64,`)) throw new Error("图片数据格式不合法");
    if (dataUrl.length > 28_000_000) throw new Error("单张图片不能超过约 20MB");
    return { fileName, mimeType, dataUrl };
  });
}

function normalizeAiOnlyTask(task: ReviewTask): ReviewTask {
  return { ...task, status: normalizeAiOnlyStatus(task.status, task.aiTotalScore) };
}

const OM03_UPLOAD_FRAME_NAME = "iwEcAqNqcGcDAQTRM6wF0RStBrABj6hVj31bTgnPcqKdlGkAB9IP2gviCAAJomltCgAL0gBZbx8.jpg";
const OM03_TEXT_MODULE_ANNOTATION: NonNullable<ReviewIssue["annotationSuggestion"]> = {
  type: "rect",
  xPercent: 7.14,
  yPercent: 21.97,
  widthPercent: 42.15,
  heightPercent: 10.85,
  confidence: 0.95,
  source: "manual"
};

function normalizeAnnotationForResponse<T extends Partial<ReviewIssue> & { annotationSuggestion?: ReviewIssue["annotationSuggestion"] }>(issue: T): T {
  const annotation = issue.annotationSuggestion;
  if (!annotation || !isGenericPlaceholderAnnotation(annotation)) return issue;
  const preciseAnnotation = preciseAnnotationForKnownSeedIssue(issue);
  if (preciseAnnotation) return { ...issue, annotationSuggestion: preciseAnnotation } as T;
  const { annotationSuggestion, ...rest } = issue;
  return rest as T;
}

function preciseAnnotationForKnownSeedIssue(issue: Partial<ReviewIssue>) {
  if (
    issue.frameName === OM03_UPLOAD_FRAME_NAME &&
    issue.title === "卖点层级与产品证明信息需要加强" &&
    issue.relatedStandardSection === "Amazon PDP / A+ Content Rules"
  ) {
    return OM03_TEXT_MODULE_ANNOTATION;
  }
  return undefined;
}

function isGenericPlaceholderAnnotation(annotation: NonNullable<ReviewIssue["annotationSuggestion"]>) {
  return (
    approximately(annotation.xPercent, 7) &&
    approximately(annotation.yPercent, 28) &&
    approximately(annotation.widthPercent ?? 0, 36) &&
    approximately(annotation.heightPercent ?? 0, 30) &&
    (annotation.confidence ?? 0) <= 0.8
  );
}

function approximately(value: number, expected: number) {
  return Math.abs(value - expected) < 0.001;
}

function errorStatus(error: unknown) {
  const message = errorMessage(error);
  if (message.includes("持久数据库")) return 503;
  if (message.includes("Figma API 限流") || message.includes("Rate limit")) return 429;
  if (message.includes("无权")) return 403;
  if (
    message.includes("不允许") ||
    message.includes("不存在") ||
    message.includes("必须") ||
    message.includes("不能为空") ||
    message.includes("不合法") ||
    message.includes("图片") ||
    message.includes("请输入") ||
    message.includes("最多")
  ) return 400;
  return 500;
}

function withoutSecret(config: ReturnType<typeof getAiProviderConfig>) {
  const { apiKey, ...safe } = config;
  return safe;
}

function safeAiProviderConfig() {
  return withoutSecret(getAiProviderConfig());
}

if (process.env.NODE_ENV !== "test" && process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`EMKE Design Review API listening on http://localhost:${port}`);
  });
}

export default app;
