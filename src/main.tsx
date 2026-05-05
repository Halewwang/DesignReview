import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button as HeroButton,
  Card,
  Chip,
  Input,
  ListBox,
  Select,
  type Key,
} from "@heroui/react";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  UploadCloud,
} from "lucide-react";
import "./styles.css";
import { formatDeductionItem } from "./shared/aiDisplay";
import { encodeHeaderValue } from "./shared/headerEncoding";
import { filterIssues, filterTasks, IssueFilters, TaskFilters } from "./shared/filters";
import { scoreTone } from "./shared/scoreDisplay";

type Role = "设计师" | "运营" | "设计总监" | "管理员";
type ContentType = "电商页面" | "Amazon A+ 页面" | "官网 Banner";
type ReviewStatus =
  | "draft"
  | "figma_reading"
  | "frame_selection"
  | "ai_reviewing"
  | "needs_revision"
  | "resubmitted"
  | "approved"
  | "archived"
  | "figma_read_failed"
  | "ai_review_failed";

type Session = { accessCode: string; role: Role; name: string; userId?: string };
type Task = {
  id: string;
  title: string;
  contentType: ContentType;
  description: string;
  figmaUrl: string;
  status: ReviewStatus;
  priority: "普通" | "加急";
  submitterName: string;
  submitterId?: string;
  aiTotalScore?: number;
  finalDecision?: string;
  finalReason?: string;
  createdAt: string;
  updatedAt: string;
  submissionRound: number;
  frameCount?: number;
  issueCount?: number;
};
type Frame = {
  id: string;
  figmaNodeId: string;
  pageName: string;
  frameName: string;
  width: number;
  height: number;
  thumbnailUrl?: string;
  exportedImageUrl?: string;
  selected: boolean;
};
type Issue = {
  id: string;
  title: string;
  type: string;
  severity: string;
  frameName?: string;
  locationDescription?: string;
  description: string;
  suggestion: string;
  relatedStandardSection: string;
  mustFix: boolean;
  resolutionStatus: string;
  annotationSuggestion?: { type: "point" | "rect"; xPercent: number; yPercent: number; widthPercent?: number; heightPercent?: number };
};
type Detail = {
  task: Task;
  frames: Frame[];
  results: any[];
  issues: Issue[];
  rounds?: number[];
  logs: any[];
};

const aiRubric = [
  { key: "brand_consistency", label: "品牌一致性", maxScore: 30, definition: "品牌资产、色彩、字体、图片气质是否符合 EMKE warm-minimal 与理性可信赖定位。" },
  { key: "layout_standard", label: "排版规范", maxScore: 30, definition: "栅格、层级、留白、对齐和阅读路径是否稳定清晰。" },
  { key: "ecommerce_expression", label: "电商表达", maxScore: 25, definition: "产品、卖点、证明信息和 CTA 是否帮助用户快速决策。" },
  { key: "delivery_standard", label: "交付规范", maxScore: 15, definition: "尺寸、安全区、文案准确性、素材完整性和导出质量是否达标。" }
];
const passRule = "通过规则：总分 >= 85 且没有一票否决项。";

const statusLabel: Record<ReviewStatus, string> = {
  draft: "草稿",
  figma_reading: "读取 Figma 中",
  frame_selection: "待选择 Frame",
  ai_reviewing: "AI 初审中",
  needs_revision: "需修改",
  resubmitted: "已重新提交",
  approved: "已通过",
  archived: "已撤回",
  figma_read_failed: "Figma 读取失败",
  ai_review_failed: "AI 审核失败"
};
const defaultAccessCode = "emke.de";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem("emke-session");
    if (!raw) return null;
    const saved = JSON.parse(raw) as Session;
    if (saved.accessCode !== defaultAccessCode) {
      const migrated = { ...saved, accessCode: defaultAccessCode };
      localStorage.setItem("emke-session", JSON.stringify(migrated));
      return migrated;
    }
    return saved;
  });
  const [view, setView] = useState<"dashboard" | "new" | "frames" | "detail" | "vis" | "settings">("dashboard");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  if (!session) return <AccessScreen onEnter={setSession} />;
  return (
    <AppErrorBoundary resetKey={`${view}:${activeTaskId ?? ""}`} onDashboard={() => { setView("dashboard"); setActiveTaskId(null); }}>
      <Shell session={session} view={view} onView={setView}>
        {view === "dashboard" && <Dashboard session={session} onNew={() => setView("new")} onOpen={(id) => { setActiveTaskId(id); setView("detail"); }} />}
        {view === "new" && <NewTask session={session} onBack={() => setView("dashboard")} onFrames={(id) => { setActiveTaskId(id); setView("frames"); }} />}
        {view === "frames" && activeTaskId && <FrameSelection session={session} taskId={activeTaskId} onBack={() => setView("dashboard")} onDetail={() => setView("detail")} />}
        {view === "detail" && activeTaskId && <ReviewDetail session={session} taskId={activeTaskId} onFrames={() => setView("frames")} onDashboard={() => setView("dashboard")} />}
        {view === "vis" && <VisPage session={session} />}
        {view === "settings" && <SettingsPage session={session} />}
      </Shell>
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey: string; onDashboard: () => void }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "页面渲染失败" };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="workspace error-fallback">
        <section className="panel">
          <h2>页面显示失败</h2>
          <p className="meta">当前数据包含无法直接渲染的字段，系统已拦截黑屏。</p>
          <div className="error">{this.state.error}</div>
          <button className="primary" onClick={this.props.onDashboard}>返回工作台</button>
        </section>
      </main>
    );
  }
}

function AccessScreen({ onEnter }: { onEnter: (session: Session) => void }) {
  const [accessCode, setAccessCode] = useState(defaultAccessCode);
  const [role, setRole] = useState<Role>("设计师");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode }) });
    if (!response.ok) {
      setError((await response.json()).error ?? "访问失败");
      return;
    }
    const session = { accessCode, role, name: name || role, userId: name || role };
    localStorage.setItem("emke-session", JSON.stringify(session));
    onEnter(session);
  }

  return (
    <main className="access-page">
      <form className="access-card" onSubmit={submit}>
        <h1>EMKE DESIGN REVIEW</h1>
        <p>内部设计审核工作台。使用访问口令进入后，可创建任务、选择 Frame 并查看 AI 初审结果。</p>
        <label>访问口令<input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder={defaultAccessCode} required /></label>
        <label>当前身份<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option>设计师</option><option>管理员</option></select></label>
        <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} placeholder="用于操作记录" required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary access-submit" type="submit">进入工作台 <ChevronRight size={16} /></button>
      </form>
    </main>
  );
}

function Shell({ session, view, onView, children }: { session: Session; view: string; onView: (view: any) => void; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="sidebar-brand" onClick={() => onView("dashboard")}>
          <span className="brand-mark"><Gauge size={17} /></span>
          <span><strong>EMKE Review</strong><small>AI Design Audit</small></span>
        </button>
        <nav className="sidebar-nav">
          <span>Menu</span>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => onView("dashboard")}><Gauge size={15} /> 工作台</button>
          <button className={view === "vis" ? "active" : ""} onClick={() => onView("vis")}><FileText size={15} /> VIS 标准源</button>
        </nav>
        <div className="sidebar-footer">
          {session.role === "管理员" ? <button className={`sidebar-link ${view === "settings" ? "active" : ""}`} onClick={() => onView("settings")}><Settings size={15} /> 设置</button> : null}
          <div className="sidebar-user"><div className="avatar" title={`${session.role} ${session.name}`}>{avatarText(session.name)}</div><span><strong>{session.name}</strong><small>{session.role}</small></span></div>
        </div>
      </aside>
      <section className="app-main">
        {children}
      </section>
    </div>
  );
}

function Dashboard({ session, onNew, onOpen }: { session: Session; onNew: () => void; onOpen: (id: string) => void }) {
  const { data: tasks, error, reload, loading } = useApi<Task[]>("/api/reviews", session, []);
  const [filters, setFilters] = useState<TaskFilters>({ contentType: "", status: "", submitterId: "", keyword: "", onlyMine: false });
  const filteredTasks = useMemo(
    () => filterTasks(tasks, { ...filters, currentUserId: session.userId, currentUserName: session.name }),
    [tasks, filters, session.userId, session.name]
  );
  const groups = useMemo(() => ({
    total: tasks.length,
    revision: tasks.filter((task) => task.status === "needs_revision").length,
    approved: tasks.filter((task) => task.status === "approved").length,
    inProgress: tasks.filter((task) => ["draft", "figma_reading", "frame_selection", "ai_reviewing", "resubmitted"].includes(task.status)).length,
    failed: tasks.filter((task) => ["figma_read_failed", "ai_review_failed"].includes(task.status)).length,
    avgScore: Math.round(tasks.reduce((sum, task) => sum + (task.aiTotalScore ?? 0), 0) / Math.max(1, tasks.filter((task) => task.aiTotalScore).length))
  }), [tasks]);
  const lanes = [
    { key: "needs_revision", label: "AI 建议修改", tasks: filteredTasks.filter((task) => task.status === "needs_revision") },
    { key: "approved", label: "AI 通过", tasks: filteredTasks.filter((task) => task.status === "approved") },
    { key: "in_progress", label: "进行中", tasks: filteredTasks.filter((task) => ["draft", "figma_reading", "frame_selection", "ai_reviewing", "resubmitted"].includes(task.status)) },
    { key: "failed", label: "异常", tasks: filteredTasks.filter((task) => ["figma_read_failed", "ai_review_failed", "archived"].includes(task.status)) }
  ];

  return (
    <main className="workspace">
      <section className="hero-row dashboard-hero">
        <div>
          <h1>Hi,{session.name}</h1>
          <p>跟踪审核队列、AI 初审结果、修改风险和 VIS 标准源。</p>
        </div>
        <HeroButton variant="primary" className="hero-button" onPress={onNew}>
          <UploadCloud size={16} />
          新建审核任务
        </HeroButton>
      </section>
      <section className="metrics-board">
        <Metric label="全部任务" value={groups.total} accent="+ live" tone="live" />
        <Metric label="AI 建议修改" value={groups.revision} accent="- return" tone="revision" />
        <Metric label="AI 已通过" value={groups.approved} accent="+ pass" tone="success" />
        <Metric label="审核进行中" value={groups.inProgress} accent="+ queue" tone="queue" />
        <Metric label="异常任务" value={groups.failed} accent="!" tone="danger" />
        <Metric label="平均 AI 分" value={Number.isFinite(groups.avgScore) ? groups.avgScore : 0} accent="/100" tone="score" />
      </section>
      <section className="dashboard-grid">
        <div className="queue-tools">
          <h2>Review Queue</h2>
          <HeroButton variant="secondary" className="hero-button subtle" onPress={reload}><RefreshCw size={15} />刷新</HeroButton>
        </div>
        {error && <div className="error">{error}</div>}
        <TaskFilterBar filters={filters} onChange={setFilters} />
        <div className="queue-board">
          {loading && <Card className="hero-panel"><Card.Content>读取任务中...</Card.Content></Card>}
          {lanes.map((lane) => (
            <Card className="queue-lane" key={lane.key}>
              <Card.Content className="queue-lane-body">
                <div className="lane-head"><h3>{lane.label}</h3><Chip size="sm" color="accent" variant="soft">{lane.tasks.length}</Chip></div>
                {lane.tasks.map((task) => <TaskCard task={task} onOpen={onOpen} key={task.id} />)}
                {lane.tasks.length === 0 && <div className="lane-empty">暂无</div>}
              </Card.Content>
            </Card>
          ))}
          <Card className="queue-lane wide">
            <Card.Content className="queue-lane-body">
              <div className="lane-head"><h3>筛选结果</h3><Chip size="sm" color="accent" variant="soft">{filteredTasks.length}</Chip></div>
              {filteredTasks.slice(0, 8).map((task) => <TaskCard task={task} onOpen={onOpen} key={task.id} compact />)}
              {!loading && filteredTasks.length === 0 && tasks.length > 0 && <div className="lane-empty">当前筛选条件下暂无任务</div>}
            </Card.Content>
          </Card>
          {!loading && tasks.length === 0 && <div className="empty">暂无审核任务。先新建任务并读取 Figma。</div>}
        </div>
      </section>
    </main>
  );
}

function TaskFilterBar({ filters, onChange }: { filters: TaskFilters; onChange: (filters: TaskFilters) => void }) {
  const selectedContentType = filters.contentType || "all";
  const selectedStatus = filters.status || "all";
  const nextKey = (value: Key | Key[] | null) => Array.isArray(value) ? value[0] : value;
  return (
    <Card className="filter-bar hero-filter-bar">
      <Card.Content className="task-card-body">
        <Input
          aria-label="搜索任务"
          placeholder="搜索任务名 / Figma 文件 / 提交人"
          value={filters.keyword ?? ""}
          onChange={(event) => onChange({ ...filters, keyword: event.target.value })}
          variant="secondary"
        />
        <Select
          aria-label="内容类型"
          value={selectedContentType}
          onChange={(value) => {
            const key = nextKey(value);
            onChange({ ...filters, contentType: key === "all" || key == null ? "" : String(key) });
          }}
          variant="secondary"
        >
          <Select.Trigger><Select.Value /></Select.Trigger>
          <Select.Popover><ListBox>
            <ListBox.Item id="all" textValue="全部类型">全部类型</ListBox.Item>
            <ListBox.Item id="电商页面" textValue="电商页面">电商页面</ListBox.Item>
            <ListBox.Item id="Amazon A+ 页面" textValue="Amazon A+ 页面">Amazon A+ 页面</ListBox.Item>
            <ListBox.Item id="官网 Banner" textValue="官网 Banner">官网 Banner</ListBox.Item>
          </ListBox></Select.Popover>
        </Select>
        <Select
          aria-label="任务状态"
          value={selectedStatus}
          onChange={(value) => {
            const key = nextKey(value);
            onChange({ ...filters, status: key === "all" || key == null ? "" : String(key) });
          }}
          variant="secondary"
        >
          <Select.Trigger><Select.Value /></Select.Trigger>
          <Select.Popover><ListBox>
            <ListBox.Item id="all" textValue="全部状态">全部状态</ListBox.Item>
            <ListBox.Item id="needs_revision" textValue="需修改">需修改</ListBox.Item>
            <ListBox.Item id="approved" textValue="已通过">已通过</ListBox.Item>
            <ListBox.Item id="frame_selection" textValue="待选择 Frame">待选择 Frame</ListBox.Item>
            <ListBox.Item id="ai_reviewing" textValue="AI 审核中">AI 审核中</ListBox.Item>
            <ListBox.Item id="failed" textValue="失败">失败</ListBox.Item>
          </ListBox></Select.Popover>
        </Select>
        <Input
          aria-label="提交人 ID"
          placeholder="提交人 ID"
          value={filters.submitterId ?? ""}
          onChange={(event) => onChange({ ...filters, submitterId: event.target.value })}
          variant="secondary"
        />
        <HeroButton variant="secondary" className="hero-button subtle" onPress={() => onChange({ ...filters, contentType: "", status: "", submitterId: "", keyword: "" })}>重置</HeroButton>
      </Card.Content>
    </Card>
  );
}

function TaskCard({ task, onOpen, compact = false }: { task: Task; onOpen: (id: string) => void; compact?: boolean }) {
  return (
    <Card className={`task-card ${compact ? "compact" : ""}`} role="button" tabIndex={0} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(task.id); }}>
      <Card.Content className="task-card-body">
        <div className="task-info">
          <div className="task-title">{task.title}</div>
          <div className="meta">{task.contentType} · {task.submitterName}{task.submitterId ? ` #${task.submitterId}` : ""}</div>
        </div>
        <div className="task-stats">
          <span className="round-mini">{task.submissionRound}</span>
          <Chip size="sm" variant="soft" className={`status ${task.status}`}>{statusLabel[task.status]}</Chip>
          <span className="score-chip">{task.aiTotalScore ?? "--"}</span>
          <span>{task.issueCount ?? 0} issues</span>
        </div>
      </Card.Content>
    </Card>
  );
}

function NewTask({ session, onBack, onFrames }: { session: Session; onBack: () => void; onFrames: (id: string) => void }) {
  const [form, setForm] = useState({ title: "", contentType: "官网 Banner" as ContentType, description: "", figmaUrl: "", priority: "普通", submitterId: session.userId ?? session.name });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    let createdTaskId = "";
    try {
      const task = await api<Task>("/api/reviews", session, { method: "POST", body: form });
      createdTaskId = task.id;
      await api(`/api/reviews/${task.id}/read-figma`, session, { method: "POST" });
      onFrames(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      if (createdTaskId) onFrames(createdTaskId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace narrow task-workspace">
      <div className="task-page-top">
        <div className="task-page-title">
          <div className="eyebrow">NEW REVIEW</div>
          <h2>新建审核任务</h2>
        </div>
        <button className="ghost" onClick={onBack}><ArrowLeft size={15} /> 返回</button>
      </div>
      <form className="panel form-panel" onSubmit={submit}>
        <label>任务名称<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：母亲节官网 Banner 审核" required /></label>
        <fieldset className="choice-field">
          <legend>内容类型</legend>
          <div className="choice-group">
            {(["电商页面", "Amazon A+ 页面", "官网 Banner"] as ContentType[]).map((contentType) => (
              <button type="button" className={form.contentType === contentType ? "active" : ""} key={contentType} onClick={() => setForm({ ...form, contentType })}>{contentType}</button>
            ))}
          </div>
        </fieldset>
        <label>项目说明<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="使用场景、投放渠道、重点产品卖点" /></label>
        <label>Figma 项目链接<input value={form.figmaUrl} onChange={(event) => setForm({ ...form, figmaUrl: event.target.value })} placeholder="https://www.figma.com/design/..." required /></label>
        <label>提交人 ID<input value={form.submitterId} onChange={(event) => setForm({ ...form, submitterId: event.target.value })} placeholder="用于追踪提交人，例如 EMKE-Hale" /></label>
        <fieldset className="choice-field compact">
          <legend>优先级</legend>
          <div className="choice-group">
            {["普通", "加急"].map((priority) => (
              <button type="button" className={form.priority === priority ? "active" : ""} key={priority} onClick={() => setForm({ ...form, priority })}>{priority}</button>
            ))}
          </div>
        </fieldset>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "读取 Figma 中..." : "读取 Figma"} <ChevronRight size={16} /></button>
      </form>
    </main>
  );
}

function FrameSelection({ session, taskId, onBack, onDetail }: { session: Session; taskId: string; onBack: () => void; onDetail: () => void }) {
  const { data, error, reload } = useApi<Detail>(`/api/reviews/${taskId}`, session, null as any);
  const { data: health } = useApi<any>("/api/health", session, null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const frames = data?.frames ?? [];
  const pages = [...new Set(frames.map((frame) => frame.pageName))];
  const maxFrames = Number(health?.maxFramesPerTask ?? 12);

  useEffect(() => setSelected(new Set(frames.filter((frame) => frame.selected).map((frame) => frame.id))), [frames.length]);

  async function startAiReview() {
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/reviews/${taskId}/select-frames`, session, { method: "POST", body: { frameIds: [...selected] } });
      await api(`/api/reviews/${taskId}/start-ai-review`, session, { method: "POST" });
      onDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "AI 初审失败");
    } finally {
      setBusy(false);
    }
  }

  async function readFigmaAgain() {
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/reviews/${taskId}/read-figma`, session, { method: "POST" });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "读取 Figma 失败");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function togglePage(page: string) {
    const pageIds = frames.filter((frame) => frame.pageName === page).map((frame) => frame.id);
    const allSelected = pageIds.every((id) => selected.has(id));
    const next = new Set(selected);
    pageIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
    setSelected(next);
  }

  return (
    <main className="workspace">
      <div className="page-head">
        <button className="ghost" onClick={onBack}><ArrowLeft size={15} /> 返回</button>
        <div><h2>选择需要审核的 Frame</h2><p>只导出手动选择的顶层 Frame，单次最多 {maxFrames} 个。已选 {selected.size}/{maxFrames}。</p></div>
        <button className="primary" disabled={busy || selected.size === 0 || selected.size > maxFrames} onClick={startAiReview}>{busy ? "处理中..." : `开始 AI 初审 (${selected.size})`} <Sparkles size={16} /></button>
      </div>
      {selected.size > maxFrames && <div className="error">当前选择超过单次上限，请减少到 {maxFrames} 个 Frame 以内。</div>}
      {(error || actionError) && <div className="error">{error || actionError}</div>}
      {pages.map((page) => (
        <section key={page} className="frame-section">
          <div className="section-bar"><h3>{page}</h3><button className="ghost" onClick={() => togglePage(page)}>{frames.filter((frame) => frame.pageName === page).every((frame) => selected.has(frame.id)) ? "取消当前 Page" : "全选当前 Page"}</button></div>
          <div className="frame-grid">
            {frames.filter((frame) => frame.pageName === page).map((frame) => (
              <button className={`frame-card ${selected.has(frame.id) ? "selected" : ""}`} key={frame.id} onClick={() => toggle(frame.id)}>
                <div className="thumb">{frame.thumbnailUrl ? <img src={frame.thumbnailUrl} alt={frame.frameName} /> : <><ImageIcon /><span>暂无缩略图</span></>}</div>
                <div className="frame-name">{frame.frameName}</div>
                <div className="meta">{frame.width} x {frame.height} · {frame.figmaNodeId}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
      {frames.length === 0 && <div className="empty">{data?.task?.status === "figma_read_failed" ? <button className="primary" onClick={readFigmaAgain} disabled={busy}>重新读取 Figma</button> : <button className="primary" onClick={reload}>重新读取任务</button>}</div>}
    </main>
  );
}

function ReviewDetail({ session, taskId, onFrames, onDashboard }: { session: Session; taskId: string; onFrames: () => void; onDashboard: () => void }) {
  const { data, error: loadError, reload } = useApi<Detail>(`/api/reviews/${taskId}`, session, null as any);
  const [activeFrameId, setActiveFrameId] = useState("");
  const [zoom, setZoom] = useState(100);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState({ title: "", submitterId: "" });
  const [selectedRound, setSelectedRound] = useState<number | "latest">("latest");
  const [issueFilters, setIssueFilters] = useState<IssueFilters>({ frameName: "", type: "", severity: "", resolutionStatus: "", mustFixOnly: false });
  const [activeIssueId, setActiveIssueId] = useState("");
  const [error, setError] = useState("");
  const frames = data?.frames.filter((frame) => frame.selected || frame.exportedImageUrl) ?? [];
  const activeFrame = frames.find((frame) => frame.id === activeFrameId) ?? frames[0];
  const rounds = data?.rounds?.length ? data.rounds : data?.results.map((result) => result.submissionRound) ?? [];
  const latestRound = rounds.length ? Math.max(...rounds) : data?.task.submissionRound ?? 1;
  const currentRound = selectedRound === "latest" ? latestRound : selectedRound;
  const result = data?.results.filter((item) => item.submissionRound === currentRound).at(-1) ?? data?.results.at(-1);
  const issues = (data?.issues ?? []).filter((issue: any) => (issue.submissionRound ?? data?.task.submissionRound ?? 1) === currentRound);
  const filteredIssues = filterIssues(issues, issueFilters);
  const visibleAnnotatedIssues = filteredIssues.filter((issue) => issue.annotationSuggestion && (!issue.frameName || !activeFrame?.frameName || issue.frameName === activeFrame.frameName));
  const annotationIndexByIssueId = new Map(visibleAnnotatedIssues.map((issue, index) => [issue.id, index + 1]));

  useEffect(() => {
    if (data?.task) setMetaDraft({ title: data.task.title, submitterId: data.task.submitterId ?? "" });
  }, [data?.task?.id, data?.task?.title, data?.task?.submitterId]);

  async function resubmit() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}/resubmit`, session, { method: "POST", body: {} });
      onFrames();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新提交失败");
    }
  }

  async function retryReadFigma() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}/read-figma`, session, { method: "POST" });
      onFrames();
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Figma 失败");
    }
  }

  async function retryAiReview() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}/start-ai-review`, session, { method: "POST" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新 AI 初审失败");
    }
  }

  async function saveMeta() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}`, session, { method: "PATCH", body: metaDraft });
      setEditingMeta(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function withdrawTask() {
    if (!window.confirm("确认撤回这个审核任务？撤回后会保留记录，但不再进入审核队列。")) return;
    setError("");
    try {
      await api(`/api/reviews/${taskId}/withdraw`, session, { method: "POST" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回失败");
    }
  }

  async function deleteTask() {
    if (!window.confirm("确认删除这个审核任务？相关 Frame、结果和问题记录会一起删除。")) return;
    setError("");
    try {
      await api(`/api/reviews/${taskId}`, session, { method: "DELETE" });
      onDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (!data) return <main className="workspace"><div className="panel">读取审核详情...</div></main>;
  const canWithdraw = ["frame_selection", "needs_revision", "resubmitted", "figma_read_failed", "ai_review_failed"].includes(data.task.status);
  const canDelete = ["draft", "frame_selection", "needs_revision", "resubmitted", "approved", "archived", "figma_read_failed", "ai_review_failed"].includes(data.task.status);

  return (
    <main className="workspace detail">
      <section className="detail-head">
        <div className="detail-title-block">
          {editingMeta ? (
            <div className="meta-editor">
              <input value={metaDraft.title} onChange={(event) => setMetaDraft({ ...metaDraft, title: event.target.value })} />
              <input value={metaDraft.submitterId} onChange={(event) => setMetaDraft({ ...metaDraft, submitterId: event.target.value })} placeholder="提交人 ID" />
            </div>
          ) : (
            <>
              <h2>{data.task.title}</h2>
              <div className="detail-meta-grid">
                <span className="round-badge">第 {data.task.submissionRound} 轮提交</span>
                <span>{data.task.description || "无项目说明"}</span>
                <span>提交人：{data.task.submitterName}{data.task.submitterId ? ` · ID ${data.task.submitterId}` : ""}</span>
              </div>
            </>
          )}
        </div>
        <div className="detail-tag-block">
          <span className="round-badge">{data.task.contentType}</span>
          <span>第 {data.task.submissionRound} 轮提交</span>
          <span>{data.task.description || "无项目说明"}</span>
          <span>提交人：{data.task.submitterName}{data.task.submitterId ? ` · ID ${data.task.submitterId}` : ""}</span>
        </div>
      </section>
      {(loadError || error) && <div className="error">{loadError || error}</div>}
      <section className="review-layout">
        <div className="preview-panel">
          <div className="preview-toolbar">
            <div className="frame-tabs">{frames.map((frame) => <button className={activeFrame?.id === frame.id ? "active" : ""} onClick={() => setActiveFrameId(frame.id)} key={frame.id}>{frame.frameName}</button>)}</div>
            <div className="preview-action-row head-actions">
              {editingMeta ? <button className="action-button primary-action" onClick={saveMeta}>保存</button> : <button className="action-button icon-only" onClick={() => setEditingMeta(true)} aria-label="编辑名称 / ID" title="编辑名称 / ID"><Settings size={15} /></button>}
              {data.task.status === "needs_revision" && <button className="primary" onClick={resubmit}><RefreshCw size={15} /> 重新提交</button>}
              {data.task.status === "figma_read_failed" && <button className="primary" onClick={retryReadFigma}><RefreshCw size={15} /> 重新读取 Figma</button>}
              {data.task.status === "ai_review_failed" && <button className="primary" onClick={retryAiReview}><Sparkles size={15} /> 重新 AI 初审</button>}
              {canWithdraw && <button className="action-button icon-only" onClick={withdrawTask} aria-label="撤回" title="撤回"><Undo2 size={15} /></button>}
              {canDelete && <button className="danger compact icon-only" onClick={deleteTask} aria-label="删除" title="删除"><Trash2 size={15} /></button>}
              <button className="action-button icon-only" onClick={reload} aria-label="刷新" title="刷新"><RefreshCw size={15} /></button>
            </div>
            <div className="zoom-controls">
              <button onClick={() => setZoom(Math.max(50, zoom - 10))} title="缩小"><Minus size={15} /></button>
              <input aria-label="缩放比例" type="range" min="50" max="220" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <button onClick={() => setZoom(Math.min(220, zoom + 10))} title="放大"><Plus size={15} /></button>
              <button className="zoom-reset" onClick={() => setZoom(100)} title="恢复 100%"><Maximize2 size={15} /><span>{zoom}%</span></button>
            </div>
          </div>
          <div className="image-stage">
            <div className="zoom-canvas" style={{ transform: `scale(${zoom / 100})` }}>
              {activeFrame?.exportedImageUrl || activeFrame?.thumbnailUrl ? <img src={activeFrame.exportedImageUrl || activeFrame.thumbnailUrl} alt={activeFrame.frameName} /> : <div className="empty">暂无导出图</div>}
              {visibleAnnotatedIssues.map((issue, index) => <AnnotationBox key={issue.id} issue={issue} index={index + 1} active={issue.id === activeIssueId} onFocus={() => setActiveIssueId(issue.id)} />)}
            </div>
          </div>
        </div>
        <aside className="review-sidebar">
          <ScorePanel result={result} status={data.task.status} />
          <section className="panel review-list-panel">
            <div className="panel-head"><h3>问题清单</h3><span>{filteredIssues.length}/{issues.length}</span></div>
            <IssueFilterBar filters={issueFilters} onChange={setIssueFilters} frames={frames} rounds={rounds} selectedRound={selectedRound} onRoundChange={setSelectedRound} />
            <div className="review-list-scroll">
              {filteredIssues.map((issue, index) => <IssueCard issue={issue} index={index + 1} annotationIndex={annotationIndexByIssueId.get(issue.id)} active={issue.id === activeIssueId} onFocus={() => setActiveIssueId(issue.id)} key={issue.id} />)}
              {issues.length === 0 && <p className="meta">暂无问题记录。</p>}
              {issues.length > 0 && filteredIssues.length === 0 && <div className="lane-empty">当前筛选条件下暂无问题</div>}
              <div className="log-stack">
                <h3>提交记录</h3>
                {data.logs.map((log) => <div className="log" key={log.id}>{log.action}<span>{new Date(log.createdAt).toLocaleString()}</span></div>)}
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function IssueFilterBar({
  filters,
  onChange,
  frames,
  rounds,
  selectedRound,
  onRoundChange
}: {
  filters: IssueFilters;
  onChange: (filters: IssueFilters) => void;
  frames: Frame[];
  rounds: number[];
  selectedRound: number | "latest";
  onRoundChange: (round: number | "latest") => void;
}) {
  return (
    <section className="issue-filter-bar">
      <select value={selectedRound} onChange={(event) => onRoundChange(event.target.value === "latest" ? "latest" : Number(event.target.value))}>
        <option value="latest">最新轮次</option>
        {rounds.map((round) => <option value={round} key={round}>第 {round} 轮</option>)}
      </select>
      <select value={filters.frameName ?? ""} onChange={(event) => onChange({ ...filters, frameName: event.target.value })}>
        <option value="">全部 Frame</option>
        {frames.map((frame) => <option value={frame.frameName} key={frame.id}>{frame.frameName}</option>)}
      </select>
      <select value={filters.type ?? ""} onChange={(event) => onChange({ ...filters, type: event.target.value })}>
        <option value="">全部类型</option>
        <option>品牌一致性</option>
        <option>排版规范</option>
        <option>电商表达</option>
        <option>交付规范</option>
      </select>
      <select value={filters.severity ?? ""} onChange={(event) => onChange({ ...filters, severity: event.target.value })}>
        <option value="">全部严重度</option>
        <option>严重</option>
        <option>中等</option>
        <option>轻微</option>
        <option>建议</option>
      </select>
      <div className="filter-note">这些选项只用于查看问题，不需要人工勾选完成。</div>
      <div className="segmented">
        <button className={!filters.mustFixOnly ? "active" : ""} onClick={() => onChange({ ...filters, mustFixOnly: false })}>全部问题</button>
        <button className={filters.mustFixOnly ? "active" : ""} onClick={() => onChange({ ...filters, mustFixOnly: true })}>必须修改</button>
      </div>
    </section>
  );
}

function ScorePanel({ result, status }: { result: any; status?: ReviewStatus }) {
  if (!result) return <section className="panel"><h3>AI 初审</h3><p className="meta">尚无 AI 结果。</p></section>;
  const scores = result.dimensionScores;
  const vetoIssues = result.rawAiResponse?.veto_issues ?? [];
  return (
    <section className="score-panel">
      <div className="score-hero">
        <div className="score-title">
          <span>AI 初审总分</span>
          <em>{result.conclusion}</em>
        </div>
        {status ? <span className={`status ${status}`}>{statusLabel[status]}</span> : null}
        <strong className={`score-value score-value--${scoreTone(result.totalScore)}`}>{result.totalScore}</strong>
      </div>
      <p className="rubric-note">{passRule}</p>
      <div className="dimension-grid">
        {Object.entries(scores).map(([key, value]: any) => {
          const rubric = aiRubric.find((item) => item.key === key);
          return <div className="score-line" key={key}><span>{rubric?.label ?? scoreName(key)}</span><b>{value.score}/{value.max_score}</b><p>{rubric?.definition}</p><p>{value.comment}</p>{value.deduction_items?.length ? <ul>{value.deduction_items.map((item: unknown, index: number) => <li key={`${key}-${index}`}>{formatDeductionItem(item)}</li>)}</ul> : <em>无明确扣分项</em>}</div>;
        })}
      </div>
      <div className={`veto-strip ${vetoIssues.length ? "risk" : ""}`}>{vetoIssues.length ? `一票否决风险 ${vetoIssues.length} 项` : "未发现一票否决风险"}</div>
    </section>
  );
}

function IssueCard({ issue, index, annotationIndex, active, onFocus }: { issue: Issue; index: number; annotationIndex?: number; active?: boolean; onFocus?: () => void }) {
  return (
    <article className={`issue ${issue.mustFix ? "must" : ""} ${active ? "active" : ""}`} onMouseEnter={onFocus} onFocus={onFocus} onClick={onFocus} tabIndex={0}>
      <div className="issue-top">
        <span className="issue-index">{index}</span>
        <strong>{issue.title}</strong>
        <span className={`severity ${issue.severity}`}>{issue.severity}</span>
      </div>
      <div className="issue-tags"><span>{issue.type}</span>{issue.mustFix ? <span>AI 判定必须修改</span> : <span>AI 建议优化</span>}{annotationIndex ? <span className="annotation-link">画面标注 #{annotationIndex}</span> : <span>未生成画面标注</span>}</div>
      <dl>
        <dt>位置</dt><dd>{annotationIndex ? `见画面标注 #${annotationIndex}` : (issue.frameName || "--")} · {issue.locationDescription || "未指定区域"}</dd>
        <dt>判断</dt><dd>{issue.description}</dd>
        <dt>修改建议</dt><dd>{issue.suggestion}</dd>
        <dt>依据</dt><dd>{issue.relatedStandardSection}</dd>
      </dl>
    </article>
  );
}

function AnnotationBox({ issue, index, active, onFocus }: { issue: Issue; index: number; active?: boolean; onFocus?: () => void }) {
  const a = issue.annotationSuggestion!;
  return <button title={issue.title} className={`annotation ${issue.severity} ${active ? "active" : ""}`} onMouseEnter={onFocus} onFocus={onFocus} style={{ left: `${a.xPercent}%`, top: `${a.yPercent}%`, width: `${a.widthPercent ?? 4}%`, height: `${a.heightPercent ?? 4}%` }}>{index}</button>;
}

function VisPage({ session }: { session: Session }) {
  const { data, error, reload } = useApi<any>("/api/vis/current", session, null);
  const [draft, setDraft] = useState("");
  const [fileName, setFileName] = useState("brand-standard.md");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (data?.content) {
      setDraft(data.content);
      setFileName(data.fileName ?? "brand-standard.md");
    }
  }, [data?.path]);

  async function pickFile(file?: File) {
    if (!file) return;
    setFileName(file.name);
    setDraft(await file.text());
  }

  async function upload() {
    setBusy(true);
    setActionError("");
    try {
      await api("/api/vis/current", session, { method: "POST", body: { fileName, content: draft } });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace">
      <section className="panel vis-source-panel">
        <div>
          <div className="eyebrow">STANDARD SOURCE</div>
          <h2>{data?.fileName ?? "品牌设计规范.md"}</h2>
          <p>AI 初审会把这里的 Markdown 章节作为唯一 VIS 标准源发送给视觉模型，并要求模型逐条理解、引用和应用。</p>
          <div className="source-meta"><span>{data?.path ?? "未加载路径"}</span><span>{data?.sections?.length ?? 0} sections</span></div>
        </div>
        <div className="upload-box">
          <label className="file-picker">上传 Markdown 文件<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(event) => pickFile(event.target.files?.[0])} /></label>
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="文件名" />
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="# EMKE VIS Standard..." />
          {(error || actionError) && <div className="error">{error || actionError}</div>}
          <button className="primary" disabled={busy || !draft.trim()} onClick={upload}>{busy ? "上传中..." : "保存并应用 VIS 标准源"} <UploadCloud size={15} /></button>
        </div>
      </section>
      <div className="section-list compact-sections">{data?.sections?.map((section: any) => <article className="panel standard-card" key={section.id}><div className="eyebrow">{section.ruleType}</div><h3>{section.title}</h3>{section.content ? <p>{compactPreview(section.content)}</p> : <span className="meta">仅标题章节</span>}</article>)}</div>
    </main>
  );
}

function SettingsPage({ session }: { session: Session }) {
  const { data, error, reload } = useApi<any>("/api/settings", session, null);
  const [form, setForm] = useState({ providerName: "Derouter", baseURL: "https://api.derouter.ai/openai/v1", model: "claude-sonnet-4-6", apiKey: "" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (data?.aiProvider) {
      setForm({
        providerName: data.aiProvider.providerName ?? "Derouter",
        baseURL: data.aiProvider.baseURL ?? "https://api.derouter.ai/openai/v1",
        model: data.aiProvider.model ?? "claude-sonnet-4-6",
        apiKey: ""
      });
    }
  }, [data?.aiProvider?.baseURL, data?.aiProvider?.model]);

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await api("/api/settings/ai-config", session, { method: "POST", body: form });
      setForm({ ...form, apiKey: "" });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace narrow settings-page">
      <header className="settings-page-head">
        <div className="eyebrow">SERVER CONFIG</div>
        <h2>系统设置</h2>
      </header>
      <div className="settings-workspace">
      <section className="panel form-panel settings-panel">
        <div className="eyebrow">SERVER CONFIG</div>
        {(error || actionError) && <div className="error">{error || actionError}</div>}
        <Setting label="Figma Token" value={data?.figmaTokenConfigured ? "已配置" : "未配置 FIGMA_TOKEN"} />
        <Setting label="AI API Key" value={data?.aiProvider?.configured ? `已配置 ${data?.aiProvider?.keyPreview ?? ""}` : "未配置 Key，本地使用占位审核"} />
        <Setting label="当前来源" value={data?.aiProvider?.source === "env" ? "环境变量" : data?.aiProvider?.source === "runtime" ? "运行时配置" : "系统预设"} />
        <Setting label="最大 Frame 数" value={data?.maxFramesPerTask} />
        <Setting label="VIS 标准源路径" value={data?.brandStandardPath} />
      </section>
      <form className="panel form-panel settings-panel ai-config-form" onSubmit={saveConfig}>
        <div className="panel-head"><h3><KeyRound size={15} /> AI 模型接口</h3><span>{data?.aiProvider?.model ?? "--"}</span></div>
        <label>Provider 名称<input value={form.providerName} onChange={(event) => setForm({ ...form, providerName: event.target.value })} /></label>
        <label>Base URL<input value={form.baseURL} onChange={(event) => setForm({ ...form, baseURL: event.target.value })} /></label>
        <label>模型<input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></label>
        <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="输入新 Key 后保存；不会在前端回显完整 Key" /></label>
        <button className="primary" disabled={busy}>{busy ? "保存中..." : "保存 AI 配置"}</button>
      </form>
      </div>
    </main>
  );
}

function Metric({ label, value, accent, tone = "live" }: { label: string; value: number; accent?: string; tone?: "live" | "revision" | "success" | "queue" | "danger" | "score" }) {
  return (
    <Card className={`metric metric--${tone}`}>
      <Card.Content className="metric-body">
        <div className="metric-head"><span>{label}</span>{accent ? <em>{accent}</em> : null}</div>
        <strong>{value}</strong>
      </Card.Content>
    </Card>
  );
}

function Setting({ label, value }: { label: string; value: any }) {
  return <div className="setting"><span>{label}</span><strong>{value ?? "--"}</strong></div>;
}

function scoreName(key: string) {
  return ({ brand_consistency: "品牌一致性", layout_standard: "排版规范", ecommerce_expression: "电商表达", delivery_standard: "交付规范" } as Record<string, string>)[key] ?? key;
}

function avatarText(name: string) {
  return (name || "U").trim().slice(0, 1).toUpperCase();
}

function compactPreview(content: string) {
  return content
    .replace(/[#>*_`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 132);
}

async function api<T>(url: string, session: Session, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": encodeHeaderValue(session.accessCode),
      "x-actor-name": encodeHeaderValue(session.name),
      "x-actor-role": encodeHeaderValue(session.role),
      "x-actor-id": encodeHeaderValue(session.userId ?? session.name)
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "请求失败");
  return json;
}

function useApi<T>(url: string, session: Session, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api<T>(url, session));
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, [url]);
  return { data, loading, error, reload };
}

createRoot(document.getElementById("root")!).render(<App />);
