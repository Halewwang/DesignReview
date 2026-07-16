import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Gauge from "lucide-react/dist/esm/icons/gauge.mjs";
import ImageIcon from "lucide-react/dist/esm/icons/image.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2.mjs";
import Minus from "lucide-react/dist/esm/icons/minus.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import Undo2 from "lucide-react/dist/esm/icons/undo-2.mjs";
import UploadCloud from "lucide-react/dist/esm/icons/upload-cloud.mjs";
import "./styles.css";
import { formatDeductionItem } from "./shared/aiDisplay";
import { encodeHeaderValue } from "./shared/headerEncoding";
import { defaultTaskFilters, filterIssues, filterTasks, IssueFilters, TaskFilters } from "./shared/filters";
import { dashboardCommandCenter, normalizeStoredReviewNavigation, reviewTimeline, selectReviewRoundData, type ReviewAppView, type ReviewTimelineStageState } from "./shared/reviewFlow";
import { scoreTone } from "./shared/scoreDisplay";
import { detectPreferredLanguage, hasHanText, languageLabel, localizeDynamicText, type Language } from "./shared/i18n";
import { localizedArrayItem, reviewText } from "./shared/localizedReviewText";
import { accessCodeForRoleSelection, normalizeStoredSession, type StoredSession } from "./shared/session";
import { validateImageFiles } from "./shared/uploads";

type Role = "设计师" | "管理员";
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
  | "withdrawn"
  | "voided"
  | "figma_read_failed"
  | "ai_review_failed";

type Session = StoredSession;
type Task = {
  id: string;
  title: string;
  contentType: ContentType;
  description: string;
  figmaUrl?: string;
  source?: "figma" | "upload";
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
  submissionRound?: number;
  title: string;
  type: string;
  severity: string;
  frameName?: string;
  locationDescription?: string;
  description: string;
  suggestion: string;
  relatedStandardSection: string;
  i18n?: {
    title?: LocalizedText;
    locationDescription?: LocalizedText;
    description?: LocalizedText;
    suggestion?: LocalizedText;
    relatedStandardSection?: LocalizedText;
  };
  mustFix: boolean;
  resolutionStatus: string;
  annotationSuggestion?: { type: "point" | "rect"; xPercent: number; yPercent: number; widthPercent?: number; heightPercent?: number };
};
type LocalizedText = { zh?: string; en?: string };
type Detail = {
  task: Task;
  frames: Frame[];
  results: any[];
  issues: Issue[];
  rounds?: number[];
  logs: any[];
  job?: ReviewJob;
};
type ReviewJob = {
  id: string;
  taskId: string;
  submissionRound: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: "queued" | "preparing" | "exporting" | "analyzing" | "reporting" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  updatedAt: string;
  leaseExpiresAt?: string;
  error?: string;
};
type UploadedImageDraft = { id: string; fileName: string; mimeType: string; dataUrl: string; size: number };

const aiRubric = [
  { key: "brand_consistency", label: "品牌一致性", maxScore: 25, definition: "品牌资产、色彩、字体、图片气质是否符合 EMKE VIS 中的 warm-minimal 与理性可信赖定位。" },
  { key: "layout_standard", label: "排版规范", maxScore: 25, definition: "栅格、层级、留白、对齐和阅读路径是否在 VIS 规范下稳定清晰。" },
  { key: "ecommerce_expression", label: "电商表达", maxScore: 25, definition: "产品、卖点、证明信息和 CTA 是否帮助用户快速决策。" },
  { key: "delivery_standard", label: "交付规范", maxScore: 15, definition: "尺寸、安全区、文案准确性、素材完整性和导出质量是否达标。" },
  { key: "design_system_discipline", label: "设计系统纪律", maxScore: 10, definition: "是否以 EMKE VIS 为最高依据，保持网格、字体层级、留白、组件/模块和跨 Frame 视觉系统一致。" }
];
const defaultAccessCode = "emke.de";
const languageStorageKey = "emke-language";
const navigationStorageKey = "emke-navigation:v1";

const uiCopy: Record<Language, Record<string, string>> = {
  zh: {
    "Internal design review command center. Use the access code to create tasks, select Frames, and view AI pre-review results.": "内部设计审核工作台。使用访问口令进入后，可创建任务、选择 Frame 并查看 AI 初审结果。",
    "Access code": "访问口令",
    "Administrator access code": "管理员访问口令",
    "Use the dedicated administrator code configured by the server": "请输入服务端配置的管理员专用口令",
    "Current role": "当前身份",
    "Name": "姓名",
    "Used in activity logs": "用于操作记录",
    "Enter workspace": "进入工作台",
    "Page render failed": "页面显示失败",
    "The current data contains fields that cannot be rendered directly, so the app prevented a blank screen.": "当前数据包含无法直接渲染的字段，系统已拦截黑屏。",
    "Back to dashboard": "返回工作台",
    "Menu": "Menu",
    "Dashboard": "工作台",
    "VIS source": "VIS 标准源",
    "Settings": "设置",
    "Switch role": "切换身份",
    "Log out": "退出登录",
    "Track review queues, AI pre-review results, revision risks, and VIS sources.": "跟踪审核队列、AI 初审结果、修改风险和 VIS 标准源。",
    "New review task": "新建审核任务",
    "All tasks": "全部任务",
    "My tasks": "我的任务",
    "Show more ({count} remaining)": "加载更多（剩余 {count} 条）",
    "Unable to load tasks. Existing results are retained; retry to refresh.": "任务加载失败。已保留上次结果，请重试刷新。",
    "AI suggests revision": "AI 建议修改",
    "AI approved": "AI 已通过",
    "Action required": "待我处理",
    "AI reviewing": "AI 审核中",
    "Exceptions / archived": "异常/已归档",
    "Reviews in progress": "审核进行中",
    "Failed tasks": "异常任务",
    "Average AI score": "平均 AI 分",
    "Review Queue": "Review Queue",
    "Command center": "审核指挥台",
    "Decision required": "待决策",
    "Live AI review": "AI 审核中",
    "Revision risk": "返修风险",
    "Primary workflow": "主流程",
    "Next action": "下一步",
    "Watching": "观察中",
    "Reference": "参考",
    "Priority work": "优先处理",
    "Tasks that need Frame selection, retry, withdrawal, deletion, or resubmission.": "需要选择 Frame、重试、撤回、删除或重新提交的任务。",
    "Pipeline": "流程状态",
    "Reviews currently reading Figma, running AI, or comparing resubmissions.": "正在读取 Figma、运行 AI 或比对重新提交的审核。",
    "Outcome watch": "结果观察",
    "Returned work from other submitters and completed reference items.": "其他提交人的返修结果，以及已通过/归档的参考任务。",
    "Browse all reviews": "浏览全部审核",
    "Use filters for lookup; priority panels above stay focused on operational state.": "筛选用于查找；上方重点面板始终聚焦运营状态。",
    "Refresh": "刷新",
    "Loading tasks...": "读取任务中...",
    "AI passed": "AI 通过",
    "In progress": "进行中",
    "Failed": "异常",
    "Empty": "暂无",
    "Filtered results": "筛选结果",
    "No tasks match the current filters": "当前筛选条件下暂无任务",
    "No review tasks yet. Create a task and start AI review first.": "暂无审核任务。先新建任务并发起 AI 初审。",
    "Search tasks": "搜索任务",
    "Search task name / Figma file / submitter": "搜索任务名 / Figma 文件 / 提交人",
    "Content type": "内容类型",
    "All types": "全部类型",
    "Task status": "任务状态",
    "All statuses": "全部状态",
    "Submitter ID": "提交人 ID",
    "Reset": "重置",
    "NEW REVIEW": "NEW REVIEW",
    "Back": "返回",
    "Task name": "任务名称",
    "Example: Mother's Day website banner review": "例如：母亲节官网 Banner 审核",
    "Submission method": "提交方式",
    "Upload images": "上传图片",
    "Figma link": "Figma 链接",
    "Project notes": "项目说明",
    "Use case, channel, key product selling points": "使用场景、投放渠道、重点产品卖点",
    "Review images": "审核图片",
    "Choose PNG / JPG / WebP images": "选择 PNG / JPG / WebP 图片",
    "Up to {count} images per task, each no larger than 20MB": "单个项目最多 {count} 张，单张不超过 20MB",
    "Remove image": "移除图片",
    "Figma project link": "Figma 项目链接",
    "Used to track submitters, e.g. EMKE-Hale": "用于追踪提交人，例如 EMKE-Hale",
    "Priority": "优先级",
    "Processing...": "处理中...",
    "Create and AI review ({count})": "创建并 AI 初审 ({count})",
    "Read Figma": "读取 Figma",
    "Please upload at least 1 image": "请至少上传 1 张图片",
    "A task can include at most {count} images": "单个项目最多上传 {count} 张图片",
    "Only PNG, JPG, and WebP images are supported": "仅支持 PNG、JPG、WebP 图片",
    "A single image cannot exceed 20MB": "单张图片不能超过 20MB",
    "Image read failed": "图片读取失败",
    "Create failed": "创建失败",
    "Choose Frames to review": "选择需要审核的 Frame",
    "Only manually selected top-level Frames are exported. Up to {max} per review. Selected {selected}/{max}.": "只导出手动选择的顶层 Frame，单次最多 {max} 个。已选 {selected}/{max}。",
    "Start AI review ({count})": "开始 AI 初审 ({count})",
    "The current selection exceeds the limit. Reduce it to {max} Frames or fewer.": "当前选择超过单次上限，请减少到 {max} 个 Frame 以内。",
    "Select current Page": "全选当前 Page",
    "Deselect current Page": "取消当前 Page",
    "No thumbnail": "暂无缩略图",
    "Retry in {seconds}s": "等待 {seconds}s 后重试",
    "Reload Figma": "重新读取 Figma",
    "Reload task": "重新读取任务",
    "AI pre-review failed": "AI 初审失败",
    "Figma read failed": "读取 Figma 失败",
    "Loading review details...": "读取审核详情...",
    "Round {round} submission": "第 {round} 轮提交",
    "No project notes": "无项目说明",
    "Submitter: {name}": "提交人：{name}",
    "Save": "保存",
    "Edit name / ID": "编辑名称 / ID",
    "Submitting...": "提交中...",
    "Upload images and resubmit": "上传图片重新提交",
    "Resubmit": "重新提交",
    "Retry AI review": "重新 AI 初审",
    "Withdraw": "撤回",
    "Delete": "删除",
    "Decision summary": "审核结论",
    "Workflow actions": "流程操作",
    "Admin approve": "通过",
    "Confirm approving this review task as an admin? It will be marked as approved archive.": "确认以管理员身份通过并归档当前项目？",
    "Admin approval reason": "管理员通过原因",
    "Enter the human review reason for overriding the AI result": "请输入人工复核后覆盖 AI 结论的原因",
    "Admin approve failed": "管理员通过失败",
    "No workflow action needed": "当前无需流程操作",
    "Evidence and issues": "证据与问题",
    "Supporting history": "辅助记录",
    "Intake": "提交/选图",
    "AI analysis": "AI 分析",
    "AI decision": "AI 结论",
    "Revision loop": "返修闭环",
    "Approved archive": "通过归档",
    "Current": "当前",
    "Complete": "完成",
    "Pending": "待定",
    "Blocked": "阻断",
    "Zoom out": "缩小",
    "Zoom": "缩放比例",
    "Zoom in": "放大",
    "Reset to 100%": "恢复 100%",
    "No exported image": "暂无导出图",
    "Issue list": "问题清单",
    "No issue records yet.": "暂无问题记录。",
    "No issues match the current filters": "当前筛选条件下暂无问题",
    "Submission history": "提交记录",
    "Latest round": "最新轮次",
    "Round {round}": "第 {round} 轮",
    "All Frames": "全部 Frame",
    "All severities": "全部严重度",
    "All issues": "全部问题",
    "Must fix": "必须修改",
    "AI pre-review": "AI 初审",
    "No AI result yet.": "尚无 AI 结果。",
    "AI pre-review total score": "AI 初审总分",
    "Pass rule: total score >= 85 and no veto issues.": "通过规则：总分 >= 85 且没有一票否决项。",
    "Dimension evidence": "五维审核证据",
    "No clear deduction items": "无明确扣分项",
    "Related revision items": "关联修改项",
    "Veto risk {count} items": "一票否决风险 {count} 项",
    "No veto risk found": "未发现一票否决风险",
    "AI marks must fix": "AI 判定必须修改",
    "AI suggests optimization": "AI 建议优化",
    "Canvas annotation #{index}": "画面标注 #{index}",
    "No canvas annotation": "未生成画面标注",
    "Location": "位置",
    "See canvas annotation #{index}": "见画面标注 #{index}",
    "Unspecified area": "未指定区域",
    "Judgment": "判断",
    "Revision suggestion": "修改建议",
    "Basis": "依据",
    "STANDARD SOURCE": "STANDARD SOURCE",
    "The AI pre-review sends these Markdown sections as the only VIS standard source and requires the vision model to understand, cite, and apply them one by one.": "AI 初审会把这里的 Markdown 章节作为唯一 VIS 标准源发送给视觉模型，并要求模型逐条理解、引用和应用。",
    "Path not loaded": "未加载路径",
    "Upload standard source": "上传标准源",
    "Analyzing...": "分析中...",
    "Analyze standard source": "分析标准源",
    "File name": "文件名",
    "Title-only section": "仅标题章节",
    "SERVER CONFIG": "SERVER CONFIG",
    "System settings": "系统设置",
    "ACCESS": "ACCESS",
    "Only admins can edit system settings": "仅管理员可编辑系统设置",
    "Current role: {role}. Use an admin role to update AI Key, model, or VIS configuration.": "当前身份：{role}。如需修改 AI Key、模型或 VIS 配置，请使用管理员身份进入。",
    "Configured": "已配置",
    "FIGMA_TOKEN not configured": "未配置 FIGMA_TOKEN",
    "Key not configured, local placeholder review is used": "未配置 Key，本地使用占位审核",
    "Current source": "当前来源",
    "Environment variables": "环境变量",
    "Runtime config": "运行时配置",
    "System preset": "系统预设",
    "Max Frame count": "最大 Frame 数",
    "Max upload image count": "最大上传图片数",
    "VIS standard source path": "VIS 标准源路径",
    "AI model endpoint": "AI 模型接口",
    "Provider name": "Provider 名称",
    "Model": "模型",
    "Enter a new Key to save; the full Key will not be shown in the frontend": "输入新 Key 后保存；不会在前端回显完整 Key",
    "Saving...": "保存中...",
    "Save AI config": "保存 AI 配置",
    "Save failed": "保存失败",
    "Upload failed": "上传失败",
    "Request failed": "请求失败",
    "Confirm withdrawing this review task? It will remain recorded but leave the review queue.": "确认撤回这个审核任务？撤回后会保留记录，但不再进入审核队列。",
    "Withdraw failed": "撤回失败",
    "Confirm voiding this review task? Its Frames, results, issues, and activity history will be retained.": "确认作废这个审核任务？Frame、审核结果、问题和操作历史都会保留。",
    "Delete failed": "删除失败",
    "Void": "作废",
    "Void failed": "作废失败",
    "Edit task name": "编辑任务名称",
    "Resubmit failed": "重新提交失败",
    "AI review in progress": "AI 审核进行中",
    "The system is analyzing selected images. This usually takes 1-3 minutes.": "系统正在分析已选图片，通常需要 1-3 分钟。",
    "If it runs longer than a few minutes, refresh this page. Timed-out reviews will become retryable automatically.": "如果等待超过几分钟，请刷新页面。超时的审核会自动变为可重新发起。",
    "Step 1": "步骤 1",
    "Image exported": "图片已准备",
    "Step 2": "步骤 2",
    "AI visual analysis": "AI 视觉分析",
    "Step 3": "步骤 3",
    "Generating report": "生成审核报告",
    "Queued for review": "等待审核执行",
    "Preparing review": "准备审核数据",
    "Exporting images": "导出审核图片",
    "Attempt {attempt}": "第 {attempt} 次执行",
    "Reviewing now": "正在审核",
    "Started {minutes} min ago": "已开始 {minutes} 分钟",
    "Auto-refreshing": "自动刷新中",
    "Review may take 1-3 min": "预计 1-3 分钟",
    "Refresh status": "刷新状态"
  },
  en: {}
};

uiCopy.en = Object.fromEntries(Object.keys(uiCopy.zh).map((key) => [key, key]));
Object.assign(uiCopy.en, {
  "品牌资产、色彩、字体、图片气质是否符合 EMKE warm-minimal 与理性可信赖定位。": "Whether brand assets, colors, typography, and image tone match EMKE's warm-minimal, rational, trustworthy positioning.",
  "品牌资产、色彩、字体、图片气质是否符合 EMKE VIS 中的 warm-minimal 与理性可信赖定位。": "Whether brand assets, colors, typography, and image tone match EMKE VIS's warm-minimal, rational, trustworthy positioning.",
  "栅格、层级、留白、对齐和阅读路径是否稳定清晰。": "Whether grids, hierarchy, spacing, alignment, and reading flow are stable and clear.",
  "栅格、层级、留白、对齐和阅读路径是否在 VIS 规范下稳定清晰。": "Whether grids, hierarchy, spacing, alignment, and reading flow stay stable and clear under the VIS standards.",
  "产品、卖点、证明信息和 CTA 是否帮助用户快速决策。": "Whether products, selling points, proof, and CTAs help users decide quickly.",
  "尺寸、安全区、文案准确性、素材完整性和导出质量是否达标。": "Whether dimensions, safe areas, copy accuracy, asset completeness, and export quality meet delivery standards.",
  "是否以 EMKE VIS 为最高依据，保持网格、字体层级、留白、组件/模块和跨 Frame 视觉系统一致。": "Whether the work treats EMKE VIS as the highest authority and keeps grid, type hierarchy, spacing, components/modules, and cross-frame visual systems consistent."
});

type I18nValue = string | number;
type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: Record<string, I18nValue>) => string;
  label: (value: string) => string;
  dynamic: (value: unknown) => string;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

function interpolate(text: string, values?: Record<string, I18nValue>) {
  if (!values) return text;
  return Object.entries(values).reduce((current, [key, value]) => current.replaceAll(`{${key}}`, String(value)), text);
}

function useI18n() {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error("I18n context is missing");
  return value;
}

function readStoredNavigation() {
  try {
    const raw = localStorage.getItem(navigationStorageKey);
    return normalizeStoredReviewNavigation(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeStoredReviewNavigation(undefined);
  }
}

function App() {
  const [language, setLanguageState] = useState<Language>(() => {
    const savedLanguage = localStorage.getItem(languageStorageKey);
    return detectPreferredLanguage(savedLanguage, navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean));
  });

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem(languageStorageKey, language);
  }, [language]);

  const i18n = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage: setLanguageState,
    t: (key, values) => interpolate(uiCopy[language][key] ?? key, values),
    label: (value) => languageLabel(language, value),
    dynamic: (value) => localizeDynamicText(language, value)
  }), [language]);

  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem("emke-session");
    if (!raw) return null;
    try {
      const saved = normalizeStoredSession(JSON.parse(raw));
      if (!saved) localStorage.removeItem("emke-session");
      return saved;
    } catch {
      localStorage.removeItem("emke-session");
      return null;
    }
  });
  const [navigation, setNavigation] = useState(() => readStoredNavigation());
  const { view, activeTaskId } = navigation;

  function clearSession() {
    localStorage.removeItem("emke-session");
    localStorage.removeItem(navigationStorageKey);
    setNavigation(normalizeStoredReviewNavigation({ view: "dashboard", activeTaskId: null }));
    setSession(null);
  }

  useEffect(() => {
    const onSessionExpired = () => clearSession();
    window.addEventListener("emke-session-expired", onSessionExpired);
    return () => window.removeEventListener("emke-session-expired", onSessionExpired);
  }, []);

  async function leaveSession() {
    if (session?.token) {
      await fetch("/api/session", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` }
      }).catch(() => undefined);
    }
    clearSession();
  }

  useEffect(() => {
    localStorage.setItem(navigationStorageKey, JSON.stringify(navigation));
  }, [navigation]);

  function navigate(nextView: ReviewAppView, taskId?: string | null) {
    setNavigation((current) => normalizeStoredReviewNavigation({
      view: nextView,
      activeTaskId: taskId ?? current.activeTaskId
    }));
  }

  if (!session) {
    return (
      <I18nContext.Provider value={i18n}>
        <AccessScreen onEnter={setSession} />
      </I18nContext.Provider>
    );
  }
  return (
    <I18nContext.Provider value={i18n}>
      <AppErrorBoundary resetKey={`${view}:${activeTaskId ?? ""}`} onDashboard={() => navigate("dashboard")}>
        <Shell session={session} view={view} onView={navigate} onLogout={leaveSession} onSwitchRole={leaveSession}>
          {view === "dashboard" && <Dashboard session={session} onNew={() => navigate("new")} onOpen={(id) => navigate("detail", id)} />}
          {view === "new" && <NewTask session={session} onBack={() => navigate("dashboard")} onFrames={(id) => navigate("frames", id)} onDetail={(id) => navigate("detail", id)} />}
          {view === "frames" && activeTaskId && <FrameSelection session={session} taskId={activeTaskId} onBack={() => navigate("dashboard")} onDetail={() => navigate("detail", activeTaskId)} />}
          {view === "detail" && activeTaskId && <ReviewDetail session={session} taskId={activeTaskId} onFrames={() => navigate("frames", activeTaskId)} onDashboard={() => navigate("dashboard")} />}
          {view === "vis" && <VisPage session={session} />}
          {view === "settings" && <SettingsPage session={session} />}
        </Shell>
      </AppErrorBoundary>
    </I18nContext.Provider>
  );
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey: string; onDashboard: () => void }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Page render failed" };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <I18nContext.Consumer>
        {(i18n) => (
          <main className="workspace error-fallback">
            <section className="panel">
              <h2>{i18n?.t("Page render failed")}</h2>
              <p className="meta">{i18n?.t("The current data contains fields that cannot be rendered directly, so the app prevented a blank screen.")}</p>
              <div className="error">{this.state.error}</div>
              <button className="primary" type="button" onClick={this.props.onDashboard}>{i18n?.t("Back to dashboard")}</button>
            </section>
          </main>
        )}
      </I18nContext.Consumer>
    );
  }
}

function AccessScreen({ onEnter }: { onEnter: (session: Session) => void }) {
  const { t, label } = useI18n();
  const [accessCode, setAccessCode] = useState(defaultAccessCode);
  const [role, setRole] = useState<Role>("设计师");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode, role, name }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? t("Request failed"));
        return;
      }
      const session = normalizeStoredSession(result.session);
      if (!session) throw new Error(t("Request failed"));
      localStorage.setItem("emke-session", JSON.stringify(session));
      onEnter(session);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Request failed"));
    }
  }

  return (
    <main className="access-page">
      <form className="access-card" onSubmit={submit}>
        <div className="access-language"><LanguageSwitcher /></div>
        <h1>EMKE DESIGN REVIEW</h1>
        <p>{t("Internal design review command center. Use the access code to create tasks, select Frames, and view AI pre-review results.")}</p>
        <label>
          {t(role === "管理员" ? "Administrator access code" : "Access code")}
          <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder={role === "管理员" ? t("Use the dedicated administrator code configured by the server") : defaultAccessCode} required />
          {role === "管理员" && <small className="meta">{t("Use the dedicated administrator code configured by the server")}</small>}
        </label>
        <label>{t("Current role")}<select value={role} onChange={(event) => { const nextRole = event.target.value as Role; setRole(nextRole); setAccessCode(accessCodeForRoleSelection(nextRole, defaultAccessCode)); setError(""); }}><option value="设计师">{label("设计师")}</option><option value="管理员">{label("管理员")}</option></select></label>
        <label>{t("Name")}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Used in activity logs")} required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary access-submit" type="submit">{t("Enter workspace")} <ChevronRight size={16} /></button>
      </form>
    </main>
  );
}

function Shell({ session, view, onView, onLogout, onSwitchRole, children }: { session: Session; view: string; onView: (view: ReviewAppView) => void; onLogout: () => void; onSwitchRole: () => void; children: React.ReactNode }) {
  const { t, label } = useI18n();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="sidebar-brand" type="button" onClick={() => onView("dashboard")}>
          <span className="brand-mark"><Gauge size={17} /></span>
          <span><strong>EMKE Review</strong><small>AI Design Audit</small></span>
        </button>
        <nav className="sidebar-nav">
          <span>{t("Menu")}</span>
          <button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => onView("dashboard")}><Gauge size={15} /> {t("Dashboard")}</button>
          <button className={view === "vis" ? "active" : ""} type="button" onClick={() => onView("vis")}><FileText size={15} /> {t("VIS source")}</button>
        </nav>
        <div className="sidebar-footer">
          <LanguageSwitcher />
          <button className={`sidebar-link ${view === "settings" ? "active" : ""}`} type="button" onClick={() => onView("settings")}><Settings size={15} /> {t("Settings")}</button>
          <div className="sidebar-user"><div className="avatar" title={`${label(session.role)} ${session.name}`}>{avatarText(session.name)}</div><span><strong>{session.name}</strong><small>{label(session.role)}</small></span></div>
          <div className="sidebar-session-actions">
            <button type="button" onClick={onSwitchRole}>{t("Switch role")}</button>
            <button type="button" onClick={onLogout}>{t("Log out")}</button>
          </div>
        </div>
      </aside>
      <section className="app-main">
        {children}
      </section>
    </div>
  );
}

function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();
  return (
    <div className="language-switcher" aria-label="Language">
      <button className={language === "zh" ? "active" : ""} type="button" aria-pressed={language === "zh"} onClick={() => setLanguage("zh")}>中文</button>
      <button className={language === "en" ? "active" : ""} type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
    </div>
  );
}

function Dashboard({ session, onNew, onOpen }: { session: Session; onNew: () => void; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { data: tasks, error, reload, loading } = useApi<Task[]>("/api/reviews", session, []);
  const [filters, setFilters] = useState<TaskFilters>(() => defaultTaskFilters(session.role));
  const [visibleTaskCount, setVisibleTaskCount] = useState(10);
  const hasActiveAiReview = tasks.some((task) => task.status === "ai_reviewing");
  const filteredTasks = useMemo(
    () => filterTasks(tasks, { ...filters, currentUserId: session.userId, currentUserName: session.name }),
    [tasks, filters, session.userId, session.name]
  );
  const commandCenter = useMemo(
    () => dashboardCommandCenter(tasks, { currentUserId: session.userId, currentUserName: session.name }),
    [tasks, session.userId, session.name]
  );

  function updateFilters(nextFilters: TaskFilters) {
    setFilters(nextFilters);
    setVisibleTaskCount(10);
  }

  useEffect(() => {
    if (!hasActiveAiReview) return;
    const timer = window.setInterval(() => reload(), 10000);
    return () => window.clearInterval(timer);
  }, [hasActiveAiReview, reload]);

  return (
    <main className="workspace">
      <section className="hero-row dashboard-hero">
        <div>
          <h1>Hi,{session.name}</h1>
          <p>{t("Track review queues, AI pre-review results, revision risks, and VIS sources.")}</p>
        </div>
        <button className="hero-button primary" type="button" onClick={onNew}>
          <UploadCloud size={16} />
          {t("New review task")}
        </button>
      </section>

      <section className="command-dashboard">
        <div className="command-topline">
          <div>
            <h2>{t("Command center")}</h2>
            <p>{t("Track review queues, AI pre-review results, revision risks, and VIS sources.")}</p>
          </div>
          <button className="hero-button subtle" type="button" onClick={reload}><RefreshCw size={15} />{t("Refresh")}</button>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="command-metrics">
          <CommandMetric label={t("Decision required")} value={commandCenter.metrics.primaryAction} accent={t("Next action")} tone="action" />
          <CommandMetric label={t("Live AI review")} value={commandCenter.metrics.liveReview} accent={t("Watching")} tone="live" />
          <CommandMetric label={t("Revision risk")} value={commandCenter.metrics.revisionRisk} accent={t("Primary workflow")} tone="revision" />
          <CommandMetric label={t("Average AI score")} value={commandCenter.metrics.averageScore} accent="/100" tone="score" />
        </div>

        <div className="command-main-grid">
          <TaskLanePanel
            className="priority-panel"
            title={t("Priority work")}
            description={t("Tasks that need Frame selection, retry, withdrawal, deletion, or resubmission.")}
            tasks={commandCenter.primaryAction}
            emptyText={error ? t("Unable to load tasks. Existing results are retained; retry to refresh.") : loading ? t("Loading tasks...") : t("Empty")}
            onOpen={onOpen}
          />

          <section className="panel pipeline-panel">
            <div className="panel-section-head">
              <div>
                <h3>{t("Pipeline")}</h3>
                <p>{t("Reviews currently reading Figma, running AI, or comparing resubmissions.")}</p>
              </div>
              <span className="chip-soft">{commandCenter.liveReview.length}</span>
            </div>
            <div className="pipeline-review-stack">
              {commandCenter.liveReview.map((task) => <TaskCard task={task} onOpen={onOpen} key={task.id} compact />)}
              {commandCenter.liveReview.length === 0 && <div className="lane-empty">{error ? t("Unable to load tasks. Existing results are retained; retry to refresh.") : loading ? t("Loading tasks...") : t("Empty")}</div>}
            </div>
          </section>

          <div className="secondary-workflow-stack">
            <TaskLanePanel
              className="secondary-panel"
              title={t("Outcome watch")}
              description={t("Returned work from other submitters and completed reference items.")}
              tasks={commandCenter.revisionRisk}
              emptyText={loading ? t("Loading tasks...") : t("Empty")}
              onOpen={onOpen}
              compact
            />
            <TaskLanePanel
              className="secondary-panel reference-panel"
              title={t("Reference archive")}
              description={t("Reference")}
              tasks={commandCenter.reference.slice(0, 4)}
              emptyText={loading ? t("Loading tasks...") : t("Empty")}
              onOpen={onOpen}
              compact
            />
          </div>
        </div>

        <section className="panel browse-panel">
          <div className="panel-section-head browse-head">
            <div>
              <h3>{t("Browse all reviews")}</h3>
              <p>{t("Use filters for lookup; priority panels above stay focused on operational state.")}</p>
            </div>
            <span className="chip-soft">{filteredTasks.length}</span>
          </div>
          <TaskFilterBar filters={filters} onChange={updateFilters} />
          <div className="task-ledger-list">
            {filteredTasks.slice(0, visibleTaskCount).map((task) => <TaskCard task={task} onOpen={onOpen} key={task.id} compact />)}
            {!loading && !error && filteredTasks.length === 0 && tasks.length > 0 && <div className="lane-empty">{t("No tasks match the current filters")}</div>}
            {!loading && !error && tasks.length === 0 && <div className="empty">{t("No review tasks yet. Create a task and start AI review first.")}</div>}
          </div>
          {filteredTasks.length > visibleTaskCount && <button className="hero-button subtle browse-more" type="button" onClick={() => setVisibleTaskCount((count) => count + 10)}>{t("Show more ({count} remaining)", { count: filteredTasks.length - visibleTaskCount })}</button>}
        </section>
      </section>
    </main>
  );
}

function CommandMetric({ label, value, accent, tone }: { label: string; value: number; accent: string; tone: "action" | "live" | "revision" | "score" }) {
  return (
    <article className={`command-metric command-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{accent}</em>
    </article>
  );
}

function TaskLanePanel({
  className = "",
  title,
  description,
  tasks,
  emptyText,
  onOpen,
  compact = false
}: {
  className?: string;
  title: string;
  description?: string;
  tasks: Task[];
  emptyText: string;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <section className={`panel task-lane-panel ${className}`}>
      <div className="panel-section-head">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        <span className="chip-soft">{tasks.length}</span>
      </div>
      <div className="task-lane-list">
        {tasks.map((task) => <TaskCard task={task} onOpen={onOpen} key={task.id} compact={compact} />)}
        {tasks.length === 0 && <div className="lane-empty">{emptyText}</div>}
      </div>
    </section>
  );
}

function TaskFilterBar({ filters, onChange }: { filters: TaskFilters; onChange: (filters: TaskFilters) => void }) {
  const { t, label } = useI18n();
  const selectedContentType = filters.contentType || "all";
  const selectedStatus = filters.status || "all";
  return (
    <div className="filter-bar hero-filter-bar">
      <div className="filter-bar-grid">
        <input
          aria-label={t("Search tasks")}
          placeholder={t("Search task name / Figma file / submitter")}
          value={filters.keyword ?? ""}
          onChange={(event) => onChange({ ...filters, keyword: event.target.value })}
        />
        <select
          aria-label={t("Content type")}
          value={selectedContentType}
          onChange={(event) => onChange({ ...filters, contentType: event.target.value === "all" ? "" : event.target.value })}
        >
          <option value="all">{t("All types")}</option>
          <option value="电商页面">{label("电商页面")}</option>
          <option value="Amazon A+ 页面">{label("Amazon A+ 页面")}</option>
          <option value="官网 Banner">{label("官网 Banner")}</option>
        </select>
        <select
          aria-label={t("Task status")}
          value={selectedStatus}
          onChange={(event) => onChange({ ...filters, status: event.target.value === "all" ? "" : event.target.value })}
        >
          <option value="all">{t("All statuses")}</option>
          <option value="action_required">{label("action_required")}</option>
          <option value="reviewing">{label("reviewing")}</option>
          <option value="needs_revision">{label("needs_revision")}</option>
          <option value="approved">{label("approved")}</option>
          <option value="closed">{label("closed")}</option>
        </select>
        <input
          aria-label={t("Submitter ID")}
          placeholder={t("Submitter ID")}
          value={filters.submitterId ?? ""}
          onChange={(event) => onChange({ ...filters, submitterId: event.target.value })}
        />
        <button className={`hero-button subtle mine-toggle ${filters.onlyMine ? "active" : ""}`} type="button" aria-pressed={Boolean(filters.onlyMine)} onClick={() => onChange({ ...filters, onlyMine: !filters.onlyMine })}>{filters.onlyMine ? t("My tasks") : t("All tasks")}</button>
        <button className="hero-button subtle" type="button" onClick={() => onChange({ ...filters, contentType: "", status: "", submitterId: "", keyword: "" })}>{t("Reset")}</button>
      </div>
    </div>
  );
}

function TaskCard({ task, onOpen, compact = false }: { task: Task; onOpen: (id: string) => void; compact?: boolean }) {
  const { t, label } = useI18n();
  const isReviewing = task.status === "ai_reviewing";
  return (
    <button className={`task-card ${compact ? "compact" : ""}`} type="button" onClick={() => onOpen(task.id)}>
      <div className="task-card-body">
        <div className="task-info">
          <div className="task-title">{task.title}</div>
          <div className="meta">{label(task.contentType)} · {task.submitterName}{task.submitterId ? ` #${task.submitterId}` : ""}</div>
        </div>
        <div className="task-stats">
          <span className={`status ${task.status}`}>{label(task.status)}</span>
          <span className={`score-chip score-chip--${scoreTone(task.aiTotalScore)}`}>{task.aiTotalScore ?? "--"}</span>
        </div>
        {isReviewing && (
          <div className="task-review-progress">
            <span>{t("AI visual analysis")}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function NewTask({ session, onBack, onFrames, onDetail }: { session: Session; onBack: () => void; onFrames: (id: string) => void; onDetail: (id: string) => void }) {
  const { t, label } = useI18n();
  const [form, setForm] = useState({ title: "", contentType: "官网 Banner" as ContentType, description: "", figmaUrl: "", priority: "普通" });
  const { data: health } = useApi<any>("/api/health", session, null);
  const [sourceMode, setSourceMode] = useState<"upload" | "figma">("upload");
  const [images, setImages] = useState<UploadedImageDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maxUploadImages = Number(health?.maxUploadImagesPerTask ?? 9);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    let createdTaskId = "";
    try {
      if (sourceMode === "upload") {
        if (images.length === 0) throw new Error(t("Please upload at least 1 image"));
        if (images.length > maxUploadImages) throw new Error(t("A task can include at most {count} images", { count: maxUploadImages }));
        const response = await api<{ task: Task }>("/api/reviews/upload-images", session, {
          method: "POST",
          body: {
            ...form,
            images: images.map(({ fileName, mimeType, dataUrl }) => ({ fileName, mimeType, dataUrl }))
          }
        });
        onDetail(response.task.id);
        return;
      }
      const task = await api<Task>("/api/reviews", session, { method: "POST", body: form });
      createdTaskId = task.id;
      await api(`/api/reviews/${task.id}/read-figma`, session, { method: "POST" });
      onFrames(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Create failed"));
      if (createdTaskId) onFrames(createdTaskId);
    } finally {
      setBusy(false);
    }
  }

  async function pickImages(fileList?: FileList | null) {
    if (!fileList?.length) return;
    setError("");
    try {
      const files = Array.from(fileList);
      if (images.length + files.length > maxUploadImages) throw new Error(t("A task can include at most {count} images", { count: maxUploadImages }));
      const accepted = validateImageFiles(files, {
        currentCount: images.length,
        maxCount: maxUploadImages,
        messages: {
          tooMany: t("A task can include at most {count} images", { count: maxUploadImages }),
          unsupported: t("Only PNG, JPG, and WebP images are supported"),
          tooLarge: t("A single image cannot exceed 20MB")
        }
      });
      const drafts = await Promise.all(accepted.map((file) => readImageDraft(file, t("Image read failed"))));
      setImages((current) => [...current, ...drafts]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Image read failed"));
    }
  }

  function removeImage(id: string) {
    setImages((current) => current.filter((image) => image.id !== id));
  }

  return (
    <main className="workspace narrow task-workspace">
      <div className="task-page-top">
        <div className="task-page-title">
          <div className="eyebrow">{t("NEW REVIEW")}</div>
          <h2>{t("New review task")}</h2>
        </div>
        <button className="ghost" type="button" onClick={onBack}><ArrowLeft size={15} /> {t("Back")}</button>
      </div>
      <form className="panel form-panel" onSubmit={submit}>
        <label>{t("Task name")}<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={t("Example: Mother's Day website banner review")} required /></label>
        <fieldset className="choice-field compact">
          <legend>{t("Submission method")}</legend>
          <div className="choice-group">
            <button type="button" className={sourceMode === "upload" ? "active" : ""} aria-pressed={sourceMode === "upload"} onClick={() => setSourceMode("upload")}><UploadCloud size={15} /> {t("Upload images")}</button>
            <button type="button" className={sourceMode === "figma" ? "active" : ""} aria-pressed={sourceMode === "figma"} onClick={() => setSourceMode("figma")}><ImageIcon size={15} /> {t("Figma link")}</button>
          </div>
        </fieldset>
        <fieldset className="choice-field">
          <legend>{t("Content type")}</legend>
          <div className="choice-group">
            {(["电商页面", "Amazon A+ 页面", "官网 Banner"] as ContentType[]).map((contentType) => (
              <button type="button" className={form.contentType === contentType ? "active" : ""} aria-pressed={form.contentType === contentType} key={contentType} onClick={() => setForm({ ...form, contentType })}>{label(contentType)}</button>
            ))}
          </div>
        </fieldset>
        <label>{t("Project notes")}<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={t("Use case, channel, key product selling points")} /></label>
        {sourceMode === "upload" ? (
          <section className="image-upload-field">
            <div className="upload-label-row">
              <span>{t("Review images")}</span>
              <span className={images.length > maxUploadImages ? "error-inline" : "meta"}>{images.length}/{maxUploadImages}</span>
            </div>
            <label className="image-dropzone">
              <UploadCloud size={18} />
              <span>{t("Choose PNG / JPG / WebP images")}</span>
              <small>{t("Up to {count} images per task, each no larger than 20MB", { count: maxUploadImages })}</small>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { pickImages(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            {images.length > 0 && (
              <div className="upload-preview-grid">
                {images.map((image) => (
                  <article className="upload-preview-card" key={image.id}>
                    <div className="thumb"><img src={image.dataUrl} alt={image.fileName} /></div>
                    <div>
                      <strong>{image.fileName}</strong>
                      <span>{formatFileSize(image.size)}</span>
                    </div>
                    <button type="button" className="danger compact icon-only" onClick={() => removeImage(image.id)} aria-label={t("Remove image")} title={t("Remove image")}><Trash2 size={14} /></button>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <label>{t("Figma project link")}<input value={form.figmaUrl} onChange={(event) => setForm({ ...form, figmaUrl: event.target.value })} placeholder="https://www.figma.com/design/..." required={sourceMode === "figma"} /></label>
        )}
        <div className="meta">{t("Submitter: {name}", { name: session.name })} · ID {session.userId ?? session.name}</div>
        <fieldset className="choice-field compact">
          <legend>{t("Priority")}</legend>
          <div className="choice-group">
            {["普通", "加急"].map((priority) => (
              <button type="button" className={form.priority === priority ? "active" : ""} aria-pressed={form.priority === priority} key={priority} onClick={() => setForm({ ...form, priority })}>{label(priority)}</button>
            ))}
          </div>
        </fieldset>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={busy || (sourceMode === "upload" && images.length === 0)}>{busy ? t("Processing...") : sourceMode === "upload" ? t("Create and AI review ({count})", { count: images.length }) : t("Read Figma")} <ChevronRight size={16} /></button>
      </form>
    </main>
  );
}

function FrameSelection({ session, taskId, onBack, onDetail }: { session: Session; taskId: string; onBack: () => void; onDetail: () => void }) {
  const { t } = useI18n();
  const { data, error, reload } = useApi<Detail>(`/api/reviews/${taskId}`, session, null as any);
  const { data: health } = useApi<any>("/api/health", session, null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const frames = data?.frames ?? [];
  const pages = [...new Set(frames.map((frame) => frame.pageName))];
  const maxFrames = Number(health?.maxFramesPerTask ?? 12);

  useEffect(() => setSelected(new Set(frames.filter((frame) => frame.selected).map((frame) => frame.id))), [frames.length]);
  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setTimeout(() => setRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  async function startAiReview() {
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/reviews/${taskId}/select-frames`, session, { method: "POST", body: { frameIds: [...selected] } });
      await api(`/api/reviews/${taskId}/start-ai-review`, session, { method: "POST" });
      onDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("AI pre-review failed"));
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
      const message = err instanceof Error ? err.message : t("Figma read failed");
      if (message.includes("Figma API 限流") || message.includes("Rate limit")) setRetryAfter(60);
      setActionError(message);
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
      <div className="page-head frame-selection-head">
        <div><h2>{t("Choose Frames to review")}</h2><p>{t("Only manually selected top-level Frames are exported. Up to {max} per review. Selected {selected}/{max}.", { max: maxFrames, selected: selected.size })}</p></div>
        <div className="frame-head-actions">
          <button className="ghost" type="button" onClick={onBack}><ArrowLeft size={15} /> {t("Back")}</button>
          <button className="primary" type="button" disabled={busy || selected.size === 0 || selected.size > maxFrames} onClick={startAiReview}>{busy ? t("Processing...") : t("Start AI review ({count})", { count: selected.size })} <Sparkles size={16} /></button>
        </div>
      </div>
      {selected.size > maxFrames && <div className="error">{t("The current selection exceeds the limit. Reduce it to {max} Frames or fewer.", { max: maxFrames })}</div>}
      {(error || actionError) && <div className="error">{error || actionError}</div>}
      {pages.map((page) => (
        <section key={page} className="frame-section">
          <div className="section-bar"><h3>{page}</h3><button className="ghost" type="button" onClick={() => togglePage(page)}>{frames.filter((frame) => frame.pageName === page).every((frame) => selected.has(frame.id)) ? t("Deselect current Page") : t("Select current Page")}</button></div>
          <div className="frame-grid">
            {frames.filter((frame) => frame.pageName === page).map((frame) => (
              <button className={`frame-card ${selected.has(frame.id) ? "selected" : ""}`} type="button" key={frame.id} onClick={() => toggle(frame.id)}>
                <div className="thumb">{frame.thumbnailUrl ? <img src={frame.thumbnailUrl} alt={frame.frameName} /> : <><ImageIcon /><span>{t("No thumbnail")}</span></>}</div>
                <div className="frame-name">{frame.frameName}</div>
                <div className="meta">{frame.width} x {frame.height} · {frame.figmaNodeId}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
      {frames.length === 0 && <div className="empty frame-empty">{data?.task?.status === "figma_read_failed" ? <button className="primary" type="button" onClick={readFigmaAgain} disabled={busy || retryAfter > 0}>{retryAfter > 0 ? t("Retry in {seconds}s", { seconds: retryAfter }) : t("Reload Figma")}</button> : <button className="primary" type="button" onClick={reload}>{t("Reload task")}</button>}</div>}
    </main>
  );
}

function ReviewDetail({ session, taskId, onFrames, onDashboard }: { session: Session; taskId: string; onFrames: () => void; onDashboard: () => void }) {
  const { t, label, dynamic } = useI18n();
  const { data, error: loadError, reload } = useApi<Detail>(`/api/reviews/${taskId}`, session, null as any);
  const { data: health } = useApi<any>("/api/health", session, null);
  const detailData = data?.task.id === taskId ? data : null;
  const [activeFrameId, setActiveFrameId] = useState("");
  const [zoom, setZoom] = useState(100);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState({ title: "" });
  const [selectedRound, setSelectedRound] = useState<number | "latest">("latest");
  const [issueFilters, setIssueFilters] = useState<IssueFilters>({ frameName: "", type: "", severity: "", resolutionStatus: "", mustFixOnly: false });
  const [activeIssueId, setActiveIssueId] = useState("");
  const [error, setError] = useState("");
  const [resubmitBusy, setResubmitBusy] = useState(false);
  const [adminApproveBusy, setAdminApproveBusy] = useState(false);
  const uploadResubmitInputRef = useRef<HTMLInputElement>(null);
  const runningJobRef = useRef("");
  const frames = detailData?.frames.filter((frame) => frame.selected || frame.exportedImageUrl) ?? [];
  const activeFrame = frames.find((frame) => frame.id === activeFrameId) ?? frames[0];
  const roundData = selectReviewRoundData({
    selectedRound,
    taskSubmissionRound: detailData?.task.submissionRound,
    results: detailData?.results ?? [],
    issues: detailData?.issues ?? []
  });
  const { rounds, currentRound, result, issues } = roundData;
  const filteredIssues = filterIssues(issues, issueFilters);
  const visibleAnnotatedIssues = filteredIssues.filter((issue) => issue.annotationSuggestion && (!issue.frameName || !activeFrame?.frameName || issue.frameName === activeFrame.frameName));
  const annotationIndexByIssueId = new Map(visibleAnnotatedIssues.map((issue, index) => [issue.id, index + 1]));
  const aiReviewing = detailData?.task.status === "ai_reviewing";
  const reviewJob = detailData?.job;
  const maxUploadImages = Number(health?.maxUploadImagesPerTask ?? 9);
  const reviewUpdatedAt = detailData?.task.updatedAt ? Date.parse(detailData.task.updatedAt) : NaN;
  const reviewAgeMinutes = Number.isFinite(reviewUpdatedAt) ? Math.max(0, Math.floor((Date.now() - reviewUpdatedAt) / 60000)) : 0;

  useEffect(() => {
    if (!aiReviewing) return;
    const timer = window.setInterval(() => reload(), 10000);
    return () => window.clearInterval(timer);
  }, [aiReviewing, reload]);
  useEffect(() => {
    if (!aiReviewing || !reviewJob) return;
    const leaseExpired = reviewJob.status === "running" && (!reviewJob.leaseExpiresAt || Date.parse(reviewJob.leaseExpiresAt) <= Date.now());
    if (reviewJob.status !== "queued" && !leaseExpired) return;
    const runKey = `${reviewJob.id}:${reviewJob.attempt}`;
    if (runningJobRef.current === runKey) return;
    runningJobRef.current = runKey;
    api(`/api/reviews/${taskId}/run-ai-review`, session, { method: "POST" })
      .then(() => reload())
      .catch((err) => setError(err instanceof Error ? err.message : t("AI pre-review failed")))
      .finally(() => {
        if (runningJobRef.current === runKey) runningJobRef.current = "";
      });
  }, [aiReviewing, reviewJob, reload, session, taskId, t]);

  async function resubmit() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}/resubmit`, session, { method: "POST", body: {} });
      onFrames();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Resubmit failed"));
    }
  }

  async function resubmitUploadedImages(fileList?: FileList | null) {
    if (!fileList?.length) return;
    setError("");
    setResubmitBusy(true);
    try {
      const files = Array.from(fileList);
      const accepted = validateImageFiles(files, {
        currentCount: 0,
        maxCount: maxUploadImages,
        messages: {
          tooMany: t("A task can include at most {count} images", { count: maxUploadImages }),
          unsupported: t("Only PNG, JPG, and WebP images are supported"),
          tooLarge: t("A single image cannot exceed 20MB")
        }
      });
      const images = await Promise.all(accepted.map((file) => readImageDraft(file, t("Image read failed"))));
      await api(`/api/reviews/${taskId}/resubmit`, session, {
        method: "POST",
        body: { images: images.map(({ fileName, mimeType, dataUrl }) => ({ fileName, mimeType, dataUrl })) }
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Resubmit failed"));
    } finally {
      setResubmitBusy(false);
      if (uploadResubmitInputRef.current) uploadResubmitInputRef.current.value = "";
    }
  }

  async function retryReadFigma() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}/read-figma`, session, { method: "POST" });
      onFrames();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Figma read failed"));
    }
  }

  async function retryAiReview() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}/start-ai-review`, session, { method: "POST" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("AI pre-review failed"));
    }
  }

  async function saveMeta() {
    setError("");
    try {
      await api(`/api/reviews/${taskId}`, session, { method: "PATCH", body: metaDraft });
      setEditingMeta(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Save failed"));
    }
  }

  async function withdrawTask() {
    if (!window.confirm(t("Confirm withdrawing this review task? It will remain recorded but leave the review queue."))) return;
    setError("");
    try {
      await api(`/api/reviews/${taskId}/withdraw`, session, { method: "POST" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Withdraw failed"));
    }
  }

  async function adminApproveTask() {
    const reason = window.prompt(t("Enter the human review reason for overriding the AI result"));
    if (!reason?.trim()) return;
    setError("");
    setAdminApproveBusy(true);
    try {
      await api(`/api/reviews/${taskId}/admin-approve`, session, { method: "POST", body: { reason: reason.trim() } });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Admin approve failed"));
    } finally {
      setAdminApproveBusy(false);
    }
  }

  async function deleteTask() {
    if (!window.confirm(t("Confirm voiding this review task? Its Frames, results, issues, and activity history will be retained."))) return;
    setError("");
    try {
      await api(`/api/reviews/${taskId}`, session, { method: "DELETE" });
      onDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Void failed"));
    }
  }

  if (!detailData) return <main className="workspace"><div className="panel">{loadError || t("Loading review details...")}</div></main>;
  const currentUserKeys = [session.userId, session.name].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  const ownsTask = [detailData.task.submitterId, detailData.task.submitterName].map((value) => String(value ?? "").trim().toLowerCase()).some((value) => currentUserKeys.includes(value));
  const canManageTask = session.role === "管理员" || ownsTask;
  const canWithdraw = canManageTask && ["frame_selection", "needs_revision", "resubmitted", "figma_read_failed", "ai_review_failed"].includes(detailData.task.status);
  const canDelete = (session.role === "管理员" || ownsTask) && ["draft", "figma_reading", "frame_selection", "ai_reviewing", "needs_revision", "resubmitted", "approved", "archived", "withdrawn", "figma_read_failed", "ai_review_failed"].includes(detailData.task.status);
  const canAdminApprove = session.role === "管理员" && ["needs_revision", "ai_review_failed"].includes(detailData.task.status);
  const workflowActions = (
    <section className="panel decision-actions-panel preview-workflow-panel">
      <div className="panel-section-head">
        <div>
          <h3>{t("Workflow actions")}</h3>
          <p>{label(detailData.task.status)}</p>
        </div>
      </div>
      <div className="decision-actions">
        {canAdminApprove && <button className="primary admin-approve-action" type="button" onClick={adminApproveTask} disabled={adminApproveBusy}><CheckCircle2 size={15} /> {adminApproveBusy ? t("Submitting...") : t("Admin approve")}</button>}
        {canManageTask && detailData.task.status === "needs_revision" && detailData.task.source === "upload" ? (
          <>
            <button className="primary" type="button" onClick={() => uploadResubmitInputRef.current?.click()} disabled={resubmitBusy}><UploadCloud size={15} /> {resubmitBusy ? t("Submitting...") : t("Upload images and resubmit")}</button>
            <input ref={uploadResubmitInputRef} aria-label={t("Upload images and resubmit")} className="hidden-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => resubmitUploadedImages(event.target.files)} />
          </>
        ) : canManageTask && detailData.task.status === "needs_revision" && <button className="primary" type="button" onClick={resubmit}><RefreshCw size={15} /> {t("Resubmit")}</button>}
        {canManageTask && detailData.task.status === "figma_read_failed" && <button className="primary" type="button" onClick={retryReadFigma}><RefreshCw size={15} /> {t("Reload Figma")}</button>}
        {canManageTask && detailData.task.status === "ai_review_failed" && <button className="primary" type="button" onClick={retryAiReview}><Sparkles size={15} /> {t("Retry AI review")}</button>}
        <div className="decision-secondary-actions" aria-label={t("Workflow actions")}>
          {canWithdraw && <button className="action-button" type="button" onClick={withdrawTask}><Undo2 size={15} /> {t("Withdraw")}</button>}
          {canDelete && <button className="danger compact" type="button" onClick={deleteTask}><Trash2 size={15} /> {t("Void")}</button>}
          <button className="action-button icon-only" type="button" onClick={reload} aria-label={t("Refresh")} title={t("Refresh")}><RefreshCw size={15} /></button>
        </div>
        {!canAdminApprove && !canWithdraw && !canDelete && detailData.task.status !== "needs_revision" && detailData.task.status !== "figma_read_failed" && detailData.task.status !== "ai_review_failed" && <span className="meta">{t("No workflow action needed")}</span>}
      </div>
    </section>
  );

  return (
    <main className="workspace detail">
      <section className="detail-head">
        <div className="detail-title-block">
          {editingMeta ? (
            <div className="meta-editor">
              <input aria-label={t("Task name")} value={metaDraft.title} onChange={(event) => setMetaDraft({ ...metaDraft, title: event.target.value })} />
            </div>
          ) : (
            <>
              <h2>{detailData.task.title}</h2>
              <div className="detail-meta-grid">
                <span className="round-badge">{t("Round {round} submission", { round: detailData.task.submissionRound })}</span>
                <span>{detailData.task.description || t("No project notes")}</span>
                <span>{t("Submitter: {name}", { name: detailData.task.submitterName })}{detailData.task.submitterId ? ` · ID ${detailData.task.submitterId}` : ""}</span>
              </div>
            </>
          )}
        </div>
        <div className="detail-tag-block">
          <span className="round-badge">{label(detailData.task.contentType)}</span>
          <span className={`status ${detailData.task.status}`}>{label(detailData.task.status)}</span>
        </div>
      </section>
      <ReviewFlowRail status={detailData.task.status} />
      {(loadError || error) && <div className="error">{loadError || error}</div>}
      {aiReviewing && <AiReviewProgressPanel minutes={reviewAgeMinutes} job={detailData.job} onRefresh={reload} />}
      <section className="review-layout">
        <div className="preview-panel">
          <div className="preview-toolbar">
            <div className="frame-tabs">{frames.map((frame) => (
              <button className={activeFrame?.id === frame.id ? "active" : ""} type="button" onClick={() => setActiveFrameId(frame.id)} title={frame.frameName} key={frame.id}>
                {compactFrameLabel(frame.frameName)}
              </button>
            ))}</div>
            <div className="preview-action-row head-actions">
              {editingMeta ? <button className="action-button primary-action" type="button" onClick={saveMeta}>{t("Save")}</button> : canManageTask && <button className="action-button icon-only" type="button" onClick={() => { setMetaDraft({ title: detailData.task.title }); setEditingMeta(true); }} aria-label={t("Edit task name")} title={t("Edit task name")}><Settings size={15} /></button>}
            </div>
            <div className="zoom-controls">
              <button type="button" onClick={() => setZoom(Math.max(50, zoom - 10))} title={t("Zoom out")}><Minus size={15} /></button>
              <input aria-label={t("Zoom")} type="range" min="50" max="220" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <button type="button" onClick={() => setZoom(Math.min(220, zoom + 10))} title={t("Zoom in")}><Plus size={15} /></button>
              <button className="zoom-reset" type="button" onClick={() => setZoom(100)} title={t("Reset to 100%")}><Maximize2 size={15} /><span>{zoom}%</span></button>
            </div>
          </div>
          <div className="image-stage">
            <div className="zoom-canvas" style={{ transform: `scale(${zoom / 100})` }}>
              {activeFrame?.exportedImageUrl || activeFrame?.thumbnailUrl ? (
                <div className="image-frame">
                  <img src={activeFrame.exportedImageUrl || activeFrame.thumbnailUrl} alt={activeFrame.frameName} />
                  <div className="annotation-layer">
                    {visibleAnnotatedIssues.map((issue, index) => <AnnotationBox key={issue.id} issue={issue} index={index + 1} active={issue.id === activeIssueId} onFocus={() => setActiveIssueId(issue.id)} />)}
                  </div>
                </div>
              ) : <div className="empty">{t("No exported image")}</div>}
            </div>
          </div>
          {workflowActions}
        </div>
        <aside className="review-sidebar">
          <ScorePanel result={result} status={detailData.task.status} issues={issues} />
          <section className="panel review-list-panel">
            <div className="panel-head"><h3>{t("Evidence and issues")}</h3><span>{filteredIssues.length}/{issues.length}</span></div>
            <IssueFilterBar filters={issueFilters} onChange={setIssueFilters} frames={frames} rounds={rounds} selectedRound={selectedRound} onRoundChange={setSelectedRound} />
            <div className="review-list-scroll">
              {filteredIssues.map((issue, index) => <IssueCard issue={issue} index={index + 1} annotationIndex={annotationIndexByIssueId.get(issue.id)} active={issue.id === activeIssueId} onFocus={() => setActiveIssueId(issue.id)} key={issue.id} />)}
              {issues.length === 0 && <p className="meta">{t("No issue records yet.")}</p>}
              {issues.length > 0 && filteredIssues.length === 0 && <div className="lane-empty">{t("No issues match the current filters")}</div>}
            </div>
          </section>
        </aside>
        <section className="panel log-panel review-log-panel">
          <div className="panel-head"><h3>{t("Supporting history")}</h3><span>{detailData.logs.length}</span></div>
          <div className="log-grid">
            {detailData.logs.map((log) => <div className="log" key={log.id}>{dynamic(log.action)}<span>{new Date(log.createdAt).toLocaleString()}</span></div>)}
          </div>
        </section>
      </section>
    </main>
  );
}

function ReviewFlowRail({ status }: { status: ReviewStatus }) {
  const { t } = useI18n();
  const stageLabels: Record<string, string> = {
    intake: "Intake",
    ai_review: "AI analysis",
    ai_decision: "AI decision",
    revision: "Revision loop",
    approved: "Approved archive"
  };
  const stateLabels: Record<ReviewTimelineStageState, string> = {
    complete: "Complete",
    active: "Current",
    idle: "Pending",
    blocked: "Blocked"
  };

  return (
    <nav className="review-flow-rail" aria-label={t("Primary workflow")}>
      {reviewTimeline(status).map((stage, index) => (
        <div className={`review-flow-step ${stage.state}`} key={stage.key}>
          <span>{index + 1}</span>
          <strong>{t(stageLabels[stage.key])}</strong>
          <em>{t(stateLabels[stage.state])}</em>
        </div>
      ))}
    </nav>
  );
}

function AiReviewProgressPanel({ minutes, job, onRefresh }: { minutes: number; job?: ReviewJob; onRefresh: () => void }) {
  const { t } = useI18n();
  const activeStep = job?.stage === "reporting" ? 3 : job?.stage === "analyzing" ? 2 : 1;
  const stageLabel = job?.stage === "queued" ? t("Queued for review") : job?.stage === "preparing" ? t("Preparing review") : job?.stage === "exporting" ? t("Exporting images") : job?.stage === "reporting" ? t("Generating report") : t("AI visual analysis");
  return (
    <section className="panel ai-progress-panel">
      <div>
        <div className="eyebrow">{t("Reviewing now")}</div>
        <h3>{t("AI review in progress")}</h3>
        <p><strong>{stageLabel}</strong>{job?.attempt ? ` · ${t("Attempt {attempt}", { attempt: job.attempt })}` : ""}</p>
        <p>{t("The system is analyzing selected images. This usually takes 1-3 minutes.")}</p>
        <p>{t("If it runs longer than a few minutes, refresh this page. Timed-out reviews will become retryable automatically.")}</p>
      </div>
      <div className="ai-progress-steps" aria-label={t("AI review in progress")}>
        <span className={activeStep === 1 ? "active" : ""}><b>{t("Step 1")}</b>{t("Image exported")}</span>
        <span className={activeStep === 2 ? "active" : ""}><b>{t("Step 2")}</b>{t("AI visual analysis")}</span>
        <span className={activeStep === 3 ? "active" : ""}><b>{t("Step 3")}</b>{t("Generating report")}</span>
      </div>
      <div className="ai-progress-actions">
        <span>{t("Started {minutes} min ago", { minutes })}</span>
        <button className="action-button" type="button" onClick={onRefresh}><RefreshCw size={15} />{t("Refresh status")}</button>
      </div>
    </section>
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
  const { t, label } = useI18n();
  return (
    <section className="issue-filter-bar">
      <select value={selectedRound} onChange={(event) => onRoundChange(event.target.value === "latest" ? "latest" : Number(event.target.value))}>
        <option value="latest">{t("Latest round")}</option>
        {rounds.map((round) => <option value={round} key={round}>{t("Round {round}", { round })}</option>)}
      </select>
      <select value={filters.frameName ?? ""} onChange={(event) => onChange({ ...filters, frameName: event.target.value })}>
        <option value="">{t("All Frames")}</option>
        {frames.map((frame) => <option value={frame.frameName} key={frame.id}>{frame.frameName}</option>)}
      </select>
      <select value={filters.type ?? ""} onChange={(event) => onChange({ ...filters, type: event.target.value })}>
        <option value="">{t("All types")}</option>
        <option value="品牌一致性">{label("品牌一致性")}</option>
        <option value="排版规范">{label("排版规范")}</option>
        <option value="电商表达">{label("电商表达")}</option>
        <option value="交付规范">{label("交付规范")}</option>
        <option value="设计系统纪律">{label("设计系统纪律")}</option>
      </select>
      <select value={filters.severity ?? ""} onChange={(event) => onChange({ ...filters, severity: event.target.value })}>
        <option value="">{t("All severities")}</option>
        <option value="严重">{label("严重")}</option>
        <option value="中等">{label("中等")}</option>
        <option value="轻微">{label("轻微")}</option>
        <option value="建议">{label("建议")}</option>
      </select>
      <div className="segmented">
        <button className={!filters.mustFixOnly ? "active" : ""} type="button" aria-pressed={!filters.mustFixOnly} onClick={() => onChange({ ...filters, mustFixOnly: false })}>{t("All issues")}</button>
        <button className={filters.mustFixOnly ? "active" : ""} type="button" aria-pressed={Boolean(filters.mustFixOnly)} onClick={() => onChange({ ...filters, mustFixOnly: true })}>{t("Must fix")}</button>
      </div>
    </section>
  );
}

function ScorePanel({ result, status, issues = [] }: { result: any; status?: ReviewStatus; issues?: Issue[] }) {
  const { t, label, dynamic, language } = useI18n();
  if (!result) return <section className="panel"><h3>{t("AI pre-review")}</h3><p className="meta">{t("No AI result yet.")}</p></section>;
  const scores = result.dimensionScores;
  const vetoIssues = result.rawAiResponse?.veto_issues ?? [];
  const mustFixCount = issues.filter((issue) => issue.mustFix).length;
  return (
    <section className="score-panel">
      <div className="score-hero">
        <div className="score-title">
          <span>{t("Decision summary")}</span>
          <em>{t("Pass rule: total score >= 85 and no veto issues.")}</em>
        </div>
        {status ? <span className={`status ${status}`}>{label(status)}</span> : null}
        <strong className={`score-value score-value--${scoreTone(result.totalScore)}`}>{result.totalScore}</strong>
      </div>
      <div className="score-signal-grid">
        <span><b>{issues.length}</b>{t("All issues")}</span>
        <span><b>{mustFixCount}</b>{t("Must fix")}</span>
      </div>
      <div className={`veto-strip ${vetoIssues.length ? "risk" : ""}`}>{vetoIssues.length ? t("Veto risk {count} items", { count: vetoIssues.length }) : t("No veto risk found")}</div>
      <section className="dimension-details" aria-label={t("Dimension evidence")}>
        <div className="dimension-details-heading">{t("Dimension evidence")}</div>
        <div className="dimension-grid">
          {Object.entries(scores).map(([key, value]: any) => {
            const rubric = aiRubric.find((item) => item.key === key);
            const rawLabel = rubric?.label ?? scoreName(key);
            const relatedIssues = issues.filter((issue) => issue.type === rawLabel);
            return (
              <div className="score-line" key={key}>
                <span>{label(rawLabel)}</span>
                <b>{value.score}/{value.max_score}</b>
                <p>{rubric?.definition ? t(rubric.definition) : ""}</p>
                <p>{reviewText(language, value.comment_i18n ?? value.commentI18n ?? value.i18n?.comment, value.comment)}</p>
                {value.deduction_items?.length ? <ul>{value.deduction_items.map((item: unknown, index: number) => <li key={`${key}-${index}`}>{reviewText(language, localizedArrayItem(value.deduction_items_i18n ?? value.deductionItemsI18n, index), formatDeductionItem(item))}</li>)}</ul> : <em>{t("No clear deduction items")}</em>}
                {relatedIssues.length ? (
                  <div className="score-issue-list">
                    <strong>{t("Related revision items")}</strong>
                    {relatedIssues.map((issue) => (
                      <article key={issue.id}>
                        <span>{displayIssueTitle(issue, language, dynamic)}</span>
                        <p>{localizedIssueText(issue, "description", language, dynamic)}</p>
                        <em>{localizedIssueText(issue, "suggestion", language, dynamic)}</em>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function IssueCard({ issue, index, annotationIndex, active, onFocus }: { issue: Issue; index: number; annotationIndex?: number; active?: boolean; onFocus?: () => void }) {
  const { t, label, dynamic, language } = useI18n();
  return (
    <article className={`issue ${issue.mustFix ? "must" : ""} ${active ? "active" : ""}`} onMouseEnter={onFocus} onFocus={onFocus} onClick={onFocus} tabIndex={0}>
      <div className="issue-top">
        <span className="issue-index">{index}</span>
        <strong>{displayIssueTitle(issue, language, dynamic)}</strong>
        <span className={`severity ${issue.severity}`}>{label(issue.severity)}</span>
      </div>
      <div className="issue-tags"><span>{label(issue.type)}</span>{issue.mustFix ? <span>{t("AI marks must fix")}</span> : <span>{t("AI suggests optimization")}</span>}{annotationIndex ? <span className="annotation-link">{t("Canvas annotation #{index}", { index: annotationIndex })}</span> : <span>{t("No canvas annotation")}</span>}</div>
      <dl>
        <dt>{t("Location")}</dt><dd>{annotationIndex ? t("See canvas annotation #{index}", { index: annotationIndex }) : (issue.frameName || "--")} · {issue.locationDescription ? localizedIssueText(issue, "locationDescription", language, dynamic) : t("Unspecified area")}</dd>
        <dt>{t("Judgment")}</dt><dd>{localizedIssueText(issue, "description", language, dynamic)}</dd>
        <dt>{t("Revision suggestion")}</dt><dd>{localizedIssueText(issue, "suggestion", language, dynamic)}</dd>
        <dt>{t("Basis")}</dt><dd>{localizedIssueText(issue, "relatedStandardSection", language, dynamic)}</dd>
      </dl>
    </article>
  );
}

function displayIssueTitle(issue: Issue, language: Language, dynamic: (value: unknown) => string) {
  const title = localizedIssueText(issue, "title", language, dynamic);
  if (title && title !== "未命名问题" && title !== "Untitled issue") return title;
  const source = [localizedIssueText(issue, "description", language, dynamic), localizedIssueText(issue, "suggestion", language, dynamic), localizedIssueText(issue, "locationDescription", language, dynamic)].find((value) => String(value ?? "").trim());
  const localized = dynamic(source ?? issue.title);
  const sentence = localized.split(/[.。；;]/).find(Boolean)?.trim();
  if (sentence && sentence !== "Untitled issue" && !hasHanText(sentence)) return sentence.slice(0, 96);
  return dynamic("未命名问题");
}

function localizedIssueText(issue: Issue, field: keyof NonNullable<Issue["i18n"]>, language: Language, dynamic: (value: unknown) => string) {
  const fallbackKey = field === "locationDescription" ? "locationDescription" : field === "relatedStandardSection" ? "relatedStandardSection" : field;
  return reviewText(language, issue.i18n?.[field], issue[fallbackKey as keyof Issue]);
}

function AnnotationBox({ issue, index, active, onFocus }: { issue: Issue; index: number; active?: boolean; onFocus?: () => void }) {
  const { dynamic, language } = useI18n();
  const a = issue.annotationSuggestion!;
  const left = Math.min(98, Math.max(0, a.xPercent));
  const top = Math.min(98, Math.max(0, a.yPercent));
  const minimumSize = a.type === "point" ? 12 : 6;
  const width = Math.min(100 - left, Math.max(a.widthPercent ?? minimumSize, minimumSize));
  const height = Math.min(100 - top, Math.max(a.heightPercent ?? minimumSize, minimumSize));
  const broad = width >= 88 && height >= 88;
  const pinX = Math.min(96, Math.max(4, a.xPercent + width / 2));
  const pinY = Math.min(96, Math.max(4, a.yPercent + height / 2));
  const noteX = Math.min(72, Math.max(2, left));
  const noteY = Math.max(2, top - 9);
  const title = displayIssueTitle(issue, language, dynamic);
  const suggestion = localizedIssueText(issue, "suggestion", language, dynamic);
  return (
    <>
      <span aria-hidden="true" className={`annotation-region ${issue.severity} ${active ? "active" : ""} ${broad ? "broad" : ""}`} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
        <span>{index}</span>
      </span>
      <button title={title} className={`annotation-note ${issue.severity} ${active ? "active" : ""}`} type="button" onMouseEnter={onFocus} onFocus={onFocus} style={{ left: `${noteX}%`, top: `${noteY}%` }}>
        <strong>{index}. {title}</strong>
        <em>{suggestion}</em>
      </button>
      <button aria-label={title} title={title} className={`annotation-pin ${issue.severity} ${active ? "active" : ""}`} type="button" onMouseEnter={onFocus} onFocus={onFocus} style={{ left: `${pinX}%`, top: `${pinY}%` }}>{index}</button>
    </>
  );
}

function VisPage({ session }: { session: Session }) {
  const { t } = useI18n();
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
      setActionError(err instanceof Error ? err.message : t("Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace">
      <section className="panel vis-source-panel">
        <div>
          <div className="eyebrow">{t("STANDARD SOURCE")}</div>
          <h2>{data?.fileName ?? "品牌设计规范.md"}</h2>
          <p>{t("The AI pre-review sends these Markdown sections as the only VIS standard source and requires the vision model to understand, cite, and apply them one by one.")}</p>
          <div className="source-meta"><span>{data?.path ?? t("Path not loaded")}</span><span>{data?.sections?.length ?? 0} sections</span></div>
          <div className="vis-actions">
            <label className="file-picker">{t("Upload standard source")}<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(event) => pickFile(event.target.files?.[0])} /></label>
            <button className="primary" type="button" disabled={busy || !draft.trim()} onClick={upload}>{busy ? t("Analyzing...") : t("Analyze standard source")} <UploadCloud size={15} /></button>
          </div>
        </div>
        <div className="upload-box">
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder={t("File name")} />
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="# EMKE VIS Standard..." />
          {(error || actionError) && <div className="error">{error || actionError}</div>}
        </div>
      </section>
      <div className="section-list compact-sections">{data?.sections?.map((section: any) => <article className="panel standard-card" key={section.id}><div className="eyebrow">{section.ruleType}</div><h3>{section.title}</h3>{section.content ? <p>{compactPreview(section.content)}</p> : <span className="meta">{t("Title-only section")}</span>}</article>)}</div>
    </main>
  );
}

function SettingsPage({ session }: { session: Session }) {
  const { t, label } = useI18n();
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
      setActionError(err instanceof Error ? err.message : t("Save failed"));
    } finally {
      setBusy(false);
    }
  }

  if (error && error.includes("无权")) {
    return (
      <main className="workspace narrow settings-page">
        <header className="settings-page-head">
          <div className="eyebrow">{t("SERVER CONFIG")}</div>
          <h2>{t("System settings")}</h2>
        </header>
        <section className="panel form-panel settings-panel">
          <div className="eyebrow">{t("ACCESS")}</div>
          <h3>{t("Only admins can edit system settings")}</h3>
          <p className="meta">{t("Current role: {role}. Use an admin role to update AI Key, model, or VIS configuration.", { role: label(session.role) })}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace narrow settings-page">
      <header className="settings-page-head">
        <div className="eyebrow">{t("SERVER CONFIG")}</div>
        <h2>{t("System settings")}</h2>
      </header>
      <div className="settings-workspace">
      <section className="panel form-panel settings-panel">
        <div className="eyebrow">{t("SERVER CONFIG")}</div>
        {(error || actionError) && <div className="error">{error || actionError}</div>}
        <Setting label="Figma Token" value={data?.figmaTokenConfigured ? t("Configured") : t("FIGMA_TOKEN not configured")} />
        <Setting label="AI API Key" value={data?.aiProvider?.configured ? `${t("Configured")} ${data?.aiProvider?.keyPreview ?? ""}` : t("Key not configured, local placeholder review is used")} />
        <Setting label={t("Current source")} value={data?.aiProvider?.source === "env" ? t("Environment variables") : data?.aiProvider?.source === "runtime" ? t("Runtime config") : t("System preset")} />
        <Setting label={t("Max Frame count")} value={data?.maxFramesPerTask} />
        <Setting label={t("Max upload image count")} value={data?.maxUploadImagesPerTask} />
        <Setting label={t("VIS standard source path")} value={data?.brandStandardPath} />
      </section>
      <form className="panel form-panel settings-panel ai-config-form" onSubmit={saveConfig}>
        <div className="panel-head"><h3><KeyRound size={15} /> {t("AI model endpoint")}</h3><span>{data?.aiProvider?.model ?? "--"}</span></div>
        <label>{t("Provider name")}<input value={form.providerName} onChange={(event) => setForm({ ...form, providerName: event.target.value })} /></label>
        <label>Base URL<input value={form.baseURL} onChange={(event) => setForm({ ...form, baseURL: event.target.value })} /></label>
        <label>{t("Model")}<input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></label>
        <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={t("Enter a new Key to save; the full Key will not be shown in the frontend")} /></label>
        <button className="primary" type="submit" disabled={busy}>{busy ? t("Saving...") : t("Save AI config")}</button>
      </form>
      </div>
    </main>
  );
}

function Metric({ label, value, accent, tone = "live" }: { label: string; value: number; accent?: string; tone?: "live" | "revision" | "success" | "queue" | "danger" | "score" }) {
  return (
    <div className={`metric metric--${tone}`}>
      <div className="metric-body">
        <div className="metric-head"><span>{label}</span>{accent ? <em>{accent}</em> : null}</div>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function Setting({ label, value }: { label: string; value: any }) {
  return <div className="setting"><span>{label}</span><strong>{value ?? "--"}</strong></div>;
}

function scoreName(key: string) {
  return ({ brand_consistency: "品牌一致性", layout_standard: "排版规范", ecommerce_expression: "电商表达", delivery_standard: "交付规范", design_system_discipline: "设计系统纪律" } as Record<string, string>)[key] ?? key;
}

function compactFrameLabel(name: string) {
  const trimmed = name.trim();
  if (trimmed.length <= 18) return trimmed || "--";
  const extension = trimmed.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
  const base = extension ? trimmed.slice(0, -extension.length) : trimmed;
  if (base.length <= 18) return trimmed;
  return extension ? `${base.slice(0, 8)}...${base.slice(-4)}${extension}` : `${trimmed.slice(0, 10)}...${trimmed.slice(-5)}`;
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

function readImageDraft(file: File, errorMessage = "图片读取失败"): Promise<UploadedImageDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(errorMessage));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(errorMessage));
        return;
      }
      resolve({
        id: `${file.name}_${file.size}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        mimeType: file.type,
        dataUrl: reader.result,
        size: file.size
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function api<T>(url: string, session: Session, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.accessCode) {
    headers["x-access-code"] = encodeHeaderValue(session.accessCode);
    headers["x-actor-name"] = encodeHeaderValue(session.name);
    headers["x-actor-role"] = encodeHeaderValue(session.role);
    headers["x-actor-id"] = encodeHeaderValue(session.userId ?? session.name);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("emke-session");
    window.dispatchEvent(new Event("emke-session-expired"));
  }
  if (!response.ok) throw new Error(json.error ?? "请求失败");
  return json;
}

function useApi<T>(url: string, session: Session, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const reload = React.useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const nextData = await api<T>(url, session);
      if (requestId === requestIdRef.current) setData(nextData);
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : "请求失败");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [url, session]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, error, reload };
}

const rootElement = document.getElementById("root")!;
const appRoot = ((globalThis as any).__emkeReviewRoot ??= createRoot(rootElement));
appRoot.render(<App />);
