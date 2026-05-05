import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { getStorageMode, mutateDb, now, readDb, uid } from "./db.js";
import { getFrameImages, parseFigmaUrl, readFileStructure } from "./services/figma.js";
import { loadBrandStandardAsync, parseMarkdownSections, saveUploadedBrandStandardAsync } from "./services/vis.js";
import { getAiProviderConfig, getAiProviderConfigAsync, getDefaultAiModel, getDefaultAiModelAsync, runAiReview, saveAiProviderConfigAsync, toReviewIssue } from "./services/aiReview.js";
import { ContentType, ReviewFrame, ReviewTask, Role } from "./types.js";
import { decodeHeaderValue } from "../src/shared/headerEncoding.js";
import { assertRole, assertTransition, canDeleteTaskStatus, canWithdrawTaskStatus, getAiDecisionStatus, getPreviousIssueRound } from "./services/workflow.js";

dotenv.config();

export const app = express();
const port = Number(process.env.API_PORT ?? 8787);
const accessCode = process.env.REVIEW_ACCESS_CODE ?? "emke.de";

app.use(cors());
app.use(express.json({ limit: process.env.API_JSON_LIMIT ?? "240mb" }));

function actor(req: express.Request) {
  return {
    actorName: decodeHeaderValue(req.header("x-actor-name"), "未命名"),
    actorRole: decodeHeaderValue(req.header("x-actor-role"), "设计师") as Role
  };
}

function requireAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === "/api/access") return next();
  if (req.header("x-access-code") !== accessCode) return res.status(401).json({ error: "访问口令错误或缺失" });
  next();
}

async function log(taskId: string | undefined, req: express.Request, action: string) {
  await mutateDb((db) => {
    db.logs.unshift({ id: uid("log"), taskId, ...actor(req), action, createdAt: now() });
  });
}

app.use(requireAccess);

app.post("/api/access", (req, res) => {
  const ok = req.body?.accessCode === accessCode;
  res.status(ok ? 200 : 401).json(ok ? { ok: true } : { error: "访问口令错误" });
});

app.get("/api/health", async (_req, res) => {
  const aiProvider = await getAiProviderConfigAsync();
  res.json({
    ok: true,
    storageMode: getStorageMode(),
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
  const db = await readDb();
  const tasks = db.tasks.map((task) => ({
    ...normalizeAiOnlyTask(task),
    frameCount: db.frames.filter((frame) => frame.taskId === task.id).length,
    issueCount: db.issues.filter((issue) => issue.taskId === task.id).length
  }));
  res.json(tasks);
});

app.get("/api/reviews/:id", async (req, res) => {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  const taskIssues = db.issues.filter((issue) => issue.taskId === task.id).map((issue) => {
    const issueWithRound = { ...issue, submissionRound: issue.submissionRound ?? task.submissionRound ?? 1 };
    if (issue.relatedStandardSection === "Design Principles" && issue.locationDescription?.includes("主视觉右侧卖点区域")) {
      return {
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
      };
    }
    return issueWithRound;
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
    logs: db.logs.filter((item) => item.taskId === task.id)
  });
});

app.post("/api/reviews", async (req, res) => {
  const { actorName } = actor(req);
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
      submitterName: req.body.submitterName || actorName,
      submitterId: req.body.submitterId || actorName,
      submitterRole: "设计师",
      createdAt: now(),
      updatedAt: now(),
      submissionRound: 1
    };
    db.tasks.unshift(created);
    db.logs.unshift({ id: uid("log"), taskId: created.id, ...actor(req), action: "创建审核任务", createdAt: now() });
    return created;
  });
  res.json(task);
});

app.post("/api/reviews/upload-images", async (req, res) => {
  const { actorName } = actor(req);
  let taskId = "";
  try {
    assertRole(actor(req).actorRole, ["设计师"], "创建图片审核任务");
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
        submitterName: req.body.submitterName || actorName,
        submitterId: req.body.submitterId || actorName,
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
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: `上传 ${frames.length} 张图片并创建审核任务`, createdAt: now() });
      return { task, frames };
    });
    taskId = created.task.id;

    const standard = await loadBrandStandardAsync();
    const sections = parseMarkdownSections(standard.content);
    const review = await runAiReview({ task: created.task, frames: created.frames, sections, previousIssues: [], standardSource: standard });
    const resultId = uid("result");

    const saved = await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === created.task.id)!;
      task.status = getAiDecisionStatus(review.total_score, review.veto_issues);
      task.aiTotalScore = review.total_score;
      task.updatedAt = now();
      const result = {
        id: resultId,
        taskId: task.id,
        submissionRound: task.submissionRound,
        totalScore: review.total_score,
        conclusion: review.conclusion,
        dimensionScores: review.dimension_scores as any,
        rawAiResponse: review,
        createdAt: now()
      };
      db.results.push(result);
      const frames = db.frames.filter((frame) => frame.taskId === task.id && frame.selected);
      const issues = review.issues.map((issue: any) => {
        const frame = frames.find((item) => item.frameName === (issue.frame_name ?? issue.frameName));
        return toReviewIssue(issue, task.id, resultId, frame, task.submissionRound);
      });
      db.issues.push(...issues);
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: "完成 AI 初审", createdAt: now() });
      return { task, frames, result, issues };
    });
    res.json(saved);
  } catch (error) {
    if (taskId) await setTaskStatus(taskId, "ai_review_failed");
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.patch("/api/reviews/:id", async (req, res) => {
  try {
    assertRole(actor(req).actorRole, ["设计师"], "编辑任务信息");
    const saved = await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      if (typeof req.body.title === "string" && req.body.title.trim()) task.title = req.body.title.trim();
      if (typeof req.body.submitterId === "string") task.submitterId = req.body.submitterId.trim();
      task.updatedAt = now();
      db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: "更新任务名称或提交人 ID", createdAt: now() });
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
      if (!canWithdrawTaskStatus(normalizeAiOnlyStatus(task.status, task.aiTotalScore))) throw new Error("当前状态不允许撤回任务");
      task.status = "archived";
      task.updatedAt = now();
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
    assertRole(actor(req).actorRole, ["设计师"], "删除任务");
    await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      if (!canDeleteTaskStatus(normalizeAiOnlyStatus(task.status, task.aiTotalScore))) throw new Error("当前状态不允许删除任务");
      db.tasks = db.tasks.filter((item) => item.id !== task.id);
      db.frames = db.frames.filter((item) => item.taskId !== task.id);
      db.results = db.results.filter((item) => item.taskId !== task.id);
      db.issues = db.issues.filter((item) => item.taskId !== task.id);
      db.operationReviews = db.operationReviews.filter((item) => item.taskId !== task.id);
      db.directorDecisions = db.directorDecisions.filter((item) => item.taskId !== task.id);
      db.logs = db.logs.filter((item) => item.taskId !== task.id);
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
  try {
    assertRole(actor(req).actorRole, ["设计师"], "开始 AI 初审");
    const maxFrames = Number(process.env.MAX_FRAMES_PER_TASK ?? 12);
    const db = await readDb();
    const task = db.tasks.find((item) => item.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    assertTransition(task.status, ["frame_selection", "ai_review_failed"], "开始 AI 初审");
    let selectedFrames = db.frames.filter((frame) => frame.taskId === task.id && frame.selected);
    if (selectedFrames.length === 0) return res.status(400).json({ error: "请先选择需要审核的 Frame" });
    if (selectedFrames.length > maxFrames) return res.status(400).json({ error: `单次最多审核 ${maxFrames} 个 Frame` });
    if (!task.figmaFileKey) return res.status(400).json({ error: "任务尚未读取 Figma 文件" });

    await setTaskStatus(task.id, "ai_reviewing");
    startedAiReview = true;
    const exports = await getFrameImages(task.figmaFileKey, selectedFrames.map((frame) => frame.figmaNodeId), "png", 2);
    selectedFrames = await mutateDb((currentDb) => {
      currentDb.frames.forEach((frame) => {
        if (frame.taskId === task.id && exports[frame.figmaNodeId]) frame.exportedImageUrl = exports[frame.figmaNodeId];
      });
      return currentDb.frames.filter((frame) => frame.taskId === task.id && frame.selected);
    });

    const standard = await loadBrandStandardAsync();
    const sections = parseMarkdownSections(standard.content);
    const previousRound = getPreviousIssueRound(task.submissionRound, db.issues.filter((issue) => issue.taskId === task.id).map((issue) => issue.submissionRound ?? 1));
    const previousIssues = previousRound ? db.issues.filter((issue) => issue.taskId === task.id && (issue.submissionRound ?? 1) === previousRound) : [];
    const review = await runAiReview({ task, frames: selectedFrames, sections, previousIssues, standardSource: standard });
    const resultId = uid("result");

    const saved = await mutateDb((currentDb) => {
      const currentTask = currentDb.tasks.find((item) => item.id === task.id)!;
      currentTask.status = getAiDecisionStatus(review.total_score, review.veto_issues);
      currentTask.aiTotalScore = review.total_score;
      currentTask.updatedAt = now();
      const result = {
        id: resultId,
        taskId: task.id,
        submissionRound: currentTask.submissionRound,
        totalScore: review.total_score,
        conclusion: review.conclusion,
        dimensionScores: review.dimension_scores as any,
        rawAiResponse: review,
        createdAt: now()
      };
      currentDb.results.push(result);
      const issues = review.issues.map((issue: any) => {
        const frame = selectedFrames.find((item) => item.frameName === (issue.frame_name ?? issue.frameName));
        return toReviewIssue(issue, task.id, resultId, frame, currentTask.submissionRound);
      });
      currentDb.issues.push(...issues);
      currentDb.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: "完成 AI 初审", createdAt: now() });
      return { task: currentTask, result, issues };
    });
    res.json(saved);
  } catch (error) {
    if (startedAiReview) await setTaskStatus(req.params.id, "ai_review_failed");
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/reviews/:id/operation-review", (req, res) => {
  res.status(410).json({ error: "运营复审流程已取消，任务现在由 AI 审核直接给出结论" });
});

app.post("/api/reviews/:id/director-decision", (req, res) => {
  res.status(410).json({ error: "设计总监终审流程已取消，任务现在由 AI 审核直接给出结论" });
});

app.post("/api/reviews/:id/resubmit", async (req, res) => {
  let startedResubmit = false;
  let resubmitSource: ReviewTask["source"] | undefined;
  try {
    assertRole(actor(req).actorRole, ["设计师"], "重新提交");
    const existing = await getTask(req.params.id);
    assertTransition(normalizeAiOnlyStatus(existing.status), ["needs_revision"], "重新提交");
    resubmitSource = existing.source;
    const task = await mutateDb((db) => {
      const current = db.tasks.find((item) => item.id === req.params.id);
      if (!current) throw new Error("任务不存在");
      current.status = "resubmitted";
      current.submissionRound += 1;
      current.updatedAt = now();
      if (req.body.figmaUrl) current.figmaUrl = req.body.figmaUrl;
      db.logs.unshift({ id: uid("log"), taskId: current.id, ...actor(req), action: "重新提交", createdAt: now() });
      return current;
    });
    startedResubmit = true;
    if (task.source === "upload") {
      const images = normalizeUploadedImages(req.body.images);
      const created = await mutateDb((db) => {
        const current = db.tasks.find((item) => item.id === task.id)!;
        current.status = "ai_reviewing";
        current.updatedAt = now();
        db.frames = db.frames.filter((frame) => frame.taskId !== task.id);
        const frames: ReviewFrame[] = images.map((image, index) => ({
          id: `${task.id}_upload_${task.submissionRound}_${index + 1}`,
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
        db.frames.push(...frames);
        db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: `上传 ${frames.length} 张图片并重新提交`, createdAt: now() });
        return { task: current, frames };
      });

      const db = await readDb();
      const previousRound = getPreviousIssueRound(created.task.submissionRound, db.issues.filter((issue) => issue.taskId === task.id).map((issue) => issue.submissionRound ?? 1));
      const previousIssues = previousRound ? db.issues.filter((issue) => issue.taskId === task.id && (issue.submissionRound ?? 1) === previousRound) : [];
      const standard = await loadBrandStandardAsync();
      const sections = parseMarkdownSections(standard.content);
      const review = await runAiReview({ task: created.task, frames: created.frames, sections, previousIssues, standardSource: standard });
      const resultId = uid("result");

      const saved = await mutateDb((db) => {
        const current = db.tasks.find((item) => item.id === task.id)!;
        current.status = getAiDecisionStatus(review.total_score, review.veto_issues);
        current.aiTotalScore = review.total_score;
        current.updatedAt = now();
        const result = {
          id: resultId,
          taskId: task.id,
          submissionRound: current.submissionRound,
          totalScore: review.total_score,
          conclusion: review.conclusion,
          dimensionScores: review.dimension_scores as any,
          rawAiResponse: review,
          createdAt: now()
        };
        db.results.push(result);
        const frames = db.frames.filter((frame) => frame.taskId === task.id && frame.selected);
        const issues = review.issues.map((issue: any) => {
          const frame = frames.find((item) => item.frameName === (issue.frame_name ?? issue.frameName));
          return toReviewIssue(issue, task.id, resultId, frame, current.submissionRound);
        });
        db.issues.push(...issues);
        db.logs.unshift({ id: uid("log"), taskId: task.id, ...actor(req), action: "完成 AI 初审", createdAt: now() });
        return { task: current, frames, result, issues };
      });
      return res.json(saved);
    }
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
    res.json({ task: updated, frames: structure.frames });
  } catch (error) {
    if (startedResubmit) await setTaskStatus(req.params.id, resubmitSource === "upload" ? "ai_review_failed" : "figma_read_failed");
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

async function setTaskStatus(id: string, status: ReviewTask["status"]) {
  return mutateDb((db) => {
    const task = db.tasks.find((item) => item.id === id);
    if (!task) throw new Error("任务不存在");
    task.status = status;
    task.updatedAt = now();
    return task;
  });
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

function normalizeAiOnlyStatus(status: ReviewTask["status"], score?: number): ReviewTask["status"] {
  if (status === "operation_review" || status === "director_review") {
    return typeof score === "number" && score >= 85 ? "approved" : "needs_revision";
  }
  if (status === "approved" && typeof score === "number" && score < 85) {
    return "needs_revision";
  }
  return status;
}

function errorStatus(error: unknown) {
  const message = errorMessage(error);
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
