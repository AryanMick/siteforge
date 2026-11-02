'use client';

import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleX,
  Download,
  FileJson,
  FileSearch,
  FlaskConical,
  FolderKanban,
  Gauge,
  Globe2,
  History,
  Layers3,
  ListFilter,
  LoaderCircle,
  PanelTop,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Square,
  Clock3,
  ListChecks,
  Table2,
  Tags,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  ClusterInsight,
  PipelineRun,
  PipelineStage,
  Project,
  ProjectDetail,
  ProjectInput,
  ProjectStatus,
} from '@/pagepilot/types';
import styles from './pagepilot.module.css';
import { ProjectInputError, publicProjectInput } from '@/pagepilot/config.mjs';
import { describeCrawl } from '@/pagepilot/crawl-summary.mjs';
import { buildSiteReview } from '@/pagepilot/site-review.mjs';
import { crawlRecovery } from '@/pagepilot/crawl-recovery.mjs';
import { convertPages } from '@/pagepilot/conversion.mjs';

type WorkspaceStage = 'review' | 'crawl' | 'cleanup' | 'clustering' | 'labeling' | 'content' | 'validation' | 'export' | 'conversion' | 'cms';
type Notice = { tone: 'success' | 'error'; message: string } | null;

const WORKSPACE_STAGES: { id: WorkspaceStage; label: string; icon: typeof FileSearch }[] = [
  { id: 'crawl', label: 'Crawl', icon: Globe2 },
  { id: 'cleanup', label: 'Cleanup', icon: ListChecks },
  { id: 'clustering', label: 'Clustering', icon: Layers3 },
  { id: 'labeling', label: 'Labeling', icon: Tags },
  { id: 'content', label: 'Content', icon: Table2 },
  { id: 'conversion', label: 'Conversion', icon: Braces },
  { id: 'cms', label: 'CMS', icon: PanelTop },
];

const DEFAULT_INPUT: ProjectInput = {
  name: '',
  mode: 'public',
  profile: 'library',
  noise: 'clean',
  pageCount: 24,
  seed: 48291,
  url: '',
  pathPrefix: '/',
  maxPages: 100,
  maxDepth: 6,
  maxDurationMinutes: 15,
  threshold: 0.32,
};

const EXAMPLE_INPUT: ProjectInput = { ...DEFAULT_INPUT, mode: 'synthetic', name: 'Library benchmark' };

const statusLabels: Record<ProjectStatus | PipelineRun['status'], string> = {
  ready: 'Ready',
  running: 'Running',
  completed: 'Completed',
  attention: 'Needs attention',
  failed: 'Failed',
};

function messageFromPayload(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error;
  return fallback;
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not finished';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatScore(value: number | null | undefined) {
  return value == null ? 'N/A' : value.toFixed(3);
}

function formatBytes(bytes: number | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : 'Not recorded';
}

function sorted(values: Iterable<string>) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left: Iterable<string>, right: Iterable<string>) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function projectInput(project: Project): ProjectInput {
  return {
    name: project.name,
    mode: project.mode,
    profile: project.profile,
    noise: project.noise,
    pageCount: project.pageCount,
    seed: project.seed,
    url: project.url,
    pathPrefix: project.pathPrefix,
    maxPages: project.maxPages,
    maxDepth: project.maxDepth ?? 6,
    maxDurationMinutes: project.maxDurationMinutes ?? 15,
    threshold: project.threshold ?? 0.32,
  };
}

function Status({ status }: { status: ProjectStatus | PipelineRun['status'] }) {
  const Icon = status === 'running' ? LoaderCircle : status === 'completed' ? CheckCircle2 : status === 'failed' ? CircleX : status === 'attention' ? AlertCircle : Circle;
  return (
    <span className={`${styles.status} ${styles[`status_${status}`]}`}>
      <Icon size={14} className={status === 'running' ? styles.spin : undefined} />
      {statusLabels[status]}
    </span>
  );
}

function StageMark({ stage }: { stage: PipelineStage }) {
  const Icon = stage.status === 'running' ? LoaderCircle : stage.status === 'passed' ? Check : stage.status === 'failed' ? CircleX : stage.status === 'attention' ? AlertCircle : Circle;
  return (
    <div className={`${styles.pipelineStep} ${styles[`pipeline_${stage.status}`]}`} title={stage.message || stage.status}>
      <Icon size={14} className={stage.status === 'running' ? styles.spin : undefined} />
      <span>{stage.label}</span>
    </div>
  );
}

export function PagePilot() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [suggestedAddress, setSuggestedAddress] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState<ProjectInput>(DEFAULT_INPUT);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [startingProjectId, setStartingProjectId] = useState<string | null>(null);
  const [runningExample, setRunningExample] = useState(false);
  const selectedProjectRef = useRef<string | null>(null);
  const projectsRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const refreshProjects = useCallback(async (quiet = false) => {
    const requestId = ++projectsRequestRef.current;
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(messageFromPayload(payload, 'Projects could not be loaded.'));
      if (requestId !== projectsRequestRef.current) return;
      const next = (payload as { projects?: Project[] }).projects;
      setProjects(Array.isArray(next) ? next : []);
      if (!quiet) setError('');
    } catch (failure) {
      if (!quiet && requestId === projectsRequestRef.current) setError((failure as Error).message);
    } finally {
      if (!quiet && requestId === projectsRequestRef.current) setLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async (projectId: string, quiet = false) => {
    const requestId = ++detailRequestRef.current;
    try {
      if (!quiet) setDetailLoading(true);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(messageFromPayload(payload, 'Project details could not be loaded.'));
      if (requestId !== detailRequestRef.current || selectedProjectRef.current !== projectId) return;
      setDetail(payload as ProjectDetail);
      if (!quiet) setError('');
    } catch (failure) {
      if (!quiet && requestId === detailRequestRef.current && selectedProjectRef.current === projectId) setError((failure as Error).message);
    } finally {
      if (!quiet && requestId === detailRequestRef.current && selectedProjectRef.current === projectId) setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  useEffect(() => {
    if (!detail) return;
    if (!detail.runs.some((run) => run.id === selectedRunId)) setSelectedRunId(detail.project.latestRunId ?? detail.runs[0]?.id ?? '');
  }, [detail, selectedRunId]);

  const currentRun = useMemo(() => {
    if (!detail) return null;
    return detail.runs.find((run) => run.id === selectedRunId)
      ?? detail.runs.find((run) => run.id === detail.project.latestRunId)
      ?? detail.runs[0]
      ?? null;
  }, [detail, selectedRunId]);

  const anyActive = useMemo(
    () => projects.some((project) => project.status === 'running') || detail?.runs.some((run) => run.status === 'running') === true,
    [detail, projects],
  );

  useEffect(() => {
    if (!anyActive) return;
    const timer = window.setInterval(() => {
      void refreshProjects(true);
      if (selectedProjectRef.current) void refreshDetail(selectedProjectRef.current, true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [anyActive, refreshDetail, refreshProjects]);

  function openProject(projectId: string) {
    detailRequestRef.current++;
    selectedProjectRef.current = projectId;
    setSelectedProjectId(projectId);
    setSelectedRunId('');
    setSettingsOpen(false);
    setError('');
    if (detail?.project.id !== projectId) setDetail(null);
    void refreshDetail(projectId);
  }

  function closeProject() {
    detailRequestRef.current++;
    selectedProjectRef.current = null;
    setSelectedProjectId(null);
    setSelectedRunId('');
    setDetail(null);
    setSettingsOpen(false);
    setError('');
  }

  async function createProject(input: ProjectInput) {
    const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(messageFromPayload(payload, 'Project could not be created.'));
    return (payload as { project: Project }).project;
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const project = await createProject(createInput);
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setCreateOpen(false);
      setCreateInput(DEFAULT_INPUT);
      openProject(project.id);
    } catch (failure) {
      setCreateError((failure as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const launchRun = useCallback(async (projectId: string, path: 'run' | 'recluster', body: object) => {
    if (anyActive || startingProjectId) return null;
    setStartingProjectId(projectId);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(messageFromPayload(payload, response.status === 409 ? 'Another pipeline is already running.' : 'The pipeline could not start.'));
      const run = (payload as { run: PipelineRun }).run;
      setSelectedRunId(run.id);
      setDetail((current) => current?.project.id === projectId
        ? { ...current, project: { ...current.project, status: 'running', latestRunId: run.id }, runs: [run, ...current.runs.filter((item) => item.id !== run.id)] }
        : current);
      await Promise.all([refreshProjects(true), refreshDetail(projectId, true)]);
      return run;
    } catch (failure) {
      setError((failure as Error).message);
      throw failure;
    } finally {
      setStartingProjectId(null);
    }
  }, [anyActive, refreshDetail, refreshProjects, startingProjectId]);

  async function runExample() {
    if (anyActive || runningExample) return;
    setRunningExample(true);
    setError('');
    try {
      const project = await createProject(EXAMPLE_INPUT);
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      selectedProjectRef.current = project.id;
      setSelectedProjectId(project.id);
      setDetail({ project, runs: [] });
      await launchRun(project.id, 'run', {});
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setRunningExample(false);
    }
  }

  async function runWebsite(input: ProjectInput) {
    if (anyActive || startingProjectId || runningExample) throw new Error('Wait for the current run to finish.');
    const project = await createProject(input);
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    selectedProjectRef.current = project.id;
    setSelectedProjectId(project.id);
    setDetail({ project, runs: [] });
    setError('');
    await launchRun(project.id, 'run', {});
  }

  async function saveLabels(runId: string, labels: Record<string, string>) {
    if (!detail) throw new Error('Project is not loaded.');
    const projectId = detail.project.id;
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/labels`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labels }),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(messageFromPayload(payload, 'Labels could not be saved.'));
    const updated = (payload as { run: PipelineRun }).run;
    setDetail((current) => current?.project.id === projectId
      ? { ...current, runs: current.runs.map((run) => run.id === updated.id ? updated : run) }
      : current);
    void refreshProjects(true);
  }

  async function stopRun(runId: string) {
    if (!detail) return;
    const response = await fetch(`/api/projects/${detail.project.id}/runs/${runId}/stop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(messageFromPayload(payload, 'The crawl could not be stopped.'));
    await refreshDetail(detail.project.id, true);
  }

  async function saveProjectSettings(input: ProjectInput) {
    if (!detail) return;
    setSavingSettings(true);
    setSettingsError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(detail.project.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(messageFromPayload(payload, 'Project settings could not be saved.'));
      const project = (payload as { project: Project }).project;
      setDetail((current) => current ? { ...current, project } : current);
      setProjects((current) => current.map((item) => item.id === project.id ? project : item));
      setSettingsOpen(false);
    } catch (failure) {
      setSettingsError((failure as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className={styles.app} data-testid="pagepilot-root">
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" aria-label="PagePilot projects">
          <span className={styles.brandMark}><FileSearch size={20} /></span>
          <span>PagePilot<small>Crawl workspace</small></span>
        </Link>
        <nav className={styles.nav} aria-label="PagePilot navigation">
          <Link className={`${styles.navItem} ${styles.navSelected}`} href="/" aria-current="page"><FolderKanban size={17} /><span>Projects</span>{!loading && <span className={styles.navCount}>{projects.length}</span>}</Link>
          <Link className={styles.navItem} href="/test-lab"><FlaskConical size={17} /><span>Test lab</span></Link>
        </nav>
        <div className={styles.runtime}><span />Local runtime<small>HTTP pipeline</small></div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <span>{selectedProjectId ? 'Project workspace' : 'Website workspace'}</span>
          <span className={styles.connection}><span />Local workspace</span>
        </header>

        {selectedProjectId ? (
          <ProjectWorkspace
            detail={detail}
            loading={detailLoading}
            error={error}
            run={currentRun}
            selectedRunId={selectedRunId}
            anyActive={anyActive}
            starting={startingProjectId === selectedProjectId}
            onBack={closeProject}
            onRefresh={() => { setError(''); void Promise.all([refreshProjects(), refreshDetail(selectedProjectId)]); }}
            onRun={() => { void launchRun(selectedProjectId, 'run', {}).catch(() => {}); }}
            onRecluster={(sourceRunId, threshold, excludedUrls) => launchRun(selectedProjectId, 'recluster', { sourceRunId, threshold, excludedUrls })}
            onSelectRun={setSelectedRunId}
            onSaveLabels={saveLabels}
            onStop={stopRun}
            onSettings={(url) => { setSuggestedAddress(url ?? null); setSettingsError(''); setSettingsOpen(true); }}
          />
        ) : (
          <ProjectsView
            projects={projects}
            loading={loading}
            error={error}
            anyActive={anyActive}
            runningExample={runningExample}
            startingProjectId={startingProjectId}
            onOpen={openProject}
            onRun={(projectId) => { void launchRun(projectId, 'run', {}).catch(() => {}); }}
            onRefresh={() => { setError(''); void refreshProjects(); }}
            onNew={() => setCreateOpen(true)}
            onExample={() => void runExample()}
            onWebsite={runWebsite}
          />
        )}
      </main>

      {isCreateOpen && (
        <ProjectDialog
          title="New project"
          submitLabel="Create project"
          value={createInput}
          busy={creating}
          error={createError}
          onChange={setCreateInput}
          onClose={() => { if (!creating) { setCreateOpen(false); setCreateError(''); } }}
          onSubmit={submitCreate}
        />
      )}

      {isSettingsOpen && detail && (
        <ProjectDialog
          title="Project settings"
          submitLabel="Save settings"
          value={{ ...projectInput(detail.project), ...(suggestedAddress ? { url: suggestedAddress } : {}) }}
          busy={savingSettings}
          error={settingsError}
          onClose={() => { if (!savingSettings) { setSettingsOpen(false); setSettingsError(''); } }}
          onSubmitValue={(input) => void saveProjectSettings(input)}
        />
      )}
    </div>
  );
}

function ProjectsView({
  projects, loading, error, anyActive, runningExample, startingProjectId, onOpen, onRun, onRefresh, onNew, onExample, onWebsite,
}: {
  projects: Project[];
  loading: boolean;
  error: string;
  anyActive: boolean;
  runningExample: boolean;
  startingProjectId: string | null;
  onOpen: (projectId: string) => void;
  onRun: (projectId: string) => void;
  onRefresh: () => void;
  onNew: () => void;
  onExample: () => void;
  onWebsite: (input: ProjectInput) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const [sourceFilter, setSourceFilter] = useState('public');
  const normalizedSearch = search.trim().toLowerCase();
  const visible = projects.filter((project) => {
    const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
    const matchesSearch = !normalizedSearch || `${project.name} ${project.url} ${project.profile}`.toLowerCase().includes(normalizedSearch);
    return matchesStatus && matchesSearch && (sourceFilter === 'all' || project.mode === sourceFilter);
  });

  return (
    <>
      <section className={styles.pageHeading}>
        <div><span className={styles.eyebrow}>WORKSPACE</span><h1>Projects</h1></div>
        <div className={styles.actions}>
          <button className={styles.iconButton} type="button" aria-label="Refresh projects" title="Refresh projects" onClick={onRefresh}><RefreshCw size={17} /></button>
          {sourceFilter === 'synthetic' && <button className={styles.button} type="button" disabled={anyActive || runningExample} onClick={onExample}>{runningExample ? <LoaderCircle className={styles.spin} size={16} /> : <FlaskConical size={16} />}Run example</button>}
          <button className={styles.button} data-testid="new-project" type="button" onClick={onNew}><Plus size={16} />New project</button>
        </div>
      </section>

      {error && <NoticeBar tone="error">{error}</NoticeBar>}
      {anyActive && <NoticeBar tone="running"><LoaderCircle className={styles.spin} size={16} />A pipeline is running. Projects refresh automatically.</NoticeBar>}

      <WebsiteStart disabled={loading || anyActive || runningExample || startingProjectId !== null} onRun={onWebsite} />

      <section className={styles.projectArea} aria-labelledby="projects-table-title">
        <div className={styles.sourceFilters} role="group" aria-label="Project source">
          {[['public', 'Websites'], ['synthetic', 'Benchmarks'], ['all', 'All projects']].map(([id, label]) => <button key={id} type="button" aria-pressed={sourceFilter === id} onClick={() => setSourceFilter(id)}>{label}<span>{projects.filter(project => id === 'all' || project.mode === id).length}</span></button>)}
        </div>
        <div className={styles.sectionBar}>
          <div className={styles.sectionTitle}><FolderKanban size={17} /><h2 id="projects-table-title">{sourceFilter === 'public' ? 'Websites' : sourceFilter === 'synthetic' ? 'Benchmarks' : 'All projects'}</h2><span className={styles.countBadge}>{visible.length}</span></div>
          <div className={styles.toolbar}>
            <label className={styles.searchField}><Search size={15} /><span className={styles.srOnly}>Search projects</span><input data-testid="projects-search" type="search" placeholder="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <label className={styles.selectField}><ListFilter size={15} /><span className={styles.srOnly}>Filter by status</span><select data-testid="status-filter" aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ProjectStatus)}><option value="all">All statuses</option><option value="ready">Ready</option><option value="running">Running</option><option value="completed">Completed</option><option value="attention">Needs attention</option><option value="failed">Failed</option></select><ChevronDown size={14} /></label>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading projects" />
        ) : error && projects.length === 0 ? (
          <EmptyState icon={<CircleX size={23} />} title="Projects unavailable"><button className={styles.button} type="button" onClick={onRefresh}><RefreshCw size={16} />Try again</button></EmptyState>
        ) : projects.length === 0 ? (
          <EmptyState icon={<FolderKanban size={23} />} title="No projects yet">
            <div className={styles.actions}><button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={onExample} disabled={runningExample}>{runningExample ? <LoaderCircle className={styles.spin} size={16} /> : <Play size={16} />}Run example</button><button className={styles.button} type="button" onClick={onNew}><Plus size={16} />New project</button></div>
          </EmptyState>
        ) : visible.length === 0 ? (
          <div className={styles.inlineEmpty}>No projects match these filters.</div>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.projectsTable}>
              <thead><tr><th>Project</th><th>Status</th><th>Pages / limit</th><th>Clusters</th><th>Updated</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
              <tbody>{visible.map((project) => {
                const progress = project.progress;
                const canRun = project.status !== 'running';
                return (
                  <tr key={project.id} data-testid={`project-row-${project.id}`}>
                    <td><button className={styles.projectName} data-testid={`open-project-${project.id}`} type="button" onClick={() => onOpen(project.id)}>{project.name}</button><span className={styles.secondaryText}>{project.mode === 'synthetic' ? `${project.profile} / ${project.noise}` : project.url}</span></td>
                    <td><Status status={project.status} />{project.status === 'running' && <div className={styles.progressCell}><span>{progress?.current ?? 'Starting'}</span><div><i style={{ width: `${progress?.total ? Math.round(progress.completed / progress.total * 100) : 0}%` }} /></div></div>}</td>
                    <td className={styles.numericCell}>{project.crawlProgress?.analyzed ?? project.metrics?.pages ?? '-'}<span className={styles.secondaryText}>of {project.mode === 'public' ? project.maxPages : project.pageCount}</span></td>
                    <td>{project.metrics?.clusters ?? '-'}</td>
                    <td>{formatDate(project.updatedAt)}</td>
                    <td><div className={styles.rowActions}><button className={styles.textButton} type="button" onClick={() => onOpen(project.id)}>Open</button>{canRun && <button className={styles.textButton} type="button" disabled={anyActive || startingProjectId !== null} onClick={() => onRun(project.id)}>{startingProjectId === project.id ? <LoaderCircle className={styles.spin} size={14} /> : <Play size={14} />}Run</button>}</div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function WebsiteStart({ disabled, onRun }: { disabled: boolean; onRun: (input: ProjectInput) => Promise<void> }) {
  const [address, setAddress] = useState('');
  const [maxPages, setMaxPages] = useState('100');
  const [maxDepth, setMaxDepth] = useState('6');
  const [maxDurationMinutes, setMaxDurationMinutes] = useState('15');
  const [pathPrefix, setPathPrefix] = useState('/');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const errorProps = (field: string) => ({
    'aria-invalid': error?.field === field,
    'aria-describedby': error?.field === field ? 'website-start-error' : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending.current) return;
    pending.current = true;
    setError(null);
    try {
      const input = publicProjectInput(address, { maxPages: Number(maxPages), maxDepth: Number(maxDepth), maxDurationMinutes: Number(maxDurationMinutes), pathPrefix });
      setBusy(true);
      await onRun(input);
    } catch (failure) {
      const field = failure instanceof ProjectInputError ? failure.field : undefined;
      setError({ message: (failure as Error).message, field });
      if (field) {
        if (field !== 'url' && options.current) options.current.open = true;
        const input = form.current?.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.focus();
      }
    }
    finally { pending.current = false; setBusy(false); }
  }

  return (
    <section className={styles.websiteStart} aria-labelledby="website-start-title">
      <div className={styles.startHeading}><h2 id="website-start-title">Run a website</h2><span><Globe2 size={14} />HTTP crawler</span></div>
      <form ref={form} noValidate onSubmit={(event) => void submit(event)} aria-label="Run a website" aria-busy={busy}>
        <div className={styles.websiteEntry}>
          <label className={styles.websiteAddress}>
            <Globe2 size={19} aria-hidden="true" />
            <span className={styles.srOnly}>Website address</span>
            <input name="url" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="url" required maxLength={2048} placeholder="https://example.com" value={address} onChange={(event) => { setAddress(event.target.value); setError(null); }} {...errorProps('url')} disabled={busy} />
          </label>
          <button type="submit" className={`${styles.button} ${styles.primaryButton}`} disabled={disabled || busy}>
            {busy ? <LoaderCircle size={17} className={styles.spin} /> : <Play size={17} />}{busy ? 'Starting...' : 'Run website'}
          </button>
        </div>
        <div className={styles.crawlSetup}>
          <fieldset className={styles.crawlPresets}><legend>Crawl size</legend><div>
            {[{label:'Small',pages:25,depth:3,minutes:5},{label:'Standard',pages:100,depth:6,minutes:15},{label:'Large',pages:500,depth:10,minutes:30}].map(preset => <label key={preset.label} className={Number(maxPages) === preset.pages ? styles.presetSelected : ''}><input type="radio" name="crawlSize" checked={Number(maxPages) === preset.pages} disabled={busy} onChange={() => { setMaxPages(String(preset.pages)); setMaxDepth(String(preset.depth)); setMaxDurationMinutes(String(preset.minutes)); setError(null); }} /><span>{preset.label}</span><small>{preset.pages}</small></label>)}
          </div></fieldset>
          <div className={styles.crawlLimits}>
            <label>Page limit<input name="maxPages" type="number" min={1} max={500} required value={maxPages} onChange={(event) => { setMaxPages(event.target.value); setError(null); }} {...errorProps('maxPages')} disabled={busy} /></label>
            <label>Link depth<input name="maxDepth" type="number" min={0} max={10} required value={maxDepth} onChange={(event) => { setMaxDepth(event.target.value); setError(null); }} {...errorProps('maxDepth')} disabled={busy} /></label>
            <label>Time limit (min)<input name="maxDurationMinutes" type="number" min={1} max={30} required value={maxDurationMinutes} onChange={(event) => { setMaxDurationMinutes(event.target.value); setError(null); }} {...errorProps('maxDurationMinutes')} disabled={busy} /></label>
          </div>
        </div>
        <div className={styles.websiteOptions}>
          <span>Same website <span aria-hidden="true">/</span> robots.txt respected</span>
          <details ref={options}>
            <summary><Settings2 size={14} />Options</summary>
            <div className={styles.websiteOptionFields}>
              <label>Path scope<input name="pathPrefix" type="text" required maxLength={512} value={pathPrefix} onChange={(event) => { setPathPrefix(event.target.value); setError(null); }} {...errorProps('pathPrefix')} disabled={busy} /></label>
            </div>
          </details>
        </div>
        {error && <p id="website-start-error" className={styles.websiteError} role="alert"><CircleAlert size={16} />{error.message}</p>}
      </form>
    </section>
  );
}

function ProjectWorkspace({
  detail, loading, error, run, selectedRunId, anyActive, starting, onBack, onRefresh, onRun, onRecluster, onSelectRun, onSaveLabels, onSettings, onStop,
}: {
  detail: ProjectDetail | null;
  loading: boolean;
  error: string;
  run: PipelineRun | null;
  selectedRunId: string;
  anyActive: boolean;
  starting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onRun: () => void;
  onRecluster: (sourceRunId: string, threshold: number, excludedUrls: string[]) => Promise<PipelineRun | null>;
  onSelectRun: (runId: string) => void;
  onSaveLabels: (runId: string, labels: Record<string, string>) => Promise<void>;
  onSettings: (url?: string) => void;
  onStop: (runId: string) => Promise<void>;
}) {
  const project = detail?.project;
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  async function requestStop() {
    if (!run) return;
    setStopping(true); setStopError('');
    try { await onStop(run.id); } catch (error) { setStopError((error as Error).message); }
    finally { setStopping(false); }
  }
  return (
    <>
      <section className={styles.detailHeading}>
        <button className={styles.backButton} type="button" onClick={onBack}><ArrowLeft size={16} />Projects</button>
        <div className={styles.detailTitleRow}>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>{project?.mode === 'public' ? 'PUBLIC CRAWL' : 'FICTIONAL BENCHMARK'}</span>
            <h1>{project?.name ?? 'Project'}</h1>
            {project && <p>{project.mode === 'public' ? project.url : `${project.profile} / ${project.noise} / ${project.pageCount} pages`}</p>}
          </div>
          <div className={styles.actions}>
            {project?.status === 'running' && <Status status={project.status} />}
            <button className={styles.iconButton} type="button" title="Project settings" aria-label="Project settings" onClick={() => onSettings()} disabled={!project}><Settings2 size={17} /></button>
            <button className={styles.iconButton} type="button" title="Refresh project" aria-label="Refresh project" onClick={onRefresh}><RefreshCw size={17} /></button>
            {run?.status === 'running' && run.kind !== 'recluster' ? <button className={`${styles.button} ${styles.stopButton}`} data-testid="stop-run" type="button" disabled={stopping || run.stopRequested} onClick={() => void requestStop()}>{stopping || run.stopRequested ? <LoaderCircle size={16} className={styles.spin} /> : <Square size={15} />}{stopping || run.stopRequested ? 'Stopping...' : 'Stop crawl'}</button> : <button className={`${styles.button} ${styles.primaryButton}`} data-testid="run-project" type="button" disabled={!project || anyActive || starting} onClick={onRun}>{starting ? <LoaderCircle className={styles.spin} size={16} /> : <Play size={16} />}{project?.latestRunId ? 'Run again' : 'Run'}</button>}
          </div>
        </div>
      </section>

      {error && <NoticeBar tone="error">{error}</NoticeBar>}
      {stopError && <NoticeBar tone="error">{stopError}</NoticeBar>}
      {loading && !detail && <LoadingState label="Loading project" />}

      {detail && (
        <>
          <section className={styles.runBar}>
            <div className={styles.runIdentity}><History size={16} /><span>Run history</span></div>
            <label className={styles.runSelect}><span className={styles.srOnly}>Run</span><select data-testid="run-history-select" aria-label="Run" value={run?.id ?? selectedRunId} onChange={(event) => onSelectRun(event.target.value)} disabled={!detail.runs.length}>{!detail.runs.length ? <option value="">No runs</option> : detail.runs.map((item) => <option key={item.id} value={item.id}>{item.id === detail.project.latestRunId ? 'Latest / ' : ''}{formatDate(item.startedAt)} / {statusLabels[item.status]}{item.kind === 'recluster' ? ' / re-cluster' : ''}</option>)}</select><ChevronDown size={14} /></label>
            {run && <div className={styles.runFacts}><span>{run.kind === 'recluster' ? 'Saved snapshot' : 'Fresh crawl'}</span></div>}
          </section>

          {!run ? (
            <EmptyState icon={<Gauge size={24} />} title="No runs yet"><button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={anyActive || starting} onClick={onRun}><Play size={16} />Run project</button></EmptyState>
          ) : (
            <RunWorkspace
              key={`${run.id}:${run.result ? 'complete' : 'pending'}`}
              project={detail.project}
              runs={detail.runs}
              run={run}
              anyActive={anyActive}
              actionBusy={starting}
              onRecluster={onRecluster}
              onSaveLabels={onSaveLabels}
              onSelectRun={onSelectRun}
              onSettings={onSettings}
            />
          )}
        </>
      )}
    </>
  );
}

function RunWorkspace({ project, runs, run, anyActive, actionBusy, onRecluster, onSaveLabels, onSelectRun, onSettings }: {
  project: Project;
  runs: PipelineRun[];
  run: PipelineRun;
  anyActive: boolean;
  actionBusy: boolean;
  onRecluster: (sourceRunId: string, threshold: number, excludedUrls: string[]) => Promise<PipelineRun | null>;
  onSaveLabels: (runId: string, labels: Record<string, string>) => Promise<void>;
  onSelectRun: (runId: string) => void;
  onSettings: (url?: string) => void;
}) {
  const result = run.result;
  const [activeStage, setActiveStage] = useState<WorkspaceStage>(run.kind === 'recluster' ? 'clustering' : run.status === 'running' ? 'crawl' : 'review');
  const initialExcluded = result?.rules?.excludedUrls ?? result?.pages.filter((page) => page.excluded).map((page) => page.url) ?? [];
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(initialExcluded));
  const [threshold, setThreshold] = useState(result?.rules?.threshold ?? project.threshold ?? 0.32);
  const [labels, setLabels] = useState<Record<string, string>>(() => ({ ...(result?.labels ?? {}) }));
  const [notice, setNotice] = useState<Notice>(null);
  const [savingLabels, setSavingLabels] = useState(false);
  const recovery = project.mode === 'public' ? crawlRecovery(run, project) : null;

  const originalLabels = result?.labels ?? {};
  const labelsDirty = JSON.stringify(Object.fromEntries(Object.entries(labels).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value)))
    !== JSON.stringify(Object.fromEntries(Object.entries(originalLabels).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value)));
  const cleanupDirty = !sameStrings(excluded, initialExcluded);
  const thresholdDirty = Math.abs(threshold - (result?.rules?.threshold ?? project.threshold ?? 0.32)) > 0.00001;

  async function recluster() {
    if (!result) return;
    setNotice(null);
    try {
      await onRecluster(run.id, threshold, sorted(excluded));
    } catch (failure) {
      setNotice({ tone: 'error', message: (failure as Error).message });
    }
  }

  async function persistLabels() {
    setSavingLabels(true);
    setNotice(null);
    try {
      const replacement = Object.fromEntries(result?.clusters.map((cluster) => [cluster.id, labels[cluster.id]?.trim() ?? '']) ?? []);
      await onSaveLabels(run.id, replacement);
      setLabels(Object.fromEntries(Object.entries(replacement).filter(([, value]) => value)));
      setNotice({ tone: 'success', message: 'Labels saved to this run.' });
    } catch (failure) {
      setNotice({ tone: 'error', message: (failure as Error).message });
    } finally {
      setSavingLabels(false);
    }
  }

  return (
    <section className={styles.workspace} aria-labelledby="results-title" data-run-id={run.id} data-result-ready={Boolean(result)}>
      <h2 id="results-title" className={styles.srOnly}>Results</h2>
      <PipelineStrip run={run} />
      <StageTabs active={activeStage} result={result} synthetic={project.mode === 'synthetic'} onChange={(stage) => { setNotice(null); setActiveStage(stage); }} />
      {notice && <NoticeBar tone={notice.tone}>{notice.tone === 'success' ? <CheckCircle2 size={16} /> : <CircleX size={16} />}{notice.message}</NoticeBar>}

      <div className={styles.stagePanel} role="tabpanel" id={`panel-${activeStage}`} aria-labelledby={`stage-${activeStage}`}>
        {recovery && (activeStage === 'review' || !result) && <section className={styles.recovery} aria-label="Crawl recovery">
          <div><div className={styles.recoveryTitle}><CircleAlert size={18} /><h3>{recovery.title}</h3></div><p>{recovery.message}</p>{recovery.suggestedUrl && <code>{recovery.suggestedUrl}</code>}{recovery.evidence && <details><summary>Technical details</summary><code>{recovery.evidence}</code></details>}</div>
          <button className={styles.button} type="button" onClick={() => recovery.action === 'settings' ? onSettings(recovery.suggestedUrl ?? undefined) : setActiveStage('crawl')}>{recovery.action === 'settings' ? <Settings2 size={15} /> : <Globe2 size={15} />}{recovery.suggestedUrl ? 'Review address' : recovery.action === 'settings' ? 'Edit settings' : 'View crawl log'}</button>
        </section>}
        {!result ? (
          run.status === 'running'
            ? <LiveCrawl run={run} project={project} />
            : <EmptyState icon={<CircleX size={23} />} title="No saved result">{!recovery && run.error && <p className={styles.errorText}>{run.error}</p>}</EmptyState>
        ) : (
          <>
          {activeStage === 'review' && <SiteReviewPanel run={run} />}
          {activeStage === 'crawl' && <CrawlPanel run={run} />}
          {activeStage === 'cleanup' && <CleanupPanel result={result} excluded={excluded} setExcluded={setExcluded} dirty={cleanupDirty} busy={anyActive || actionBusy} onApply={() => void recluster()} />}
          {activeStage === 'clustering' && <ClusteringPanel result={result} threshold={threshold} setThreshold={setThreshold} dirty={thresholdDirty || cleanupDirty} busy={anyActive || actionBusy} onRecluster={() => void recluster()} />}
          {activeStage === 'labeling' && <LabelingPanel result={result} labels={labels} setLabels={setLabels} dirty={labelsDirty} busy={savingLabels || anyActive} onSave={() => void persistLabels()} />}
          {activeStage === 'content' && <ContentPanel run={run} />}
          {activeStage === 'conversion' && <ConversionPanel run={run} />}
          {activeStage === 'cms' && <WordPressPanel run={run} />}
          {activeStage === 'validation' && <ValidationPanel run={run} />}
          {activeStage === 'export' && <ExportPanel project={project} run={run} runs={runs} onSelectRun={onSelectRun} />}
          </>
        )}
      </div>
    </section>
  );
}

function PipelineStrip({ run }: { run: PipelineRun }) {
  return (
    <details className={styles.pipelineStrip} aria-label="Pipeline execution" open={run.status === 'running'}>
      <summary><span className={styles.pipelineSummary}><Status status={run.status} /><span>{run.status === 'running' ? run.stages.find(stage => stage.status === 'running')?.label ?? 'Starting' : run.result ? `${run.result.metrics.pages} pages / ${run.result.metrics.clusters} groups` : 'No pages saved'}</span></span><span>Run details<ChevronDown size={14} /></span></summary>
      <div className={styles.pipelineSteps} tabIndex={0} aria-label="Pipeline stages">{run.stages.map((stage) => <StageMark key={stage.id} stage={stage} />)}</div>
      <dl className={styles.runDetails}><div><dt>Run</dt><dd><code>{run.id}</code></dd></div><div><dt>Source</dt><dd>{run.kind === 'recluster' ? 'Saved snapshot' : 'Fresh crawl'}</dd></div><div><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd></div><div><dt>Finished</dt><dd>{formatDate(run.finishedAt)}</dd></div></dl>
      {run.error && <div className={styles.pipelineError}><CircleX size={15} />{run.error}</div>}
    </details>
  );
}

function StageTabs({ active, result, synthetic, onChange }: { active: WorkspaceStage; result: PipelineRun['result']; synthetic: boolean; onChange: (stage: WorkspaceStage) => void }) {
  const stages = WORKSPACE_STAGES;
  const labelCount = result?.clusters.filter((cluster) => result.labels?.[cluster.id]).length ?? 0;
  const badges: Partial<Record<WorkspaceStage, string>> = result ? {
    crawl: String(result.crawl.analyzed),
    cleanup: String(result.rules?.excludedUrls?.length ?? result.pages.filter((page) => page.excluded).length),
    clustering: String(result.clusters.length),
    labeling: `${labelCount}/${result.clusters.length}`,
    content: String(result.pages.length),
    validation: result.evaluation.status === 'not_available' ? 'N/A' : result.evaluation.status,
    export: '3',
  } : {};

  return (<>
    <div className={styles.resultTools} aria-label="Result tools">
      {[{id:'review' as const,label:'Site review',icon:FileSearch},{id:'validation' as const,label:'Accuracy',icon:Gauge},{id:'export' as const,label:'Downloads',icon:Download}].filter(item => synthetic || item.id !== 'validation').map(item => <button key={item.id} id={`stage-${item.id}`} data-testid={`stage-tab-${item.id}`} type="button" aria-pressed={active === item.id} onClick={() => onChange(item.id)}><item.icon size={14} />{item.label}</button>)}
    </div>
    <div className={styles.stageTabs} role="tablist" aria-label="Project workflow" data-testid="workspace-tabs">
      {stages.map((stage, index) => (
        <button
          key={stage.id}
          id={`stage-${stage.id}`}
          data-testid={`stage-tab-${stage.id}`}
          role="tab"
          type="button"
          aria-selected={active === stage.id}
          aria-controls={active === stage.id ? `panel-${stage.id}` : undefined}
          tabIndex={active === stage.id || !stages.some(item => item.id === active) && index === 0 ? 0 : -1}
          onClick={() => onChange(stage.id)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            let nextIndex = index;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + stages.length) % stages.length;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % stages.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = stages.length - 1;
            const next = stages[nextIndex].id;
            onChange(next);
            document.getElementById(`stage-${next}`)?.focus();
          }}
        >
          <stage.icon size={17} /><span>{stage.label}</span>{badges[stage.id] && <small>{badges[stage.id]}</small>}
        </button>
      ))}
    </div></>
  );
}

function LiveCrawl({ run, project }: { run: PipelineRun; project: Project }) {
  const progress = run.crawlProgress;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(run.startedAt)) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [run.startedAt]);
  const stage = run.stages.find(stage => stage.status === 'running');
  const limit = project.mode === 'public' ? project.maxPages : project.pageCount;
  return <section className={styles.liveCrawl} aria-label="Live crawl" data-testid="live-crawl">
    <div className={styles.liveHeading}><div><LoaderCircle size={20} className={styles.spin} /><h3>{run.stopRequested ? 'Finishing collected pages' : stage?.label ?? 'Starting crawl'}</h3></div><span><Clock3 size={15} />{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2,'0')}</span></div>
    <MetricStrip><Metric label="Pages collected" value={String(progress?.analyzed ?? 0)} detail={`Limit ${progress?.maxPages ?? limit}`} /><Metric label="Discovered" value={String(progress?.discovered ?? 0)} /><Metric label="Queued" value={String(progress?.queued ?? 0)} /><Metric label="Failed" value={String(progress?.failed ?? 0)} /></MetricStrip>
    <div className={styles.crawlBudgetBar} aria-label="Pages collected against page limit" role="progressbar" aria-valuenow={progress?.analyzed ?? 0} aria-valuemin={0} aria-valuemax={progress?.maxPages ?? limit}><span style={{width:`${Math.min(100,(progress?.analyzed ?? 0)/(progress?.maxPages ?? limit)*100)}%`}} /></div>
    <div className={styles.liveRequest}><span>Current URL</span><code>{progress?.currentUrl ?? (project.url || 'Preparing fictional site')}</code></div>
    <div className={styles.liveFacts}><span>{formatBytes(progress?.bytes ?? 0)} transferred</span><span>{progress?.skipped ?? 0} skipped</span><span>HTML / same website</span></div>
  </section>;
}

function StageHeader({ icon, title, meta, actions }: { icon: ReactNode; title: string; meta?: string; actions?: ReactNode }) {
  return <div className={styles.stageHeader}><div className={styles.stageTitle}>{icon}<div><h3>{title}</h3>{meta && <p>{meta}</p>}</div></div>{actions && <div className={styles.stageActions}>{actions}</div>}</div>;
}

function SiteReviewPanel({ run }: { run: PipelineRun }) {
  const review = useMemo(() => buildSiteReview(run.result!), [run.result]);
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = review.findings.filter(finding => (priority === 'all' || finding.priority === priority)
    && (!query || `${finding.title} ${finding.action} ${finding.urls.join(' ')}`.toLowerCase().includes(query)));
  return <>
    <StageHeader icon={<FileSearch size={18} />} title="Site review" meta={`${review.scope} / ${review.analyzedPages} captured pages`} actions={<a className={`${styles.button} ${styles.primaryButton}`} data-testid="review-download" href={`/api/projects/${run.projectId}/runs/${run.id}/export?format=html`} download><Download size={16} />Client report</a>} />
    <MetricStrip>
      <Metric label="Finding categories" value={String(review.findings.length)} />
      <Metric label="High priority" value={String(review.highPriority)} />
      <Metric label="URLs to review" value={String(review.affectedUrls)} />
      <Metric label="HTML pages recovered" value={String(review.recoveredPages)} />
    </MetricStrip>
    <section className={styles.dataSection} aria-label="Prioritized findings">
      <div className={`${styles.sectionBar} ${styles.reviewToolbar}`}>
        <div className={styles.subsectionHeading}><h4>Prioritized findings</h4><span>{visible.length} of {review.findings.length}</span></div>
        <div className={styles.toolbar}>
          <label className={styles.searchField}><Search size={15} /><span className={styles.srOnly}>Search findings</span><input type="search" placeholder="Search findings or URLs" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className={styles.selectField}><ListFilter size={15} /><span className={styles.srOnly}>Finding priority</span><select value={priority} onChange={event => setPriority(event.target.value)}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><ChevronDown size={14} /></label>
        </div>
      </div>
      {visible.map(finding => <details key={finding.code} className={styles.reviewFinding} data-testid={`finding-${finding.code}`}>
        <summary><ChevronDown size={16} /><span><strong>{finding.title}</strong><small>{finding.urls.length ? `${finding.urls.length} affected URLs` : 'Run-level finding'} / {finding.occurrences} occurrences</small></span><span className={`${styles.reviewPriority} ${styles[`priority_${finding.priority}`]}`}>{finding.priority}</span></summary>
        <div className={styles.reviewDetail}><p>{finding.action}</p>{finding.evidence.length > 0 && <p className={styles.secondaryText}>Evidence: {finding.evidence.join('; ')}</p>}{finding.urls.length > 0 && <div className={styles.reviewUrls} role="region" tabIndex={0} aria-label={`Affected URLs: ${finding.title}`}><ul>{finding.urls.map(url => <li key={url}><code>{url}</code></li>)}</ul></div>}</div>
      </details>)}
      {!visible.length && <div className={styles.inlineEmpty}>{review.findings.length ? 'No findings match these filters.' : 'No findings recorded by these checks. Manual review is still required.'}</div>}
    </section>
    <details className={styles.scopeDetails}><summary>Scope and limitations<ChevronDown size={14} /></summary><ul className={styles.messageList}>{review.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
  </>;
}

function CrawlPanel({ run }: { run: PipelineRun }) {
  const result = run.result!;
  const provenance = result.provenance;
  const summary = describeCrawl(result);
  return (
    <>
      <StageHeader icon={<Globe2 size={18} />} title="Captured crawl" meta={`${result.crawl.analyzed} analyzed from ${result.crawl.discovered} discovered URLs`} />
      <NoticeBar tone={result.crawl.allEligibleAnalyzed ? 'success' : 'warning'}><span><strong>{summary.title}.</strong> {summary.message}</span></NoticeBar>
      <MetricStrip>
        <Metric label="Analyzed" value={String(result.crawl.analyzed)} detail={result.crawl.allEligibleAnalyzed ? 'Eligible set complete' : 'Partial eligible set'} />
        <Metric label="Discovered" value={String(result.crawl.discovered)} detail={`Depth ${result.maxCrawlDepth ?? 'unknown'}`} />
        <Metric label="Failed" value={String(result.crawl.counts?.failed ?? 0)} />
        <Metric label="Unattempted" value={String(result.crawl.counts?.unattempted ?? 0)} />
      </MetricStrip>
      <div className={styles.twoColumn}>
        <section className={styles.dataSection}>
          <div className={styles.subsectionHeading}><h4>Snapshot provenance</h4><span>Run-scoped evidence</span></div>
          <dl className={styles.factList}>
            <div><dt>Source</dt><dd>{provenance.synthetic ? `${provenance.profile} benchmark` : 'Public HTTP crawl'}</dd></div>
            {!provenance.synthetic && <div><dt>Captured target</dt><dd>{provenance.sourceUrl ?? 'Not recorded'}</dd></div>}
            {!provenance.synthetic && result.diagnostics && <><div><dt>Effective address</dt><dd>{result.diagnostics.effectiveUrl}</dd></div><div><dt>Robots policy</dt><dd>{result.diagnostics.robots.status}{result.diagnostics.robots.code ? ` / ${result.diagnostics.robots.code}` : ''}</dd></div></>}
            {provenance.synthetic ? <>
              <div><dt>Reference</dt><dd>{provenance.referenceUrl ?? 'Not recorded'}</dd></div>
              <div><dt>Seed</dt><dd>{provenance.seed ?? 'Not applicable'}</dd></div>
              <div><dt>Noise profile</dt><dd>{provenance.noise ?? 'Not recorded'}</dd></div>
              <div><dt>Canonical fingerprint</dt><dd><code title={provenance.canonicalSha256 ?? undefined}>{shortHash(provenance.canonicalSha256)}</code></dd></div>
              <div><dt>Noise events</dt><dd>{provenance.noiseEvents}</dd></div>
            </> : <>
              <div><dt>Capture mode</dt><dd>HTTP source</dd></div>
              <div><dt>Benchmark accuracy</dt><dd>Unavailable: no answer key</dd></div>
            </>}
            <div><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd></div>
          </dl>
        </section>
        <section className={styles.dataSection}>
          <div className={styles.subsectionHeading}><h4>Crawl disposition</h4><span>{result.crawl.frontierExhausted ? 'Frontier exhausted' : 'Frontier stopped'}</span></div>
          <dl className={styles.factList}>
            {Object.entries(result.crawl.counts ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => <div key={label}><dt>{label.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>)}
            <div><dt>Outcome</dt><dd>{summary.title}</dd></div>
          </dl>
        </section>
      </div>
      <section className={styles.dataSection}>
        <div className={styles.subsectionHeading}><h4>URL outcomes</h4><span>{result.outcomes.length} recorded</span></div>
        {result.outcomes.length ? <div className={styles.outcomeTable} tabIndex={0} aria-label="URL outcome records"><div className={styles.outcomeHead}><span>State</span><span>URL</span><span>Reason</span></div>{result.outcomes.map((outcome, index) => <div className={styles.outcomeRow} key={`${outcome.url}-${index}`}><StatusPill value={outcome.state} /><code>{outcome.url}</code><span>{outcome.reason ?? '-'}</span></div>)}</div> : <div className={styles.inlineEmpty}>No URL outcomes were recorded.</div>}
      </section>
    </>
  );
}

function CleanupPanel({ result, excluded, setExcluded, dirty, busy, onApply }: {
  result: NonNullable<PipelineRun['result']>;
  excluded: Set<string>;
  setExcluded: (value: Set<string>) => void;
  dirty: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  const [search, setSearch] = useState('');
  const [cluster, setCluster] = useState('all');
  const [guard, setGuard] = useState('');
  const normalized = search.trim().toLowerCase();
  const visible = result.pages.filter((page) => (cluster === 'all' || page.cluster === cluster) && (!normalized || `${page.title} ${page.url}`.toLowerCase().includes(normalized)));
  const includedCount = result.pages.length - excluded.size;

  function toggle(url: string) {
    const next = new Set(excluded);
    if (next.has(url)) {
      next.delete(url);
      setGuard('');
    } else {
      if (includedCount <= 1) {
        setGuard('Keep at least one page in the analysis.');
        return;
      }
      next.add(url);
      setGuard('');
    }
    setExcluded(next);
  }

  return (
    <>
      <StageHeader
        icon={<ListFilter size={18} />}
        title="Cleanup selection"
        meta={`${includedCount} included / ${excluded.size} excluded`}
        actions={<><button className={styles.button} type="button" disabled={!excluded.size || busy} onClick={() => { setExcluded(new Set()); setGuard(''); }}><RotateCcw size={15} />Restore all</button><button className={`${styles.button} ${styles.primaryButton}`} data-testid="apply-cleanup" type="button" disabled={!dirty || busy || includedCount < 1} onClick={onApply}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <RefreshCw size={15} />}Apply &amp; re-cluster</button></>}
      />
      <NoticeBar tone="warning"><CircleAlert size={16} />Excluded benchmark pages remain part of full-population coverage and may reduce the score.</NoticeBar>
      {guard && <NoticeBar tone="error">{guard}</NoticeBar>}
      <div className={styles.panelToolbar}>
        <label className={styles.searchField}><Search size={15} /><span className={styles.srOnly}>Search cleanup pages</span><input type="search" placeholder="Filter pages" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className={styles.selectField}><span className={styles.srOnly}>Filter cleanup pages by cluster</span><select aria-label="Filter cleanup pages by cluster" value={cluster} onChange={(event) => setCluster(event.target.value)}><option value="all">All groups</option>{result.clusters.map((item) => <option key={item.id} value={item.id}>{result.labels?.[item.id] || item.name}</option>)}</select><ChevronDown size={14} /></label>
      </div>
      <div className={styles.selectionList}>
        <div className={styles.selectionHead}><span>Include</span><span>Page</span><span>Group</span><span>Fields</span></div>
        {visible.map((page, index) => {
          const checked = !excluded.has(page.url);
          return <label className={`${styles.selectionRow} ${!checked ? styles.excludedRow : ''}`} key={page.url}><span><input data-testid={`cleanup-toggle-${index}`} type="checkbox" checked={checked} onChange={() => toggle(page.url)} /><span className={styles.srOnly}>{checked ? 'Included' : 'Excluded'}</span></span><span><strong>{page.title || 'Untitled page'}</strong><code>{page.url}</code></span><span>{page.cluster}</span><span>{Object.keys(page.fields).length}</span></label>;
        })}
      </div>
    </>
  );
}

function ClusteringPanel({ result, threshold, setThreshold, dirty, busy, onRecluster }: {
  result: NonNullable<PipelineRun['result']>;
  threshold: number;
  setThreshold: (value: number) => void;
  dirty: boolean;
  busy: boolean;
  onRecluster: () => void;
}) {
  const counts = result.clusters.map((cluster) => cluster.count);
  return (
    <>
      <StageHeader
        icon={<Layers3 size={18} />}
        title="Page Clustering"
        meta={`${result.clusters.length} groups from ${result.pages.filter((page) => !page.excluded).length} included pages`}
        actions={<button className={`${styles.button} ${styles.primaryButton}`} data-testid="recluster-button" type="button" disabled={busy || !Number.isFinite(threshold)} onClick={onRecluster}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <RefreshCw size={15} />}{dirty ? 'Re-cluster changes' : 'Re-cluster'}</button>}
      />
      <details className={styles.clusterRules}><summary>Cluster Rules</summary><div className={styles.ruleAction}><label>Merge distance threshold<input data-testid="threshold-input" type="number" min="0" max="1" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.min(1, Math.max(0, Number(event.target.value))))} /></label><span>{dirty ? 'Unsaved rule' : 'Snapshot rule'} / optional fields allowed</span></div></details>
      <MetricStrip>
        <Metric label="Total Clusters" value={String(result.clusters.length)} />
        <Metric label="Leaf Clusters" value={String(result.clusters.length)} detail="Flat grouping; all clusters are leaves" />
        <Metric label="Largest Cluster" value={counts.length ? String(Math.max(...counts)) : '0'} />
        <Metric label="Avg Pages/Cluster" value={counts.length ? (counts.reduce((sum, count) => sum + count, 0) / counts.length).toFixed(1) : '0'} />
      </MetricStrip>
      <MetricStrip>
        <Metric label="Total Pages" value={String(counts.reduce((sum,count) => sum + count,0))} />
        <Metric label="Max Depth" value={String(result.maxCrawlDepth ?? 0)} detail="Crawl link depth" />
        <Metric label="Smallest Cluster" value={counts.length ? String(Math.min(...counts)) : '0'} />
        <Metric label="Unlabeled Pages" value={String(result.clusters.filter(cluster => !result.labels?.[cluster.id]).reduce((sum,cluster) => sum + cluster.count,0))} />
      </MetricStrip>
      {result.clusters.length === 0 ? <div className={styles.inlineEmpty}>No structural groups were produced.</div> : <div className={styles.clusterList}>{result.clusters.map((cluster) => <ClusterInspector key={cluster.id} cluster={cluster} label={result.labels?.[cluster.id]} insight={result.clusterInsights?.[cluster.id]} />)}</div>}
    </>
  );
}

function downloadConverted(run: PipelineRun) {
  const blob = new Blob([JSON.stringify({ version: 1, sourceRun: run.id, target: 'wordpress', posts: convertPages(run.result) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `pagepilot-wordpress-${run.id}.json`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ConvertedRecord = { sourceUrl: string; title: string; slug: string; content: string; status: string; cluster: string; fields: Record<string, string> };
function ConversionPanel({ run }: { run: PipelineRun }) {
  const records: ConvertedRecord[] = useMemo(() => convertPages(run.result), [run.result]);
  const [selected, setSelected] = useState(records[0]?.sourceUrl ?? '');
  const record = records.find(record => record.sourceUrl === selected);
  return <>
    <StageHeader icon={<Braces size={18} />} title="Content Conversion" meta={`${records.length} included pages / WordPress draft records`} actions={<button className={`${styles.button} ${styles.primaryButton}`} data-testid="download-converted" disabled={!records.length} onClick={() => downloadConverted(run)}><Download size={16} />Download converted JSON</button>} />
    {record ? <>
      <label className={styles.field}>Preview page<select aria-label="Preview page" value={selected} onChange={event => setSelected(event.target.value)}>{records.map(record => <option key={record.sourceUrl} value={record.sourceUrl}>{record.title}</option>)}</select></label>
      <dl className={styles.factList}><div><dt>Title</dt><dd>{record.title}</dd></div><div><dt>Slug</dt><dd>{record.slug}</dd></div><div><dt>Source URL</dt><dd>{record.sourceUrl}</dd></div><div><dt>Status</dt><dd>Draft</dd></div><div><dt>Cluster</dt><dd>{record.cluster}</dd></div></dl>
      <div className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Converted HTML</h4><span>Escaped captured fields</span></div><pre className={styles.codePreview}>{record.content}</pre></div>
    </> : <div className={styles.inlineEmpty}>No included pages to convert.</div>}
  </>;
}

type WordPressReceipt = { sourceUrl: string; id: number; link: string };
function WordPressPanel({ run }: { run: PipelineRun }) {
  const records: ConvertedRecord[] = useMemo(() => convertPages(run.result), [run.result]);
  const [siteUrl, setSiteUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ created: WordPressReceipt[]; failed: {sourceUrl:string;error:string}[]; uncertain:boolean } | null>(null);
  const visible = records.filter(record => `${record.title} ${record.sourceUrl}`.toLowerCase().includes(search.toLowerCase()));
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !authorized || !selected.size) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${run.projectId}/runs/${run.id}/wordpress`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteUrl,username,applicationPassword:password,pageUrls:[...selected]})});
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(messageFromPayload(payload,'WordPress did not accept this request.'));
      const result = payload as NonNullable<typeof receipt>; setReceipt(result);
      setSelected(new Set(result.failed.map(item => item.sourceUrl)));
      setAuthorized(false);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); setPassword(''); }
  }
  return <>
    <StageHeader icon={<PanelTop size={18} />} title="WordPress CMS" meta="Draft posts / HTTPS / Application Password" actions={<button className={styles.button} type="button" disabled={!records.length} onClick={() => downloadConverted(run)}><Download size={16} />Download records</button>} />
    <form className={styles.cmsForm} aria-label="WordPress draft export" onSubmit={event => void send(event)}>
      <fieldset disabled={busy}><legend>Destination</legend><div className={styles.cmsConnection}>
        <label className={styles.field}>WordPress site<input type="url" required placeholder="https://your-wordpress-site.com" value={siteUrl} onChange={event => setSiteUrl(event.target.value)} /></label>
        <label className={styles.field}>Username<input required autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label className={styles.field}>Application Password<input required type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label>
      </div></fieldset>
      <div className={styles.sectionBar}><h4>{selected.size} / 10 selected</h4><label className={styles.searchField}><Search size={15} /><span className={styles.srOnly}>Search WordPress pages</span><input type="search" placeholder="Search pages" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className={styles.cmsPages}>{visible.map(record => <label key={record.sourceUrl}><input type="checkbox" aria-label={`Select ${record.title}`} checked={selected.has(record.sourceUrl)} disabled={busy || !selected.has(record.sourceUrl) && selected.size >= 10} onChange={() => { const next = new Set(selected); next.has(record.sourceUrl) ? next.delete(record.sourceUrl) : next.add(record.sourceUrl); setSelected(next); }} /><span><strong>{record.title}</strong><code>{record.sourceUrl}</code></span><span>Draft</span></label>)}{!visible.length && <p className={styles.inlineEmpty}>No pages match.</p>}</div>
      <label className={styles.cmsConsent}><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)} />I have permission to copy these pages to this WordPress site.</label>
      {error && <p role="alert" className={styles.formError}>{error}</p>}
      <div className={styles.cmsSubmit}><span>Drafts only. Credentials are not saved.</span><button type="submit" className={`${styles.button} ${styles.primaryButton}`} disabled={busy || !authorized || !selected.size || !password || !username || !siteUrl}>{busy ? <LoaderCircle size={16} className={styles.spin} /> : <PanelTop size={16} />}{busy ? 'Sending drafts...' : 'Create WordPress drafts'}</button></div>
    </form>
    {receipt && <section className={styles.dataSection} aria-label="WordPress export result"><h4>{receipt.created.length} drafts confirmed / {receipt.failed.length} not confirmed</h4>{receipt.uncertain && <p role="alert" className={styles.formError}>A response was unclear. Check WordPress before retrying; a draft may already exist.</p>}{receipt.created.map(item => <p className={styles.receiptRow} key={item.sourceUrl}><CheckCircle2 size={15} />Draft #{item.id} <code>{item.sourceUrl}</code>{item.link && <a href={item.link} target="_blank" rel="noreferrer">Open draft</a>}</p>)}{receipt.failed.map(item => <p className={styles.receiptRow} key={item.sourceUrl}><CircleAlert size={15} /><code>{item.sourceUrl}</code>{item.error}</p>)}</section>}
  </>;
}

function ClusterInspector({ cluster, label, insight }: {
  cluster: NonNullable<PipelineRun['result']>['clusters'][number];
  label?: string;
  insight?: ClusterInsight;
}) {
  return (
    <details className={styles.clusterInspector}>
      <summary>
        <span className={styles.clusterIndex}>{cluster.id.replace(/[^0-9]/g, '') || cluster.id.slice(-2)}</span>
        <span className={styles.clusterName}><strong>{label || cluster.name}</strong><code>{cluster.id}</code></span>
        <span className={styles.clusterStat}><strong>{cluster.count}</strong><small>pages</small></span>
        <span className={styles.clusterStat}><strong>{insight?.cohesion == null ? 'N/A' : insight.cohesion.toFixed(3)}</strong><small>cohesion</small></span>
        <span className={styles.clusterStat}><strong>{insight?.sharedFields.length ?? cluster.fields.length}</strong><small>{insight ? 'shared fields' : 'common fields'}</small></span>
        <ChevronDown size={16} />
      </summary>
      <div className={styles.inspectorBody}>
        <div className={styles.inspectorOverview}>
          <dl className={styles.factList}>
            <div><dt>Representative</dt><dd><code>{insight?.representativeUrl ?? cluster.urls[0] ?? 'Not recorded'}</code></dd></div>
            <div><dt>{insight ? 'Shared fields' : 'Common fields (legacy)'}</dt><dd><TagList values={insight?.sharedFields ?? cluster.fields} empty="None" /></dd></div>
            <div><dt>Variable fields</dt><dd><TagList values={insight?.variableFields ?? []} empty="None observed" /></dd></div>
            <div><dt>Path patterns</dt><dd><TagList values={insight?.pathPatterns ?? []} empty="Not available" /></dd></div>
          </dl>
        </div>
        <div className={styles.fieldTableWrap} tabIndex={0} aria-label="Observed field records">
          <table className={styles.fieldTable}>
            <thead><tr><th>Field</th><th>Presence</th><th>Type</th><th>Observed examples</th></tr></thead>
            <tbody>{insight?.fields?.length ? insight.fields.map((field) => <tr key={field.name}><td><code>{field.name}</code></td><td><strong>{field.present}/{field.total}</strong><span>{Math.round(field.coverage * 100)}%</span></td><td><span className={styles.typePill}>{field.inferredType}</span></td><td>{field.examples.length ? field.examples.map((example) => <span className={styles.exampleValue} key={example}>{example}</span>) : '-'}</td></tr>) : cluster.fields.map((field) => <tr key={field}><td><code>{field}</code></td><td>Not recorded</td><td>Not recorded</td><td>Not recorded for this run</td></tr>)}</tbody>
          </table>
        </div>
        {insight?.layoutVariants?.length ? <section className={styles.insightSection}><h4>Layout signatures</h4>{insight.layoutVariants.map((variant) => <div className={styles.layoutVariant} key={variant.signature}><span>{variant.pages} page{variant.pages === 1 ? '' : 's'}</span><code>{variant.signature}</code></div>)}</section> : null}
        {insight?.notes?.length ? <section className={styles.insightSection}><h4>Cohesion notes</h4><ul>{insight.notes.map((note) => <li key={note}>{note}</li>)}</ul></section> : null}
      </div>
    </details>
  );
}

function LabelingPanel({ result, labels, setLabels, dirty, busy, onSave }: {
  result: NonNullable<PipelineRun['result']>;
  labels: Record<string, string>;
  setLabels: (value: Record<string, string>) => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  const labeled = result.clusters.filter((cluster) => labels[cluster.id]?.trim()).length;
  return (
    <>
      <StageHeader icon={<Tags size={18} />} title="Run labels" meta={`${labeled} of ${result.clusters.length} groups labeled`} actions={<button className={`${styles.button} ${styles.primaryButton}`} data-testid="save-labels" type="button" disabled={!dirty || busy} onClick={onSave}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <Save size={15} />}Save labels</button>} />
      <div className={styles.labelTable}>
        <div className={styles.labelHead}><span>Group</span><span>Observed structure</span><span>Label</span></div>
        {result.clusters.map((cluster) => {
          const insight = result.clusterInsights?.[cluster.id];
          return <div className={styles.labelRow} key={cluster.id}><div><strong>{cluster.name}</strong><code>{cluster.id} / {cluster.count} pages</code></div><div><TagList values={(insight?.sharedFields ?? cluster.fields).slice(0, 6)} empty="No common fields" />{(insight?.sharedFields.length ?? cluster.fields.length) > 6 && <small>+{(insight?.sharedFields.length ?? cluster.fields.length) - 6} more</small>}</div><label><span className={styles.srOnly}>Label for {cluster.name}</span><Pencil size={15} /><input data-testid={`label-input-${cluster.id}`} maxLength={80} placeholder="Unlabeled" value={labels[cluster.id] ?? ''} onChange={(event) => setLabels({ ...labels, [cluster.id]: event.target.value })} /></label></div>;
        })}
      </div>
    </>
  );
}

function ContentPanel({ run }: { run: PipelineRun }) {
  const result = run.result!;
  const [search, setSearch] = useState('');
  const [cluster, setCluster] = useState('all');
  const normalized = search.trim().toLowerCase();
  const pages = result.pages.filter((page) => (cluster === 'all' || page.cluster === cluster) && (!normalized || `${page.title} ${page.url} ${Object.keys(page.fields).join(' ')}`.toLowerCase().includes(normalized)));
  return (
    <>
      <StageHeader icon={<PanelTop size={18} />} title="Extracted content" meta={`${pages.length} of ${result.pages.length} pages`} />
      <div className={styles.panelToolbar}>
        <label className={styles.searchField}><Search size={15} /><span className={styles.srOnly}>Search page content</span><input type="search" placeholder="Search title, URL, or field" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className={styles.selectField}><span className={styles.srOnly}>Filter page content by cluster</span><select aria-label="Filter page content by cluster" value={cluster} onChange={(event) => setCluster(event.target.value)}><option value="all">All groups</option>{result.clusters.map((item) => <option key={item.id} value={item.id}>{result.labels?.[item.id] || item.name}</option>)}{result.pages.some((page) => page.excluded) && <option value="excluded">Excluded</option>}</select><ChevronDown size={14} /></label>
      </div>
      {pages.length === 0 ? <div className={styles.inlineEmpty}>No pages match this view.</div> : <div className={styles.pageList}>{pages.map((page) => (
        <details className={`${styles.pageRow} ${page.excluded ? styles.pageExcluded : ''}`} key={page.url}>
          <summary><span className={styles.pageIdentity}><strong>{page.title || 'Untitled page'}</strong><code>{page.url}</code></span><span className={styles.pageGroup}>{result.labels?.[page.cluster] || page.cluster}</span><span className={styles.pageFieldCount}>{Object.keys(page.fields).length}<small>fields</small></span><ChevronDown size={16} /></summary>
          <div className={styles.pageBody}>
            <dl className={styles.fetchFacts}><div><dt>HTTP</dt><dd>{page.fetch?.status ?? 'N/A'}</dd></div><div><dt>Payload</dt><dd>{formatBytes(page.fetch?.bytes)}</dd></div><div><dt>Encoding</dt><dd>{page.fetch?.encoding ?? 'Unknown'}</dd></div><div><dt>Links</dt><dd>{page.linkCount ?? 'N/A'}</dd></div><div><dt>SHA-256</dt><dd><code title={page.fetch?.sha256}>{shortHash(page.fetch?.sha256)}</code></dd></div></dl>
            <div className={styles.pageFields}><h4>Fields</h4>{Object.keys(page.fields).length ? <dl>{Object.entries(page.fields).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl> : <p>No extracted fields.</p>}</div>
            {page.tagCounts && Object.keys(page.tagCounts).length > 0 && <div className={styles.tagCounts}><h4>Semantic tag counts</h4><TagList values={Object.entries(page.tagCounts).sort(([left], [right]) => left.localeCompare(right)).map(([tag, count]) => `${tag}:${count}`)} empty="None" /></div>}
            {page.issues.length > 0 && <div className={styles.pageIssues}>{page.issues.map((issue) => <span key={issue.code}>{issue.code} <strong>{issue.count}</strong></span>)}</div>}
          </div>
        </details>
      ))}</div>}
    </>
  );
}

function ValidationPanel({ run }: { run: PipelineRun }) {
  const result = run.result!;
  const problemOutcomes = result.outcomes.filter((outcome) => /fail|skip|unattempt/i.test(outcome.state));
  return (
    <>
      <StageHeader icon={<Gauge size={18} />} title="Validation" meta={result.evaluation.status === 'not_available' ? 'No private answer key' : `Evaluation ${result.evaluation.status}`} />
      <MetricStrip>
        <Metric label="Coverage" value={formatScore(result.metrics.coverage)} detail="full population" />
        <Metric label="Pairwise F1" value={formatScore(result.metrics.pairwiseF1)} detail="group assignments" />
        <Metric label="Value F1" value={formatScore(result.metrics.fieldValueF1)} detail="field extraction" />
        <Metric label="Fields" value={String(result.metrics.fields)} detail="observed values" />
      </MetricStrip>
      <div className={`${styles.evaluation} ${styles[`evaluation_${result.evaluation.status}`]}`}><span>{result.evaluation.status === 'passed' ? <CheckCircle2 size={18} /> : result.evaluation.status === 'failed' ? <CircleX size={18} /> : <CircleAlert size={18} />}</span><div><strong>{result.evaluation.status.replace('_', ' ')}</strong><p>{result.evaluation.reason}</p></div></div>
      <div className={styles.validationGrid}>
        <section className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Warnings</h4><span>{result.warnings.length}</span></div>{result.warnings.length ? <ul className={styles.messageList}>{result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : <div className={styles.inlineEmpty}>No warnings.</div>}</section>
        <section className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Extraction issues</h4><span>{result.issues.length}</span></div>{result.issues.length ? <div className={styles.issueList}>{result.issues.map((issue) => <div key={issue.code}><code>{issue.code}</code><strong>{issue.count}</strong></div>)}</div> : <div className={styles.inlineEmpty}>No extraction issues.</div>}</section>
      </div>
      <section className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Problem URL outcomes</h4><span>{problemOutcomes.length}</span></div>{problemOutcomes.length ? <div className={styles.outcomeTable} tabIndex={0} aria-label="URL outcome records"><div className={styles.outcomeHead}><span>State</span><span>URL</span><span>Reason</span></div>{problemOutcomes.map((outcome, index) => <div className={styles.outcomeRow} key={`${outcome.url}-${index}`}><StatusPill value={outcome.state} /><code>{outcome.url}</code><span>{outcome.reason ?? '-'}</span></div>)}</div> : <div className={styles.inlineEmpty}>No failed, skipped, or unattempted URLs.</div>}</section>
    </>
  );
}

function ExportPanel({ project, run, runs, onSelectRun }: { project: Project; run: PipelineRun; runs: PipelineRun[]; onSelectRun: (runId: string) => void }) {
  const base = `/api/projects/${encodeURIComponent(project.id)}/runs/${encodeURIComponent(run.id)}/export`;
  const provenance = run.result!.provenance;
  return (
    <>
      <StageHeader icon={<Download size={18} />} title="Export snapshot" meta={`Run ${run.id.slice(0, 8)} / ${formatDate(run.finishedAt)}`} />
      <div className={styles.exportActions}>
        <a className={styles.exportButton} data-testid="export-html" href={`${base}?format=html`} download><FileSearch size={22} /><span><strong>Client report</strong><small>Prioritized findings, affected URLs and scope</small></span><Download size={17} /></a>
        <a className={styles.exportButton} data-testid="export-json" href={`${base}?format=json`} download><FileJson size={22} /><span><strong>JSON report</strong><small>Run, metrics, groups, fields, evidence</small></span><Download size={17} /></a>
        <a className={styles.exportButton} data-testid="export-csv" href={`${base}?format=csv`} download><Braces size={22} /><span><strong>CSV records</strong><small>One row per page with labels and fields</small></span><Download size={17} /></a>
      </div>
      <div className={styles.twoColumn}>
        <section className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Export provenance</h4><span>Selected run</span></div><dl className={styles.factList}><div><dt>Run ID</dt><dd><code>{run.id}</code></dd></div><div><dt>Source kind</dt><dd>{run.kind === 'recluster' ? 'Saved crawl snapshot' : 'Fresh crawl'}</dd></div>{run.sourceRunId && <div><dt>Source run</dt><dd><code>{run.sourceRunId}</code></dd></div>}<div><dt>Profile</dt><dd>{provenance.profile}</dd></div><div><dt>Seed</dt><dd>{provenance.seed ?? 'Not applicable'}</dd></div><div><dt>Canonical fingerprint</dt><dd><code title={provenance.canonicalSha256 ?? undefined}>{shortHash(provenance.canonicalSha256)}</code></dd></div></dl></section>
        <section className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Applied rules</h4><span>Selected run</span></div><dl className={styles.factList}><div><dt>Threshold</dt><dd>{run.result?.rules?.threshold?.toFixed(2) ?? 'Legacy default'}</dd></div><div><dt>Excluded URLs</dt><dd>{run.result?.rules?.excludedUrls?.length ?? run.result?.pages.filter((page) => page.excluded).length ?? 0}</dd></div><div><dt>Saved labels</dt><dd>{Object.keys(run.result?.labels ?? {}).length}</dd></div><div><dt>Groups</dt><dd>{run.result?.clusters.length ?? 0}</dd></div><div><dt>Pages</dt><dd>{run.result?.pages.length ?? 0}</dd></div></dl></section>
      </div>
      <section className={styles.dataSection}><div className={styles.subsectionHeading}><h4>Run history</h4><span>{runs.length} snapshots</span></div><div className={styles.historyList}>{runs.map((item) => <button className={item.id === run.id ? styles.historySelected : undefined} type="button" key={item.id} onClick={() => onSelectRun(item.id)}><span><strong>{formatDate(item.startedAt)}</strong><code>{item.id.slice(0, 8)}</code></span><span>{item.kind === 'recluster' ? 'Re-cluster' : 'Fresh crawl'}</span><Status status={item.status} /><span>{item.result ? `${item.result.metrics.pages} pages / ${item.result.metrics.clusters} groups` : 'No result'}</span></button>)}</div></section>
    </>
  );
}

function MetricStrip({ children }: { children: ReactNode }) {
  return <div className={styles.metricStrip}>{children}</div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function TagList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? <span className={styles.tagList}>{values.map((value) => <code key={value}>{value}</code>)}</span> : <span className={styles.secondaryText}>{empty}</span>;
}

function StatusPill({ value }: { value: string }) {
  const tone = /fail|error|blocked/i.test(value) ? 'bad' : /skip|unattempt|excluded/i.test(value) ? 'warn' : 'ok';
  return <strong className={`${styles.statusPill} ${styles[`pill_${tone}`]}`}>{value}</strong>;
}

function NoticeBar({ tone, children }: { tone: 'error' | 'warning' | 'success' | 'running'; children: ReactNode }) {
  return <div className={`${styles.notice} ${styles[`notice_${tone}`]}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function LoadingState({ label }: { label: string }) {
  return <div className={styles.loadingState} role="status"><LoaderCircle className={styles.spin} size={21} /><span>{label}</span></div>;
}

function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className={styles.emptyState}><span className={styles.emptyIcon}>{icon}</span><h2>{title}</h2>{children}</div>;
}

function ProjectDialog({ title, submitLabel, value: controlledValue, busy, error, onChange, onClose, onSubmit, onSubmitValue }: {
  title: string;
  submitLabel: string;
  value: ProjectInput;
  busy: boolean;
  error: string;
  onChange?: (value: ProjectInput) => void;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitValue?: (value: ProjectInput) => void;
}) {
  const [localValue, setLocalValue] = useState(controlledValue);
  const value = onChange ? controlledValue : localValue;
  const update = onChange ?? setLocalValue;
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); returnFocusRef.current?.focus(); };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (onSubmit) return onSubmit(event);
    event.preventDefault();
    onSubmitValue?.(value);
  }

  return (
    <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" aria-describedby={error ? 'project-dialog-error' : undefined} ref={dialogRef}>
        <div className={styles.dialogHeader}><div><span className={styles.eyebrow}>PROJECT</span><h2 id="project-dialog-title">{title}</h2></div><button className={styles.iconButton} type="button" aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={17} /></button></div>
        <form onSubmit={submit}>
          <label className={styles.field}>Name<input ref={nameRef} required maxLength={80} value={value.name} onChange={(event) => update({ ...value, name: event.target.value })} /></label>
          <ProjectFieldsWithoutName value={value} onChange={update} />
          {error && <div className={styles.formError} role="alert" id="project-dialog-error"><CircleX size={15} />{error}</div>}
          <div className={styles.dialogActions}><button className={styles.button} type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={`${styles.button} ${styles.primaryButton}`} type="submit" disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : title === 'New project' ? <Plus size={16} /> : <Save size={16} />}{submitLabel}</button></div>
        </form>
      </div>
    </div>
  );
}

function ProjectFieldsWithoutName({ value, onChange }: { value: ProjectInput; onChange: (value: ProjectInput) => void }) {
  const update = <Key extends keyof ProjectInput>(key: Key, next: ProjectInput[Key]) => onChange({ ...value, [key]: next });
  return (
    <>
      <fieldset className={styles.fieldset}><legend>Source</legend><div className={styles.segmented}><label className={value.mode === 'synthetic' ? styles.segmentSelected : undefined}><input type="radio" name="mode" value="synthetic" checked={value.mode === 'synthetic'} onChange={() => update('mode', 'synthetic')} />Fictional benchmark</label><label className={value.mode === 'public' ? styles.segmentSelected : undefined}><input type="radio" name="mode" value="public" checked={value.mode === 'public'} onChange={() => update('mode', 'public')} />Public URL</label></div></fieldset>
      {value.mode === 'synthetic' ? <div className={styles.formGrid}><label className={styles.field}>Profile<select aria-label="Profile" value={value.profile} onChange={(event) => update('profile', event.target.value as ProjectInput['profile'])}><option value="library">Library</option><option value="archive">Archive</option><option value="government">Government</option></select></label><label className={styles.field}>Noise<select aria-label="Noise" value={value.noise} onChange={(event) => update('noise', event.target.value as ProjectInput['noise'])}><option value="clean">Clean</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label className={styles.field}>Page count<input type="number" required min={12} max={100} step={1} value={value.pageCount} onChange={(event) => update('pageCount', Number(event.target.value))} /></label><label className={styles.field}>Seed<input type="number" required min={0} max={2147483647} step={1} value={value.seed} onChange={(event) => update('seed', Number(event.target.value))} /></label></div> : <><label className={styles.field}>Public URL<input type="url" required pattern="https?://.*" placeholder="https://example.com" value={value.url} onChange={(event) => update('url', event.target.value)} /></label><div className={styles.formGrid}><label className={styles.field}>Path prefix<input required value={value.pathPrefix} onChange={(event) => update('pathPrefix', event.target.value)} /></label><label className={styles.field}>Maximum pages<input type="number" required min={1} max={500} step={1} value={value.maxPages} onChange={(event) => update('maxPages', Number(event.target.value))} /></label><label className={styles.field}>Link depth<input type="number" required min={0} max={10} step={1} value={value.maxDepth ?? 6} onChange={(event) => update('maxDepth', Number(event.target.value))} /></label><label className={styles.field}>Time limit (min)<input type="number" required min={1} max={30} step={1} value={value.maxDurationMinutes ?? 15} onChange={(event) => update('maxDurationMinutes', Number(event.target.value))} /></label></div><p className={styles.operationalNote}><Globe2 size={14} />HTTP crawl / JavaScript rendering unavailable / benchmark scores unavailable</p></>}
      <label className={styles.field}>Default threshold<input type="number" required min={0} max={1} step="0.01" value={value.threshold ?? 0.32} onChange={(event) => update('threshold', Number(event.target.value))} /></label>
    </>
  );
}

export default PagePilot;
