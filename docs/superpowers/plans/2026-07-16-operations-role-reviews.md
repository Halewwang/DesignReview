# Operations Role and Supplemental Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operations login role that can read every designer task and append round-scoped supplemental reviews without changing workflow state, while configuring the production administrator code.

**Architecture:** Extend the existing server-issued session contract to include `运营`, enforce task visibility at the API boundary, and restore the existing `OperationReview` persistence shape as an append-only endpoint. Keep the React SPA architecture intact by adding a focused review panel inside the existing detail surface and preserve the current JSONB document storage without a migration.

**Tech Stack:** TypeScript 5.8, React 19, Express 5, Vitest 4, Postgres.js, Supabase Postgres, Vite 8, Vercel CLI.

## Global Constraints

- Operations reviews are append-only and never change task status, AI score, task `updatedAt`, final decision, or final reason.
- Operations and designers share `REVIEW_ACCESS_CODE`; administrators use `REVIEW_ADMIN_ACCESS_CODE=emke666` in Production.
- Designers can read only their own tasks; operations and administrators can read all tasks.
- Only operations can submit an operations review. Designers and administrators receive HTTP 403.
- Operations cannot create, edit, withdraw, resubmit, delete, retry, approve, or change settings.
- Reuse the existing `operationReviews` JSONB collection; do not create a database migration.
- Preserve Supabase RLS on `public.emke_design_review_store` and keep `anon` and `authenticated` privileges revoked.
- Stage only intended project files. Leave `.agents/`, `.claude/`, `.kiro/`, `.trae/`, and `.windsurf/` untracked.

## File Structure

- `server/types.ts`: canonical server role, session, and operations review shapes.
- `src/shared/session.ts`: canonical client role and stored-session normalization.
- `server/services/workflow.ts`: reusable task visibility authorization.
- `server/index.ts`: login, task reads, and append-only operations review API.
- `src/main.tsx`: login selector, role-aware dashboard actions, operations review panel, and localized copy.
- `src/styles.css`: operations review panel layout and responsive states.
- `tests/session.test.ts`: stored-session and role-switch behavior.
- `tests/workflow-and-filters.test.ts`: task visibility authorization and default filters.
- `tests/api-storage.test.ts`: login, task read, review append, and permission integration tests.

---

### Task 1: Extend the Login and Session Contract

**Files:**
- Modify: `server/types.ts:1-175`
- Modify: `src/shared/session.ts:1-30`
- Modify: `server/index.ts:50-110`
- Test: `tests/session.test.ts`
- Test: `tests/api-storage.test.ts`

**Interfaces:**
- Consumes: existing `REVIEW_ACCESS_CODE`, `REVIEW_ADMIN_ACCESS_CODE`, `expectedAccessCode(role)` and `normalizeStoredSession(value)`.
- Produces: `ClientRole = "设计师" | "运营" | "管理员"`; `ReviewSession.role` with the same union; successful `POST /api/access` sessions for operations.

- [ ] **Step 1: Write failing session tests**

Add these assertions to `tests/session.test.ts`:

```ts
it("accepts an operations session", () => {
  expect(normalizeStoredSession({
    token: "operations-token",
    role: "运营",
    name: "Ops",
    userId: "Ops"
  })).toMatchObject({ role: "运营", name: "Ops", userId: "Ops" });
});

it("uses the standard access code when operations is selected", () => {
  expect(accessCodeForRoleSelection("运营", "emke.de")).toBe("emke.de");
});
```

Change the malformed-role assertion so it rejects `设计总监` instead of `运营`.

- [ ] **Step 2: Write the failing operations login API test**

Add to `tests/api-storage.test.ts`:

```ts
it("issues an operations session with the standard access code", async () => {
  const response = await request(app)
    .post("/api/access")
    .send({ accessCode: "emke.de", role: "运营", name: "Ops" });

  expect(response.status).toBe(200);
  expect(response.body.session).toMatchObject({ role: "运营", name: "Ops", userId: "Ops" });
  expect(response.body.session.token).toEqual(expect.any(String));
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/session.test.ts tests/api-storage.test.ts --pool=forks --maxWorkers=1 --fileParallelism=false
```

Expected: failures show that `运营` is rejected by client session normalization and `POST /api/access` returns 401.

- [ ] **Step 4: Implement the shared role contract**

In `src/shared/session.ts` use:

```ts
export type ClientRole = "设计师" | "运营" | "管理员";

export type StoredSession = {
  token?: string;
  accessCode?: string;
  role: ClientRole;
  name: string;
  userId?: string;
  expiresAt?: string;
};

export function accessCodeForRoleSelection(role: ClientRole, designerAccessCode: string) {
  return role === "管理员" ? "" : designerAccessCode;
}

export function normalizeStoredSession(value: unknown): StoredSession | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<StoredSession>;
  if (!(["设计师", "运营", "管理员"] as ClientRole[]).includes(input.role as ClientRole)) return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const accessCode = typeof input.accessCode === "string" ? input.accessCode : "";
  if (!name || (!token && !accessCode)) return null;

  const session: StoredSession = { role: input.role as ClientRole, name };
  if (token) session.token = token;
  if (accessCode) session.accessCode = accessCode;
  if (typeof input.userId === "string" && input.userId.trim()) session.userId = input.userId.trim();
  if (typeof input.expiresAt === "string" && input.expiresAt.trim()) session.expiresAt = input.expiresAt.trim();
  return session;
}
```

In `server/types.ts` change only `ReviewSession.role`:

```ts
export type ReviewSession = {
  id: string;
  tokenHash: string;
  role: "设计师" | "运营" | "管理员";
  name: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};
```

In `server/index.ts` define and use the login role list:

```ts
const loginRoles: Role[] = ["设计师", "运营", "管理员"];

if (!loginRoles.includes(role) || !name || !expectedCode || req.body?.accessCode !== expectedCode) {
  const error = role === "管理员"
    ? expectedCode ? "管理员访问口令错误" : "管理员访问口令未配置"
    : "访问口令错误";
  return res.status(401).json({ error });
}
```

Save the session with `role` directly instead of the narrower `role as "设计师" | "管理员"` cast.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 3.

Expected: `tests/session.test.ts` and the login cases in `tests/api-storage.test.ts` pass.

- [ ] **Step 6: Commit the role contract**

```bash
git add server/types.ts server/index.ts src/shared/session.ts tests/session.test.ts tests/api-storage.test.ts
git commit -m "Add operations login role"
```

---

### Task 2: Enforce Role-Based Task Visibility

**Files:**
- Modify: `server/services/workflow.ts:1-70`
- Modify: `server/index.ts:206-252`
- Test: `tests/workflow-and-filters.test.ts`
- Test: `tests/api-storage.test.ts`

**Interfaces:**
- Consumes: `Role`, task `submitterId`/`submitterName`, request actor identity.
- Produces: `canViewTask(role, task, actorIdentity): boolean` and `assertTaskViewPermission(role, task, actorIdentity): void`.

- [ ] **Step 1: Write failing visibility unit tests**

Update the workflow imports and add:

```ts
it("limits designers to their own tasks while privileged readers see all", () => {
  const task = { submitterId: "EMKE-Hale", submitterName: "Hale" };

  expect(canViewTask("设计师", task, "EMKE-Hale")).toBe(true);
  expect(canViewTask("设计师", task, "Other")).toBe(false);
  expect(canViewTask("运营", task, "Ops")).toBe(true);
  expect(canViewTask("管理员", task, "Admin")).toBe(true);
  expect(() => assertTaskViewPermission("设计师", task, "Other")).toThrow("当前身份无权查看他人任务");
});
```

- [ ] **Step 2: Write failing API visibility tests**

Create designer and operations sessions through `/api/access`, seed one Hale task and one Other task, then assert:

```ts
expect(designerList.body.map((task: { id: string }) => task.id)).toEqual(["task_hale"]);
expect(operationsList.body.map((task: { id: string }) => task.id).sort()).toEqual(["task_hale", "task_other"]);
expect(designerOtherDetail.status).toBe(403);
expect(operationsOtherDetail.status).toBe(200);
```

Use Bearer session tokens rather than legacy actor headers so the test covers the production authorization path.

- [ ] **Step 3: Run visibility tests and verify RED**

```bash
npx vitest run tests/workflow-and-filters.test.ts tests/api-storage.test.ts --pool=forks --maxWorkers=1 --fileParallelism=false
```

Expected: helper imports are missing, designer list contains both tasks, and designer detail returns 200.

- [ ] **Step 4: Implement the visibility helpers**

In `server/services/workflow.ts` add:

```ts
export function canViewTask(
  currentRole: Role,
  task: { submitterId?: string; submitterName?: string },
  actorIdentity: string
) {
  if (currentRole === "运营" || currentRole === "管理员") return true;
  if (currentRole !== "设计师") return false;
  const actor = normalizeActor(actorIdentity);
  const ownerIds = [task.submitterId, task.submitterName].map(normalizeActor).filter(Boolean);
  return Boolean(actor && ownerIds.includes(actor));
}

export function assertTaskViewPermission(
  currentRole: Role,
  task: { submitterId?: string; submitterName?: string },
  actorIdentity: string
) {
  if (!canViewTask(currentRole, task, actorIdentity)) {
    throw new Error("当前身份无权查看他人任务");
  }
}
```

- [ ] **Step 5: Apply visibility at both read endpoints**

Import the helpers in `server/index.ts`. Change the list endpoint to accept `req`, derive the actor, and filter before mapping:

```ts
app.get("/api/reviews", async (req, res) => {
  const db = await reconcileStaleAiReviews();
  const requestActor = actor(req);
  const identity = requestActor.actorId ?? requestActor.actorName;
  const tasks = db.tasks
    .filter((task) => canViewTask(requestActor.actorRole, task, identity))
    .map((task) => ({
      ...normalizeAiOnlyTask(task),
      frameCount: db.frames.filter((frame) => frame.taskId === task.id).length,
      issueCount: db.issues.filter((issue) => issue.taskId === task.id).length
    }));
  res.json(tasks);
});
```

In the detail endpoint, after finding the task:

```ts
try {
  const requestActor = actor(req);
  assertTaskViewPermission(requestActor.actorRole, task, requestActor.actorId ?? requestActor.actorName);
} catch (error) {
  return res.status(403).json({ error: errorMessage(error) });
}
```

- [ ] **Step 6: Run visibility tests and verify GREEN**

Run the command from Step 3.

Expected: designer ownership and operations/admin global visibility cases pass.

- [ ] **Step 7: Commit visibility enforcement**

```bash
git add server/services/workflow.ts server/index.ts tests/workflow-and-filters.test.ts tests/api-storage.test.ts
git commit -m "Enforce task visibility by role"
```

---

### Task 3: Restore Append-Only Operations Reviews

**Files:**
- Modify: `server/index.ts:485-487`
- Test: `tests/api-storage.test.ts:490-530`

**Interfaces:**
- Consumes: authenticated request actor, `Database.operationReviews`, task current `submissionRound`.
- Produces: `POST /api/reviews/:id/operation-review` returning HTTP 201 and a new `OperationReview`.

- [ ] **Step 1: Replace the retired-endpoint test with failing append tests**

Seed a task with stable state fields, authenticate as operations, and add:

```ts
it("appends operations reviews without changing task workflow state", async () => {
  const before = structuredClone((await readDb()).tasks.find((task) => task.id === "task_ops_review"));

  const first = await request(app)
    .post("/api/reviews/task_ops_review/operation-review")
    .set("Authorization", `Bearer ${operationsToken}`)
    .send({ focus: "渠道表达", comment: "补充检查移动端首屏卖点。" });
  const second = await request(app)
    .post("/api/reviews/task_ops_review/operation-review")
    .set("Authorization", `Bearer ${operationsToken}`)
    .send({ comment: "同时核对活动时间。" });

  const db = await readDb();
  const after = db.tasks.find((task) => task.id === "task_ops_review");
  const reviews = db.operationReviews.filter((review) => review.taskId === "task_ops_review");

  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(reviews).toHaveLength(2);
  expect(reviews[0]).toMatchObject({ submissionRound: 2, reviewerName: "Ops", focus: "渠道表达" });
  expect(after).toEqual(before);
});
```

Add separate cases asserting empty comments return 400 and designer/admin tokens return 403.

```ts
expect((await request(app)
  .post("/api/reviews/task_ops_review/operation-review")
  .set("Authorization", `Bearer ${operationsToken}`)
  .send({ comment: "   " })).status).toBe(400);

for (const token of [designerToken, adminToken]) {
  const response = await request(app)
    .post("/api/reviews/task_ops_review/operation-review")
    .set("Authorization", `Bearer ${token}`)
    .send({ comment: "不应写入" });
  expect(response.status).toBe(403);
}
```

- [ ] **Step 2: Run the API test and verify RED**

```bash
npx vitest run tests/api-storage.test.ts --pool=forks --maxWorkers=1 --fileParallelism=false
```

Expected: endpoint returns 410 instead of 201/400/403.

- [ ] **Step 3: Implement the strict append endpoint**

Replace the 410 route with:

```ts
app.post("/api/reviews/:id/operation-review", async (req, res) => {
  const currentActor = actor(req);
  try {
    if (currentActor.actorRole !== "运营") {
      throw new Error("当前身份无权提交运营补充评价");
    }
    const comment = String(req.body?.comment ?? "").trim();
    const focus = String(req.body?.focus ?? "").trim();
    if (!comment) return res.status(400).json({ error: "请输入运营补充评价" });

    const created = await mutateDb((db) => {
      const task = db.tasks.find((item) => item.id === req.params.id);
      if (!task) throw new Error("任务不存在");
      const review = {
        id: uid("operation-review"),
        taskId: task.id,
        submissionRound: task.submissionRound,
        reviewerName: currentActor.actorName,
        comment,
        focus,
        createdAt: now()
      };
      db.operationReviews.push(review);
      db.logs.unshift({
        id: uid("log"),
        taskId: task.id,
        ...currentActor,
        action: "提交运营补充评价",
        createdAt: now()
      });
      return review;
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});
```

The existing `errorStatus` already maps messages containing `无权` to 403 and `不存在` to 400, so no error mapper change is required. Add an API assertion that an operations request for a missing task returns 400 with `任务不存在`.

- [ ] **Step 4: Run the API test and verify GREEN**

Run the command from Step 2.

Expected: append, immutability, validation, and role rejection cases pass.

- [ ] **Step 5: Commit the API capability**

```bash
git add server/index.ts tests/api-storage.test.ts
git commit -m "Restore operations supplemental reviews"
```

---

### Task 4: Add the Operations UI

**Files:**
- Modify: `src/main.tsx:1-1745`
- Modify: `src/styles.css`
- Test: `tests/session.test.ts`
- Test: `tests/workflow-and-filters.test.ts`

**Interfaces:**
- Consumes: `ClientRole`, `Detail.operationReviews`, `POST /api/reviews/:id/operation-review`.
- Produces: three-role login selector, role-aware dashboard actions, history list, and operations-only form.

- [ ] **Step 1: Add failing client contract assertions**

Ensure `tests/session.test.ts` asserts operations role normalization and standard-code selection from Task 1. Add to `tests/workflow-and-filters.test.ts`:

```ts
expect(defaultTaskFilters("运营")).toMatchObject({ onlyMine: false });
expect(defaultTaskFilters("管理员")).toMatchObject({ onlyMine: false });
```

Run:

```bash
npx vitest run tests/session.test.ts tests/workflow-and-filters.test.ts --pool=forks --maxWorkers=1 --fileParallelism=false
```

Expected before Task 1 implementation: operations session assertions fail; after Task 1, this step documents the client gate and remains green.

- [ ] **Step 2: Extend frontend types and login selector**

In `src/main.tsx` use:

```ts
type Role = "设计师" | "运营" | "管理员";

type OperationReview = {
  id: string;
  taskId: string;
  submissionRound: number;
  reviewerName: string;
  comment: string;
  focus: string;
  createdAt: string;
};
```

Ensure `Detail` includes `operationReviews: OperationReview[]`. Add the option between designer and administrator:

```tsx
<option value="设计师">{label("设计师")}</option>
<option value="运营">{label("运营")}</option>
<option value="管理员">{label("管理员")}</option>
```

Keep the administrator-specific label and placeholder condition unchanged so operations uses the standard access-code copy.

- [ ] **Step 3: Hide designer/admin actions from operations**

In `Dashboard`, render the create button only for designer/admin:

```tsx
{session.role !== "运营" && (
  <button className="primary" type="button" onClick={onNew}>
    <UploadCloud size={16} /> {t("New review task")}
  </button>
)}
```

In `ReviewDetail`, make ownership management designer-specific:

```ts
const canManageTask = session.role === "管理员" || (session.role === "设计师" && ownsTask);
```

This keeps operations out of edit, retry, resubmit, withdraw, delete, and admin approval controls.

- [ ] **Step 4: Add the operations review submit handler and panel**

Add state and submit logic inside `ReviewDetail`:

```ts
const [operationDraft, setOperationDraft] = useState({ focus: "", comment: "" });
const [operationBusy, setOperationBusy] = useState(false);

async function submitOperationReview(event: FormEvent) {
  event.preventDefault();
  if (!operationDraft.comment.trim()) {
    setError(t("Enter an operations supplemental review"));
    return;
  }
  setError("");
  setOperationBusy(true);
  try {
    await api(`/api/reviews/${taskId}/operation-review`, session, {
      method: "POST",
      body: {
        focus: operationDraft.focus.trim(),
        comment: operationDraft.comment.trim()
      }
    });
    setOperationDraft({ focus: "", comment: "" });
    reload();
  } catch (err) {
    setError(err instanceof Error ? err.message : t("Operations review failed"));
  } finally {
    setOperationBusy(false);
  }
}
```

Render a panel after the review layout and before supporting history:

```tsx
<section className="panel operation-review-panel">
  <div className="panel-head">
    <div>
      <h3>{t("Operations supplemental reviews")}</h3>
      <p className="meta">{t("Append-only context that does not change the AI decision or workflow status.")}</p>
    </div>
    <span>{detailData.operationReviews.length}</span>
  </div>
  <div className="operation-review-list">
    {detailData.operationReviews.map((review) => (
      <article className="operation-review-card" key={review.id}>
        <div>
          <strong>{review.reviewerName}</strong>
          <span>{t("Round {round} submission", { round: review.submissionRound })}</span>
          <time>{new Date(review.createdAt).toLocaleString()}</time>
        </div>
        {review.focus && <em>{review.focus}</em>}
        <p>{review.comment}</p>
      </article>
    ))}
    {detailData.operationReviews.length === 0 && <p className="meta">{t("No operations reviews yet")}</p>}
  </div>
  {session.role === "运营" && (
    <form className="operation-review-form" onSubmit={submitOperationReview}>
      <label>{t("Review focus")}<input value={operationDraft.focus} onChange={(event) => setOperationDraft({ ...operationDraft, focus: event.target.value })} /></label>
      <label>{t("Supplemental review")}<textarea required value={operationDraft.comment} onChange={(event) => setOperationDraft({ ...operationDraft, comment: event.target.value })} /></label>
      <button className="primary" type="submit" disabled={operationBusy}>{operationBusy ? t("Submitting...") : t("Submit supplemental review")}</button>
    </form>
  )}
</section>
```

- [ ] **Step 5: Add localized copy and styling**

Add these entries to `uiCopy.zh`; `uiCopy.en` is derived automatically from the English keys. The existing shared role label already maps `运营` to `Operations`, so `src/shared/i18n.ts` does not change:

```ts
"Enter an operations supplemental review": "请输入运营补充评价",
"Operations review failed": "运营补充评价提交失败",
"Operations supplemental reviews": "运营补充评价",
"Append-only context that does not change the AI decision or workflow status.": "仅补充业务背景，不改变 AI 结论或流程状态。",
"No operations reviews yet": "暂无运营补充评价",
"Review focus": "评价重点",
"Supplemental review": "补充评价",
"Submit supplemental review": "提交补充评价",
```

In `src/styles.css`, use the already-defined theme variables and add a responsive form:

```css
.operation-review-panel { display: grid; gap: 16px; }
.operation-review-list { display: grid; gap: 10px; }
.operation-review-card { border: 1px solid var(--border); border-radius: 14px; padding: 14px; background: var(--surface-secondary); }
.operation-review-card > div { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.operation-review-card time, .operation-review-card span { color: var(--muted); font-size: 12px; }
.operation-review-card em { display: inline-flex; margin-top: 10px; }
.operation-review-card p { margin: 10px 0 0; white-space: pre-wrap; }
.operation-review-form { display: grid; grid-template-columns: minmax(180px, 0.4fr) minmax(280px, 1fr) auto; gap: 12px; align-items: end; }
.operation-review-form textarea { min-height: 96px; resize: vertical; }
@media (max-width: 900px) { .operation-review-form { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run frontend-focused checks**

```bash
npx tsc --noEmit
npx vitest run tests/session.test.ts tests/workflow-and-filters.test.ts --pool=forks --maxWorkers=1 --fileParallelism=false
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the operations UI**

```bash
git add src/main.tsx src/styles.css tests/session.test.ts tests/workflow-and-filters.test.ts
git commit -m "Add operations review interface"
```

---

### Task 5: Verify, Publish, Configure, and Test Production

**Files:**
- Verify only: all changed source and test files.
- External configuration: Vercel Production `REVIEW_ADMIN_ACCESS_CODE`.
- External verification: Supabase `public.emke_design_review_store`.

**Interfaces:**
- Consumes: completed commits from Tasks 1-4, Vercel project `emke-design-review`, Supabase project `ifabdsbhdlmjnhzsevpp`.
- Produces: pushed `main`, redeployed production, verified designer/operations/admin flows.

- [ ] **Step 1: Run the full local verification gate**

```bash
npm test -- --pool=forks --maxWorkers=1 --fileParallelism=false
npx tsc --noEmit
npm run build
npx -y react-doctor@latest . --verbose --scope changed
git diff --check --no-ext-diff
```

Expected: all 6 test files and every test pass, TypeScript/build/diff checks exit 0, and React Doctor does not regress below the existing 59/100 baseline. Existing unrelated React Doctor findings remain documented rather than mixed into this feature.

- [ ] **Step 2: Inspect commit scope and push main**

```bash
git status -sb
git log --oneline origin/main..HEAD
git push origin main
git rev-list --left-right --count HEAD...origin/main
```

Expected: only the known tool directories remain untracked; push succeeds; ahead/behind output is `0 0`.

- [ ] **Step 3: Configure the administrator code as a Vercel secret**

Run interactively so the value is not placed in shell history:

```bash
vercel env add REVIEW_ADMIN_ACCESS_CODE production --sensitive --force
```

Enter `emke666` at the value prompt. Then verify only metadata:

```bash
vercel env ls
```

Expected: `REVIEW_ADMIN_ACCESS_CODE` is listed as Encrypted/Sensitive for Production; its value is never printed.

- [ ] **Step 4: Redeploy production**

```bash
vercel redeploy https://emke-design-review.vercel.app --target production
```

Expected: deployment reports `Ready` and aliases `https://emke-design-review.vercel.app`.

- [ ] **Step 5: Run production API verification without printing tokens**

Use a Node one-liner that logs only status codes, booleans, and the non-secret verification task ID. It creates one uniquely named draft task for the browser check without calling Figma:

```bash
node -e 'const base="https://emke-design-review.vercel.app"; const health=await fetch(base+"/api/health").then(r=>r.json()); const login=async(role,accessCode,name)=>{const r=await fetch(base+"/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role,accessCode,name})});const body=await r.json();return {status:r.status,token:body.session?.token}}; const designer=await login("设计师","emke.de","Designer Verify"); const operations=await login("运营","emke.de","Ops Verify"); const admin=await login("管理员","emke666","Admin Verify"); const title=`OPS VERIFY ${Date.now()}`; const created=await fetch(base+"/api/reviews",{method:"POST",headers:{"authorization":`Bearer ${designer.token}`,"content-type":"application/json"},body:JSON.stringify({title,contentType:"官网 Banner",description:"Operations role production verification",figmaUrl:"https://www.figma.com/design/ops-verification/Verification"})}); const task=await created.json(); console.log({storageMode:health.storageMode,durableStorage:health.durableStorage,sessionReady:health.sessionReady,designer:designer.status,operations:operations.status,admin:admin.status,tokensCreated:Boolean(designer.token&&operations.token&&admin.token),taskCreate:created.status,taskId:task.id,title});'
```

Expected: Postgres/durable/session-ready are true, all three logins return 200, `tokensCreated` is true, and `taskCreate` is 200. Retain the printed verification title and task ID for Steps 6-7.

- [ ] **Step 6: Verify the browser workflow**

At `https://emke-design-review.vercel.app/`:

1. Log in as operations with `emke.de` and name `Ops Verify`.
2. Confirm the `OPS VERIFY ...` designer task from Step 5 is visible and “New review task” is absent.
3. Open that task, confirm management actions are absent, submit `Production verification <timestamp>` as a supplemental review, and refresh.
4. Log out and log in as designer `Designer Verify` with `emke.de`; confirm only that designer's verification task is listed, the review remains visible, and the form is absent.
5. Log out and log in as administrator with `emke666`; open the draft verification task and confirm administrator management actions, including Void, are available while the operations form is absent.
6. Void the verification task as administrator so it leaves the active queue; capture a screenshot and check browser console errors.

- [ ] **Step 7: Verify Supabase persistence and security**

Query through the existing secure Transaction Pooler connection without printing `DATABASE_URL`:

```sql
select
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', 'public.emke_design_review_store', 'select') as anon_select,
  has_table_privilege('authenticated', 'public.emke_design_review_store', 'select') as authenticated_select,
  jsonb_array_length(value->'operationReviews') as operation_review_count
from public.emke_design_review_store store
join pg_class c on c.relname = 'emke_design_review_store'
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where store.key = 'reviews';
```

Expected: `rls_enabled=true`, both privilege checks are false, and `operation_review_count` includes the production verification review.

- [ ] **Step 8: Report completion truthfully**

Report commit hashes, push target, deployment URL, test totals, browser flows, and the Free Supabase inactivity caveat. If administrator configuration, production deployment, or browser persistence verification fails, report that exact blocker instead of claiming completion.
