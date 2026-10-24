import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  Clock3,
  Code2,
  Command,
  Compass,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Filter,
  FolderOpen,
  Gauge,
  LayoutTemplate,
  Library,
  ListTodo,
  Loader2,
  LockKeyhole,
  Menu,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  PenLine,
  PlugZap,
  Plus,
  RefreshCcw,
  Search,
  SearchX,
  Send,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  WandSparkles,
  WifiOff,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SKILLS, type CurialySkill } from "@shared/skills";
import {
  defaultPreferences,
  formatRelativeTime,
  readPreferences,
  readTasks,
  skillName,
  type LocalTask,
  type Preferences,
  writePreferences,
  writeTasks,
} from "@/lib/curialy";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const iconMap: Record<string, LucideIcon> = {
  search: Search,
  code: Code2,
  brain: Brain,
  chart: BarChart3,
  pen: PenLine,
  file: FileText,
};

const navItems = [
  { label: "New Task", href: "/", icon: Plus },
  { label: "Discover", href: "/discover", icon: Compass },
  { label: "My Tasks", href: "/tasks", icon: ListTodo },
  { label: "Skills", href: "/skills", icon: Sparkles },
  { label: "Library", href: "/library", icon: Library },
  { label: "Creations", href: "/creations", icon: FileCode2 },
  { label: "Automations", href: "/automations", icon: Workflow },
  { label: "Integrations", href: "/integrations", icon: PlugZap },
  { label: "Settings", href: "/settings", icon: Settings2 },
];

const quickActions = [
  { title: "Research a Topic", description: "Find sources and summarize important findings.", icon: Search, prompt: "Research this topic with a concise, source-aware summary: " },
  { title: "Build a Website", description: "Turn ideas into functional web applications.", icon: LayoutTemplate, prompt: "Help me plan and build a functional website for: " },
  { title: "Analyze Documents", description: "Extract important information and insights.", icon: FileText, prompt: "Analyze the key facts, decisions, and open questions in this document: " },
  { title: "Create Content", description: "Write, edit, and improve your content.", icon: PenLine, prompt: "Create a polished piece of content about: " },
];

const demoActivity = [
  { icon: Plus, tone: "violet", title: "Workspace ready", detail: "Create your first task to start an activity trail.", time: "now" },
  { icon: ShieldCheck, tone: "mint", title: "Privacy boundary active", detail: "Provider keys stay on the server.", time: "always" },
];

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/discover" component={DiscoverPage} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/tasks/:id" component={TaskDetailPage} />
      <Route path="/skills" component={SkillsPage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/creations" component={CreationsPage} />
      <Route path="/automations" component={AutomationsPage} />
      <Route path="/integrations" component={IntegrationsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFoundPage} />
    </Switch>
  );
}

function AppShell({ children, title, eyebrow }: { children: React.ReactNode; title?: string; eyebrow?: string }) {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = trpc.integrations.health.useQuery(undefined, { staleTime: 30_000 });
  const prefs = usePreferences();
  const providerReady = health.data?.provider === "configured";

  useEffect(() => setMobileOpen(false), [location]);

  return (
    <div className="app-frame">
      <div className={`mobile-scrim ${mobileOpen ? "is-open" : ""}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <button className="brand" onClick={() => navigate("/")} aria-label="Go to Curialy home">
            <span className="brand-mark"><span /><span /><span /></span>
            <span className="brand-word">Curialy</span>
          </button>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
          <button className="workspace-switcher" aria-label="Select workspace">
            <span className="workspace-avatar">P</span>
            <span className="workspace-copy"><strong>Personal workspace</strong><small>Private</small></span>
            <ChevronDown size={15} />
          </button>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.slice(0, 4).map(item => <NavItem key={item.href} item={item} active={location === item.href || (item.href === "/tasks" && location.startsWith("/tasks/"))} onNavigate={navigate} />)}
          <p className="nav-label nav-label-spaced">Organize</p>
          {navItems.slice(4, 7).map(item => <NavItem key={item.href} item={item} active={location === item.href} onNavigate={navigate} />)}
          <p className="nav-label nav-label-spaced">System</p>
          {navItems.slice(7).map(item => <NavItem key={item.href} item={item} active={location === item.href} onNavigate={navigate} />)}
        </nav>
        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-heading"><span>Workspace pulse</span><span className="tiny-status"><span /> local</span></div>
            <div className="usage-bar"><span style={{ width: "28%" }} /></div>
            <p>Browser-local persistence is active.</p>
          </div>
          <button className="profile-row" onClick={() => navigate("/settings")}>
            <span className="profile-avatar">JD</span>
            <span className="profile-copy"><strong>Jordan Doe</strong><small>Personal account</small></span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div className="breadcrumb"><span>Curialy AI</span>{title && <><span className="breadcrumb-slash">/</span><strong>{title}</strong></>}</div>
          </div>
          <div className="topbar-controls">
            <ModelControl prefs={prefs} />
            <ToggleControl label="Think" icon={Brain} checked={prefs.value.think} onChange={value => prefs.setPrefs({ ...prefs.value, think: value })} />
            <ToggleControl label="Web Search" icon={Search} checked={prefs.value.webSearch} onChange={value => prefs.setPrefs({ ...prefs.value, webSearch: value })} />
            <button className="icon-button" aria-label="Voice input" title="Voice input is available as a browser fallback"><Mic size={17} /></button>
            <span className="shortcut-hint"><Command size={13} /> K</span>
            <span className={`health-chip ${providerReady ? "ready" : "attention"}`} title={providerReady ? "Server-side model provider configured" : "Provider credentials are missing"}><span /> {providerReady ? "Ready" : "Setup needed"}</span>
            <button className="avatar-button" aria-label="Account menu">JD</button>
          </div>
        </header>
        <main className="main-scroll">
          {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({ item, active, onNavigate }: { item: typeof navItems[number]; active: boolean; onNavigate: (path: string) => void }) {
  const Icon = item.icon;
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={() => onNavigate(item.href)}><Icon size={17} /><span>{item.label}</span>{item.label === "Skills" && <span className="nav-count">6</span>}</button>;
}

function ModelControl({ prefs }: { prefs: ReturnType<typeof usePreferences> }) {
  return <div className="model-control"><span className="model-dot" /><select value={prefs.value.model} onChange={event => prefs.setPrefs({ ...prefs.value, model: event.target.value })} aria-label="Select model"><option value="gemini-3-flash-preview">Gemini 3 Flash</option><option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option></select><ChevronDown size={13} /></div>;
}

function ToggleControl({ label, icon: Icon, checked, onChange }: { label: string; icon: LucideIcon; checked: boolean; onChange: (value: boolean) => void }) {
  return <button className={`toggle-control ${checked ? "checked" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked}><Icon size={15} /><span>{label}</span><span className="toggle-dot" /></button>;
}

function DashboardPage() {
  const [location, navigate] = useLocation();
  const [draft, setDraft] = useState("");
  const [lastCreated, setLastCreated] = useState<LocalTask | null>(null);
  const tasks = useLocalTasks();
  const prefs = usePreferences();
  const skillsQuery = trpc.skills.list.useQuery();
  const skills = skillsQuery.data ?? SKILLS;

  const createTask = trpc.tasks.create.useMutation();
  const handleSubmit = async (prompt: string, composerPrefs: Preferences) => {
    const clean = prompt.trim();
    if (!clean || createTask.isPending) return;
    const id = crypto.randomUUID();
    const queued: LocalTask = { id, prompt: clean, createdAt: new Date().toISOString(), status: "running", model: composerPrefs.model, think: composerPrefs.think, webSearch: composerPrefs.webSearch };
    tasks.add(queued);
    setLastCreated(queued);
    try {
      const result = await createTask.mutateAsync({ clientId: id, prompt: clean, model: composerPrefs.model, think: composerPrefs.think, webSearch: composerPrefs.webSearch });
      const finished: LocalTask = { ...queued, status: result.provider === "local-demo" && result.limitation && !result.answer ? "failed" : "completed", answer: result.answer, plan: result.plan, skillsUsed: result.skillsUsed, provider: result.provider, limitation: result.limitation };
      tasks.update(finished);
      setLastCreated(finished);
      navigate(`/tasks/${id}`);
    } catch (error) {
      const failed: LocalTask = { ...queued, status: "failed", limitation: error instanceof Error ? error.message : "Request failed." };
      tasks.update(failed);
      setLastCreated(failed);
    }
  };

  useEffect(() => {
    if (location === "/" && lastCreated?.status === "completed") setLastCreated(null);
  }, [location, lastCreated]);

  return <AppShell>
    <div className="dashboard-grid">
      <section className="workspace-column">
        <div className="hero-intro">
          <div className="eyebrow-pill"><span /> YOUR AGENT WORKSPACE</div>
          <h1>What would you like to <em>accomplish?</em></h1>
          <p>Tell Curialy what you need. Your AI agent can plan, research, create, and work through complex tasks.</p>
        </div>
        <TaskComposer value={draft} onChange={setDraft} preferences={prefs.value} onPreferencesChange={prefs.setPrefs} onSubmit={handleSubmit} pending={createTask.isPending} />
        {lastCreated?.status === "failed" && <div className="inline-alert error"><CircleAlert size={17} /><span>{lastCreated.limitation ?? "Something went wrong."}</span><button onClick={() => setDraft(lastCreated.prompt)}>Restore prompt</button></div>}
        <section className="section-block quick-section">
          <SectionHeader eyebrow="SHORTCUTS" title="Quick actions" action="Browse templates" onAction={() => navigate("/discover")} />
          <div className="quick-grid">{quickActions.map(action => <QuickActionCard key={action.title} {...action} onClick={() => setDraft(action.prompt)} />)}</div>
        </section>
        <section className="section-block">
          <SectionHeader eyebrow="CAPABILITIES" title="Curialy Skills" description="Give your AI agent the capabilities it needs to get work done." action="Explore Skills" onAction={() => navigate("/skills")} />
          <div className="skills-grid">{skills.map(skill => <SkillCard key={skill.id} skill={skill} compact />)}</div>
        </section>
      </section>
      <RightRail tasks={tasks.items} skills={skills} onOpenTask={id => navigate(`/tasks/${id}`)} />
    </div>
  </AppShell>;
}

function TaskComposer({ value, onChange, preferences, onPreferencesChange, onSubmit, pending }: { value: string; onChange: (value: string) => void; preferences: Preferences; onPreferencesChange: (value: Preferences) => void; onSubmit: (value: string, preferences: Preferences) => void; pending: boolean }) {
  const submit = () => { if (value.trim()) onSubmit(value, preferences); };
  return <div className={`composer ${pending ? "is-pending" : ""}`}>
    <div className="composer-glow" />
    <label htmlFor="task-prompt" className="sr-only">Describe a task for Curialy</label>
    <textarea id="task-prompt" value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask Curialy anything or describe a task to get started…" disabled={pending} />
    <div className="composer-footer">
      <div className="composer-tools">
        <button className="composer-tool" aria-label="Attach a file" title="Attach a file"><Paperclip size={17} /><span>Attach</span></button>
        <button className="composer-tool" aria-label="Voice input" title="Voice input requires microphone permission"><Mic size={17} /></button>
        <span className="tool-divider" />
        <ToggleControl label="Think" icon={Brain} checked={preferences.think} onChange={checked => onPreferencesChange({ ...preferences, think: checked })} />
        <ToggleControl label="Search" icon={Search} checked={preferences.webSearch} onChange={checked => onPreferencesChange({ ...preferences, webSearch: checked })} />
      </div>
      <div className="composer-submit"><span className="enter-hint">Enter to send</span><button className="start-button" onClick={submit} disabled={pending || !value.trim()}>{pending ? <Loader2 className="spin" size={17} /> : <ArrowUp size={17} />}<span>{pending ? "Working" : "Start Task"}</span></button></div>
    </div>
  </div>;
}

function QuickActionCard({ title, description, icon: Icon, onClick }: { title: string; description: string; icon: LucideIcon; prompt: string; onClick: () => void }) {
  return <button className="quick-card" onClick={onClick}><span className="quick-icon"><Icon size={18} /></span><span className="quick-copy"><strong>{title}</strong><small>{description}</small></span><ArrowRight className="quick-arrow" size={16} /></button>;
}

function SectionHeader({ eyebrow, title, description, action, onAction }: { eyebrow: string; title: string; description?: string; action?: string; onAction?: () => void }) {
  return <div className="section-header"><div><div className="section-eyebrow">{eyebrow}</div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <button className="text-link" onClick={onAction}>{action}<ArrowRight size={14} /></button>}</div>;
}

function SkillCard({ skill, compact = false, onToggle }: { skill: CurialySkill; compact?: boolean; onToggle?: (skill: CurialySkill) => void }) {
  const Icon = iconMap[skill.icon] ?? Sparkles;
  const unavailable = skill.availability === "needs_configuration";
  return <article className={`skill-card ${compact ? "compact" : ""}`}>
    <div className="skill-card-top"><span className={`skill-icon ${skill.accent}`}><Icon size={18} /></span><span className={`availability ${skill.availability}`}><span />{skill.enabled ? (unavailable ? "Needs setup" : "Enabled") : "Disabled"}</span></div>
    <h3>{skill.name}</h3><p>{skill.description}</p>
    {!compact && <><div className="skill-meta"><span>v{skill.version}</span><span>{skill.category}</span></div><div className="skill-tools">{skill.requiredTools.map(tool => <span key={tool}>{tool}</span>)}</div>{onToggle && <button className={`skill-toggle ${skill.enabled ? "on" : ""}`} onClick={() => onToggle(skill)}>{skill.enabled ? <><Check size={14} /> Enabled</> : "Enable skill"}</button>}</>}
  </article>;
}

function RightRail({ tasks, skills, onOpenTask }: { tasks: LocalTask[]; skills: CurialySkill[]; onOpenTask: (id: string) => void }) {
  return <aside className="right-rail">
    <div className="rail-panel"><div className="rail-header"><div><div className="section-eyebrow">WORKSPACE</div><h2>Recent Tasks</h2></div><a href="/tasks" className="rail-link">View all</a></div>
      {tasks.length === 0 ? <EmptyRail icon={ListTodo} title="No tasks yet" detail="Your real tasks will appear here." /> : <div className="recent-list">{tasks.slice(0, 4).map(task => <button className="recent-task" key={task.id} onClick={() => onOpenTask(task.id)}><span className="recent-task-icon"><MessageSquare size={15} /></span><span className="recent-task-copy"><strong>{task.prompt}</strong><small><TaskStatus status={task.status} /> {formatRelativeTime(task.createdAt)}</small></span><ArrowRight size={14} /></button>)}</div>}
    </div>
    <div className="rail-panel activity-panel"><div className="rail-header"><div><div className="section-eyebrow">AUDIT TRAIL</div><h2>Workspace Activity</h2></div><Activity size={16} className="muted-icon" /></div><div className="activity-list">{tasks.length === 0 ? demoActivity.map(event => <ActivityRow key={event.title} {...event} />) : tasks.slice(0, 4).flatMap(task => [{ icon: task.status === "completed" ? CheckCircle2 : Clock3, tone: task.status === "completed" ? "mint" : "violet", title: task.status === "completed" ? "Task completed" : "Task in progress", detail: task.prompt, time: formatRelativeTime(task.createdAt) }]).map(event => <ActivityRow key={`${event.title}-${event.detail}`} {...event} />)}</div></div>
    <div className="rail-note"><Sparkles size={16} /><div><strong>Small steps, visible progress.</strong><p>Curialy keeps the work legible: plan, run, review.</p></div></div>
  </aside>;
}

function ActivityRow({ icon: Icon, tone, title, detail, time }: { icon: LucideIcon; tone: string; title: string; detail: string; time: string }) { return <div className="activity-row"><span className={`activity-icon ${tone}`}><Icon size={14} /></span><span className="activity-copy"><strong>{title}</strong><small>{detail}</small></span><time>{time}</time></div>; }
function EmptyRail({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) { return <div className="empty-rail"><Icon size={20} /><strong>{title}</strong><p>{detail}</p></div>; }
function TaskStatus({ status }: { status: LocalTask["status"] }) { const label = status === "completed" ? "Completed" : status === "failed" ? "Needs retry" : status[0].toUpperCase() + status.slice(1); return <span className={`task-status ${status}`}><span />{label}</span>; }

function PageFrame({ title, eyebrow, children, action }: { title: string; eyebrow: string; children: React.ReactNode; action?: React.ReactNode }) { return <AppShell title={title}><div className="page-head"><div><div className="section-eyebrow">{eyebrow}</div><h1>{title}</h1></div>{action}</div>{children}</AppShell>; }

function SkillsPage() {
  const query = trpc.skills.list.useQuery();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const skills = query.data ?? SKILLS;
  const filtered = skills.filter(skill => (category === "all" || skill.category === category) && `${skill.name} ${skill.description}`.toLowerCase().includes(search.toLowerCase()));
  return <PageFrame title="Curialy Skills" eyebrow="CAPABILITY REGISTRY" action={<button className="outline-button"><Sparkles size={15} /> Explore capabilities</button>}><div className="page-intro">Give your AI agent the capabilities it needs to get work done. Each skill is a typed capability with a clear availability state.</div><div className="toolbar"><div className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search skills" aria-label="Search skills" /></div><div className="filter-pills"><button className={category === "all" ? "selected" : ""} onClick={() => setCategory("all")}>All</button>{["research", "engineering", "reasoning", "analysis", "communication", "documents"].map(item => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><Filter size={17} className="muted-icon" /></div><div className="skills-page-grid">{filtered.map(skill => <SkillCard key={skill.id} skill={{ ...skill, enabled: enabled[skill.id] ?? skill.enabled }} onToggle={value => setEnabled(current => ({ ...current, [value.id]: !(enabled[value.id] ?? value.enabled) }))} />)}</div>{filtered.length === 0 && <EmptyState icon={SearchX} title="No matching skills" detail="Try a broader search or clear the category filter." />}</PageFrame>;
}

function DiscoverPage() { const [, navigate] = useLocation(); return <PageFrame title="Discover" eyebrow="START WITH A PATTERN"><div className="page-intro">A few useful starting points for turning a messy idea into a clear next step.</div><div className="discover-grid">{quickActions.concat([{ title: "Plan a Decision", description: "Map constraints, options, and trade-offs.", icon: Brain, prompt: "Help me think through this decision: " }]).map(item => <button key={item.title} className="discover-card" onClick={() => navigate(`/?prompt=${encodeURIComponent(item.prompt)}`)}><span className="quick-icon"><item.icon size={19} /></span><div><h3>{item.title}</h3><p>{item.description}</p></div><ArrowRight size={16} /></button>)}</div><div className="callout-card"><WandSparkles size={20} /><div><strong>Good tasks have a visible outcome.</strong><p>Start with the result you want, add any constraints, and let Curialy propose a bounded path.</p></div></div></PageFrame>; }

function TasksPage() { const localTasks = useLocalTasks(); const serverTasks = trpc.tasks.list.useQuery(undefined, { refetchInterval: 5000 }); const [filter, setFilter] = useState("all"); const [, navigate] = useLocation(); const items = (serverTasks.data?.tasks as LocalTask[] | undefined) ?? localTasks.items; const visible = items.filter(task => filter === "all" || task.status === filter); return <PageFrame title="My Tasks" eyebrow="TASK HISTORY" action={<button className="primary-button" onClick={() => navigate("/")}><Plus size={16} /> New task</button>}><div className="page-intro">Open, review, and retry the work you have started across this Curialy workspace.</div><div className="toolbar"><div className="filter-pills"><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>All</button>{["completed", "running", "failed"].map(item => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><span className="local-badge"><Database size={14} /> SQLite workspace history</span></div>{visible.length === 0 ? <EmptyState icon={ListTodo} title="No saved tasks" detail="Create a task from the dashboard and it will appear here." /> : <div className="task-table">{visible.map(task => <div className="task-row" key={task.id} onClick={() => navigate(`/tasks/${task.id}`)}><span className="recent-task-icon"><MessageSquare size={15} /></span><div className="task-row-copy"><strong>{task.prompt}</strong><small>{task.model === "auto" ? "Gemini Auto" : task.model} · {formatRelativeTime(task.createdAt)}</small></div><TaskStatus status={task.status} /><ArrowRight size={15} /></div>)}</div>}</PageFrame>; }

function TaskDetailPage({ params }: { params: { id: string } }) { const localTasks = useLocalTasks(); const serverTask = trpc.tasks.get.useQuery({ id: params.id }, { refetchInterval: 3000 }); const removeTask = trpc.tasks.remove.useMutation(); const [, navigate] = useLocation(); const task = (serverTask.data as LocalTask | null | undefined) ?? localTasks.items.find(item => item.id === params.id); const [followUp, setFollowUp] = useState(""); if (!task) return <PageFrame title="Task not found" eyebrow="TASK WORKSPACE"><EmptyState icon={SearchX} title="This task is not in workspace history" detail="It may have been deleted or the server is still starting." /><button className="outline-button" onClick={() => navigate("/")}>Back to dashboard</button></PageFrame>; return <PageFrame title="Task workspace" eyebrow="TASK DETAIL" action={<button className="outline-button" onClick={() => navigate("/")}><Plus size={15} /> New task</button>}><div className="task-detail-layout"><section className="task-main-card"><div className="task-title-row"><div><TaskStatus status={task.status} /><h2>{task.prompt}</h2><p>Created {formatRelativeTime(task.createdAt)} · {task.provider === "platform-llm" ? "Server-side provider" : "Local configuration mode"}</p></div><button className="icon-button" aria-label="More task actions"><MoreHorizontal size={18} /></button></div><div className="task-plan"><div className="detail-label">PLAN</div>{(task.plan ?? ["Preparing task plan.", "Running selected capabilities.", "Reviewing result."]).map((step, index) => <div className="plan-step" key={step}><span className={index < (task.status === "completed" ? 3 : 1) ? "done" : "pending"}>{index < (task.status === "completed" ? 3 : 1) ? <Check size={13} /> : index + 1}</span><span>{step}</span></div>)}</div><div className="result-block"><div className="detail-label">RESULT</div>{task.answer ? <p className="result-copy">{task.answer}</p> : <div className="result-empty"><Loader2 className="spin" size={18} /> Waiting for a result…</div>}{task.limitation && <div className="inline-alert warning"><CircleAlert size={16} /><span>{task.limitation}</span></div>}</div><div className="skills-used"><div className="detail-label">SKILLS USED</div><div className="skill-tags">{(task.skillsUsed ?? []).map(id => <span key={id}><Sparkles size={13} />{skillName(id, SKILLS)}</span>)}</div></div><div className="followup-box"><textarea value={followUp} onChange={event => setFollowUp(event.target.value)} placeholder="Ask a follow-up about this task…" /><button aria-label="Send follow-up" disabled={!followUp.trim()}><Send size={16} /></button></div></section><aside className="task-side-card"><div className="detail-label">TASK CONTEXT</div><div className="context-row"><span>Model</span><strong>{task.model === "auto" ? "Gemini Auto" : task.model}</strong></div><div className="context-row"><span>Think mode</span><strong>{task.think ? "On" : "Off"}</strong></div><div className="context-row"><span>Web Search</span><strong>{task.webSearch ? "Requested" : "Off"}</strong></div><div className="context-row"><span>Persistence</span><strong>SQLite workspace</strong></div><div className="side-divider" /><button className="side-action" onClick={() => navigator.clipboard?.writeText(task.answer ?? task.prompt)}><Copy size={15} /> Copy result</button><button className="side-action" onClick={() => navigate("/")}><RefreshCcw size={15} /> Retry from composer</button><button className="side-action danger" onClick={() => { removeTask.mutate({ id: task.id }); localTasks.remove(task.id); navigate("/tasks"); }}><Trash2 size={15} /> Delete task</button></aside></div></PageFrame>; }

function LibraryPage() { const [files, setFiles] = useState<Array<{ id: string; filename: string; sizeBytes: number; status: string }>>([]); const [error, setError] = useState(""); const refresh = async () => { const res = await fetch("/api/files"); if (res.ok) setFiles((await res.json()).files ?? []); }; useEffect(() => { refresh(); }, []); const upload = async (file: File) => { setError(""); const body = new FormData(); body.append("file", file); const res = await fetch("/api/files", { method: "POST", body }); const data = await res.json(); if (!res.ok) { setError(data.error ?? "Upload failed."); return; } await refresh(); }; const remove = async (id: string) => { await fetch(`/api/files/${id}`, { method: "DELETE" }); await refresh(); }; return <PageFrame title="Library" eyebrow="YOUR SOURCE MATERIAL"><div className="page-intro">Keep supported documents close to the work. Files are stored on the Curialy server and ready for document analysis.</div><label className="upload-drop"><input type="file" accept=".txt,.pdf,.docx,.csv,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /><UploadIcon /><strong>Drop a document here or browse</strong><span>TXT, PDF, DOCX, CSV, or JSON · up to 10 MB per file</span></label>{error && <div className="inline-alert error"><CircleAlert size={16} />{error}</div>}{files.length === 0 ? <EmptyState icon={FolderOpen} title="Your library is empty" detail="Add a file when you are ready to analyze it." /> : <div className="file-list">{files.map(file => <div className="file-row" key={file.id}><FileText size={18} /><div><strong>{file.filename}</strong><small>{Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {file.status}</small></div><button className="icon-button" aria-label={`Remove ${file.filename}`} onClick={() => void remove(file.id)}><Trash2 size={15} /></button></div>)}</div>}</PageFrame>; }
function UploadIcon() { return <span className="upload-icon"><Download size={22} /></span>; }
function CreationsPage() { return <PageFrame title="Creations" eyebrow="OUTPUTS"><div className="page-intro">Generated documents, reports, and code artifacts will collect here once a task produces them.</div><EmptyState icon={FileCode2} title="No creations yet" detail="Complete a task that produces an artifact to see it here." /> </PageFrame>; }
function AutomationsPage() { return <PageFrame title="Automations" eyebrow="REPEATABLE WORK"><div className="page-intro">Automations need durable scheduling and approval boundaries before they can run safely.</div><div className="planned-card"><CircleDashed size={22} /><div><h3>Scheduled tasks are planned</h3><p>This first workspace slice does not present a switch that would imply a scheduler is running. We will add supported automations when the execution contract is connected.</p></div><span className="planned-badge">Planned</span></div></PageFrame>; }
function IntegrationsPage() { const health = trpc.integrations.health.useQuery(); const items = [{ name: "Curialy model provider", icon: ServerCog, status: health.data?.provider === "configured" ? "Configured" : "Missing credentials", tone: health.data?.provider === "configured" ? "good" : "warn", detail: "Server-only chat completion surface" }, { name: "Grounded Web Search", icon: Search, status: "Not connected", tone: "muted", detail: "Citations will only appear from genuine provider metadata" }, { name: "Voice sessions", icon: Mic, status: "Fallback available", tone: "good", detail: "Explicit browser permission required" }, { name: "Task persistence", icon: Database, status: health.data?.persistence === "database_available" ? "Database available" : "Browser-local", tone: "muted", detail: "Private ownership migration remains to be connected" }]; return <PageFrame title="Integrations" eyebrow="SYSTEM HEALTH"><div className="page-intro">A truthful view of what Curialy can use in this environment.</div><div className="integration-list">{items.map(item => <div className="integration-row" key={item.name}><span className="integration-icon"><item.icon size={19} /></span><div className="integration-copy"><strong>{item.name}</strong><small>{item.detail}</small></div><span className={`integration-status ${item.tone}`}><span />{item.status}</span><button className="outline-button small">Check</button></div>)}</div></PageFrame>; }
function SettingsPage() { const prefs = usePreferences(); return <PageFrame title="Settings" eyebrow="WORKSPACE PREFERENCES"><div className="page-intro">Tune defaults without changing the safeguards around provider keys, task boundaries, or explicit permissions.</div><div className="settings-list"><SettingRow icon={Gauge} title="Default model" detail="Used when a task does not choose a specific model"><select value={prefs.value.model} onChange={event => prefs.setPrefs({ ...prefs.value, model: event.target.value })}><option value="gemini-3-flash-preview">Gemini 3 Flash</option><option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option></select></SettingRow><SettingRow icon={Brain} title="Think mode" detail="Use bounded planning for complex tasks"><button className={`setting-switch ${prefs.value.think ? "on" : ""}`} onClick={() => prefs.setPrefs({ ...prefs.value, think: !prefs.value.think })}><span /></button></SettingRow><SettingRow icon={Search} title="Web Search" detail="Request grounded search when the provider is connected"><button className={`setting-switch ${prefs.value.webSearch ? "on" : ""}`} onClick={() => prefs.setPrefs({ ...prefs.value, webSearch: !prefs.value.webSearch })}><span /></button></SettingRow><SettingRow icon={LockKeyhole} title="Data mode" detail="Task history stays in this browser until durable ownership is connected"><span className="local-badge"><Database size={14} /> Browser-local</span></SettingRow></div></PageFrame>; }
function SettingRow({ icon: Icon, title, detail, children }: { icon: LucideIcon; title: string; detail: string; children: React.ReactNode }) { return <div className="setting-row"><span className="setting-icon"><Icon size={18} /></span><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>; }
function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) { return <div className="empty-state"><span><Icon size={23} /></span><h3>{title}</h3><p>{detail}</p></div>; }
function NotFoundPage() { return <PageFrame title="Page not found" eyebrow="CURIALY AI"><EmptyState icon={SearchX} title="That view does not exist" detail="Use the sidebar to return to a supported workspace." /></PageFrame>; }

function useLocalTasks() {
  const [items, setItems] = useState<LocalTask[]>(() => readTasks());
  const itemsRef = useRef(items);
  const updateItems = (updater: (current: LocalTask[]) => LocalTask[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    writeTasks(next);
    setItems(next);
  };
  return { items, add: (task: LocalTask) => updateItems(current => [task, ...current.filter(item => item.id !== task.id)]), update: (task: LocalTask) => updateItems(current => current.map(item => item.id === task.id ? task : item)), remove: (id: string) => updateItems(current => current.filter(item => item.id !== id)) };
}

function usePreferences() {
  const [value, setValue] = useState<Preferences>(() => readPreferences());
  const setPrefs = (next: Preferences) => { setValue(next); writePreferences(next); };
  return { value: { ...defaultPreferences, ...value }, setPrefs };
}

export default App;
