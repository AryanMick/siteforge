'use client';

import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, FileCheck2, FileJson, Gauge, Globe2, Layers3, ListChecks, LoaderCircle, LockKeyhole, Package, Play, RefreshCw, Search, ShieldCheck, Shuffle, SlidersHorizontal, Trash2 } from 'lucide-react';
import { OBSTACLE_CATALOG, TRANSPORT_CATALOG, LEGACY_SERVER_CATALOG, SCENARIO_LABELS, TRANSPORT_LABELS } from '../src/fixture-lab/catalog.mjs';

const RESPONSE_CATALOG = [...TRANSPORT_CATALOG, ...LEGACY_SERVER_CATALOG];
import styles from './fixture-lab.module.css';

type Config = {
  name: string; siteCount: number; pagesPerSite: number; randomPageCount?: boolean; domain: string; framework: string;
  visualStyle: string; noise: string; challenge?: string; seed: number; randomness: number; fieldLayout: string; linkMode?: string; cmsProfile?: string; builderProfile?: string; sourceClutter?: string; optionalFields: boolean | 'random'; scenario: string; transport: string; previewProtocol: string;
};
type Site = { id: string; name: string; domain: string; framework: string; visualStyle: string; structure?: string; cmsProfile?: string; builderProfile?: string; noise: string; pageCount: number; seed: number; clusters: number; noiseEvents: number; transport?: string; transportRules?: number; previewProtocol?: string; caseId?: string; handoff?: { version: number; status: string; directory: string } };
type Job = { id: string; name: string; status: 'running' | 'completed' | 'failed'; config: Config; createdAt: string; finishedAt?: string; diskBytes?: number; handoffBytes?: number; error?: string; completedSites: number; totalPages: number; sites: Site[]; progress?: { siteIndex: number; phase: string; completedPages: number; totalPages: number } };
type JobSummary = Omit<Job, 'sites'>;
type FieldLocation = { state: string; selector?: string; read?: string; precision?: string; label?: string; reason?: string };
type AnswerPage = { pageId: string; url: string; kind: string; contentType: string; expectedCluster: string; fields: Record<string, unknown>; canonicalValues: Record<string, unknown>; fieldSelectors?: Record<string, string>; fieldLocations?: Record<string, FieldLocation>; fieldStates: Record<string, string>; repeatedItems?: { pageId: string; url: string; fields: Record<string, unknown> }[]; repeatedItemLocations?: { pageId: string; url: string; fieldLocations: Record<string, FieldLocation> }[]; noiseEvents: { type: string; severity: number; preservesSemantics: boolean }[]; fieldLayout?: string };
type TransportRule = { path: string; type: string; status: number; expected: { availability: string; finalPath: string | null } };
type Answers = { pages: AnswerPage[]; schemaDefinitions: Record<string, { required: string[]; optional: string[]; repeatedItemSchema?: { name: string; type: string; optional?: boolean }[] }>; transport?: { profile: string; rules: TransportRule[] }; pagination: { total: number; matched: number; offset: number; limit: number }; coverage: { counts: Record<string, number>; affectedPages: number } };
const defaults: Config = { name: 'Legacy library test set', siteCount: 1, pagesPerSite: 60, domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'high', challenge: 'standard', seed: 48291, randomness: 50, fieldLayout: 'mixed', linkMode: 'root-relative', cmsProfile: 'none', builderProfile: 'none', sourceClutter: 'realistic', optionalFields: true, scenario: 'legacy-clutter', transport: 'none', previewProtocol: 'http' };
const domains = ['library', 'government', 'municipality', 'university', 'healthcare', 'documentation', 'museum', 'nonprofit', 'records', 'news', 'mixed', 'random'];
const formatBytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
const label = (value: string) => ({ html: 'HTML', react: 'React', angular: 'Angular', http: 'HTTP', https: 'HTTPS', wordpress: 'WordPress', drupal: 'Drupal', hubspot: 'HubSpot', aem: 'Adobe Experience Manager', squarespace: 'Squarespace', webflow: 'Webflow', joomla: 'Joomla', sitecore: 'Sitecore', wix: 'Wix', shopify: 'Shopify', ghost: 'Ghost', 'root-relative': 'Root relative', relative: 'Page relative', 'base-relative': 'Document base relative', absolute: 'Fully qualified', 'definition-list': 'Definition lists', paragraphs: 'Paragraphs', table: 'Tables', mixed: 'Mixed', nonprofit: 'Nonprofit', municipality: 'Local government', government: 'Government', records: 'Public records' }[value] || value.charAt(0).toUpperCase() + value.slice(1));
const format = (value: number) => value.toLocaleString('en-US');
const fieldValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
const siteBase = (jobId: string, siteId: string) => `/api/fixtures/${jobId}/sites/${siteId}`;
const savedRequestTimeout = 12000;
// A number box that can be cleared while typing (2026-11-04): the text is kept as typed, an empty or partial value
// reports NaN (so the form shows its error instead of snapping to 0), and leaving an empty box puts back the number
// it had when you clicked into it.
type NumberFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: number; onValue: (value: number) => void };
function NumberField({ value, onValue, onBlur, onFocus, ...props }: NumberFieldProps) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  const before = useRef(Number.isFinite(value) ? value : 0);
  useEffect(() => {
    // Settings changed elsewhere (Randomize, Repeat, the random-pages box) show up in the field.
    if (Number.isFinite(value) && Number(text) !== value) setText(String(value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <input {...props} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={text}
    onFocus={event => { if (Number.isFinite(value)) before.current = value; onFocus?.(event); }}
    onChange={event => {
      const next = event.target.value.replace(/[^0-9]/g, '');
      setText(next);
      onValue(next === '' ? Number.NaN : Number(next));
    }}
    onBlur={event => {
      if (text === '') { setText(String(before.current)); onValue(before.current); }
      onBlur?.(event);
    }} />;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The request could not be completed. Please try again.');
  return body as T;
}

export function FixtureLab() {
  const [config, setConfig] = useState<Config>(defaults);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [savedIssues, setSavedIssues] = useState<{ id: string; message: string }[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [jobResult, setJobResult] = useState<{ key: string; job: Job } | null>(null);
  const [jobFailure, setJobFailure] = useState<{ key: string; message: string } | null>(null);
  const [jobAttempt, setJobAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [listAttempt, setListAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'sites' | 'answers' | 'coverage'>('sites');
  const [answerSite, setAnswerSite] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState('');
  // Scores of uploaded tool results, per job/site (2026-11-02); the answer key stays on the server.
  const [scores, setScores] = useState<Record<string, { busy?: boolean; error?: string; report?: ScoreReport; file?: string }>>({});
  const [copied, setCopied] = useState('');
  const [siteQuery, setSiteQuery] = useState('');
  const [sitePage, setSitePage] = useState(0);
  const [freshSeed, setFreshSeed] = useState(true);
  const [workspaceView, setWorkspaceView] = useState<'create' | 'saved'>('create');
  const [listQuery, setListQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const jobRequestKey = `${selectedId}/${jobAttempt}`;
  const selectedJob = jobResult?.key === jobRequestKey ? jobResult.job : null;
  const jobError = jobFailure?.key === jobRequestKey ? jobFailure.message : '';
  const randomPages = config.randomPageCount === true;
  // 0 pages means "random page count" (5 to 200 per site, within the 100,000-page budget), as the server treats it.
  const zeroPages = !randomPages && config.pagesPerSite === 0;
  const randomRange = randomPages || zeroPages;
  const rawTotalPages = config.siteCount * (zeroPages ? Math.min(200, Math.floor(100000 / Math.max(1, config.siteCount))) : config.pagesPerSite);
  const totalPages = Number.isFinite(rawTotalPages) ? rawTotalPages : 0; // a box being retyped is empty (NaN) for a moment
  // Measured October 30 2026: realistic page source about 92 KB per page, clean about 27 KB, plus shared assets per site.
  const realisticSource = (config.sourceClutter ?? 'realistic') === 'realistic';
  const diskBytes = (pages: number) => config.siteCount * (realisticSource ? 1_000_000 : 450_000) + pages * (realisticSource ? 92_000 : 27_000);
  const disk = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  const active = jobs.some(job => job.status === 'running') || selectedJob?.status === 'running';
  // Random sizes share the 100,000-page budget, so only fixed sizes can exceed it.
  const overLimit = !randomPages && totalPages > 100000;
  const validPages = Number.isInteger(config.pagesPerSite) && (zeroPages || (config.pagesPerSite >= 5 && config.pagesPerSite <= 100000));
  const validSiteCount = Number.isInteger(config.siteCount) && config.siteCount >= 1 && config.siteCount <= 500;
  const validName = config.name.trim().length > 0 && config.name.trim().length <= 80;
  const seedInRange = Number.isInteger(config.seed) && config.seed >= 0 && config.seed <= 4294967295;
  const validSeed = freshSeed || seedInRange;
  const validConfig = validName && validPages && validSiteCount && validSeed && !overLimit;
  const matchingJobs = jobs.filter(item => `${item.name} ${item.id} ${item.status}`.toLowerCase().includes(listQuery.toLowerCase()));
  function selectJob(id: string) {
    setSelectedId(id); setView('sites'); setAnswerSite(''); setWorkspaceView('saved');
  }
  function showLibrary() {
    setSelectedId(''); setJobResult(null); setJobFailure(null); setConfirmDelete(false);
    const address = new URL(window.location.href); address.searchParams.delete('job');
    window.history.replaceState(window.history.state, '', address);
  }
  function scrollToWorkspace() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => document.getElementById('fixture-workspace-start')?.scrollIntoView({ block: 'start' }));
    }
  }
  useEffect(() => {
    if (error && window.matchMedia('(max-width: 760px)').matches) {
      document.getElementById('fixture-request-error')?.scrollIntoView({ block: 'start' });
    }
  }, [error]);
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (confirmDelete && !dialog.open) {
      dialog.showModal();
      document.getElementById('fixture-delete-cancel')?.focus();
    } else if (!confirmDelete && dialog.open) {
      dialog.close();
      deleteTriggerRef.current?.focus();
    }
  }, [confirmDelete]);
  function set<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig(previous => {
      const next = { ...previous, [key]: value };
      if (key === 'scenario' && value === 'client-delay' && ['html', 'mixed', 'random'].includes(next.framework)) next.framework = 'react';
      if (key === 'framework' && ['html', 'mixed', 'random'].includes(String(value)) && next.scenario === 'client-delay') next.scenario = 'baseline';
      if (key === 'cmsProfile' && value !== 'wordpress' && value !== 'random') next.builderProfile = 'none';
      if (key === 'builderProfile' && value !== 'none' && value !== 'random') next.cmsProfile = 'wordpress';
      return next;
    });
  }
  function randomizeSettings() {
    setConfig(previous => ({ ...previous, randomPageCount: true, pagesPerSite: 100000, domain: 'random', framework: 'random', visualStyle: 'random', noise: 'random', challenge: 'random', fieldLayout: 'random', linkMode: 'random', cmsProfile: 'random', builderProfile: 'random', optionalFields: 'random', scenario: 'random', transport: 'random', previewProtocol: 'http' }));
  }

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('job');
    if (fromUrl && /^[0-9a-f-]{36}$/.test(fromUrl)) { setSelectedId(fromUrl); setWorkspaceView('saved'); }
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    async function refresh() {
      let delay = 15000;
      controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, savedRequestTimeout);
      try {
        const response = await request<{ jobs: JobSummary[]; issues?: { id: string; message: string }[] }>('/api/fixtures?summary=1', { signal: controller.signal });
        if (disposed) return;
        setJobs(response.jobs);
        setSavedIssues(response.issues ?? []);
        setListError('');
        setLoading(false);
        if (response.jobs.some(item => item.status === 'running')) delay = 1800;
      } catch (failure) { if (!disposed) { setListError(timedOut ? 'The test set list request timed out.' : (failure as Error).message); setLoading(false); } }
      finally { clearTimeout(timeout); controller = undefined; }
      if (!disposed) timer = setTimeout(refresh, delay);
    }
    void refresh();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [listAttempt]);

  useEffect(() => {
    if (!selectedId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    setJobResult(null);
    setJobFailure(null);
    setSiteQuery(''); setSitePage(0);
    const address = new URL(window.location.href);
    address.searchParams.set('job', selectedId);
    window.history.replaceState(window.history.state, '', address);
    async function refresh() {
      controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, savedRequestTimeout);
      try {
        const { job } = await request<{ job: Job }>(`/api/fixtures/${selectedId}`, { signal: controller.signal });
        if (disposed) return;
        setJobResult({ key: jobRequestKey, job });
        setJobFailure(null);
        setJobs(previous => previous.map(item => item.id === job.id ? job : item));
        if (job.status === 'running') timer = setTimeout(refresh, 900);
      } catch (failure) { if (!disposed) setJobFailure({ key: jobRequestKey, message: timedOut ? 'The test set request timed out.' : (failure as Error).message }); }
      finally { clearTimeout(timeout); controller = undefined; }
    }
    void refresh();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [selectedId, jobAttempt]);

  async function repeatJob() {
    if (!selectedJob || submitting || active || listError) return;
    setSubmitting(true); setError('');
    try {
      const { job } = await request<{ job: Job }>('/api/fixtures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selectedJob.config, freshSeed: false }),
      });
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); selectJob(job.id); scrollToWorkspace();
    } catch (failure) { setError((failure as Error).message); }
    finally { setSubmitting(false); }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || active || listError || !validConfig) return;
    setSubmitting(true); setError('');
    try {
      const { job } = await request<{ job: Job }>('/api/fixtures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, freshSeed }) });
      set('seed', job.config.seed);
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); selectJob(job.id); scrollToWorkspace();
    } catch (failure) { setError((failure as Error).message); }
    finally { setSubmitting(false); }
  }
  async function preview(site: Site) {
    if (!selectedJob) return;
    setOpening(site.id); setError('');
    try {
      const { url } = await request<{ url: string }>(`${siteBase(selectedJob.id, site.id)}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setPreviews(previous => ({ ...previous, [`${selectedJob.id}/${site.id}`]: url }));
    } catch (failure) { setError((failure as Error).message); }
    finally { setOpening(''); }
  }
  async function scoreResult(site: Site, file: File | undefined) {
    if (!selectedJob || !file) return;
    const key = `${selectedJob.id}/${site.id}`;
    setScores(previous => ({ ...previous, [key]: { busy: true, file: file.name } }));
    try {
      let output: unknown;
      try { output = JSON.parse(await file.text()); } catch { throw new Error(`${file.name} is not JSON.`); }
      const { report } = await request<{ report: ScoreReport }>(`${siteBase(selectedJob.id, site.id)}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(output) });
      setScores(previous => ({ ...previous, [key]: { report, file: file.name } }));
    } catch (failure) { setScores(previous => ({ ...previous, [key]: { error: (failure as Error).message, file: file.name } })); }
  }
  async function deleteJob() {
    if (!selectedId || deleting) return;
    setDeleting(true); setDeleteError('');
    try {
      await request<{ deleted: true; id: string }>(`/api/fixtures/${selectedId}`, { method: 'DELETE' });
      const deletedId = selectedId;
      setJobs(previous => previous.filter(item => item.id !== deletedId));
      setPreviews(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${deletedId}/`))));
      showLibrary();
    } catch (failure) { setDeleteError((failure as Error).message); }
    finally { setDeleting(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(value); setTimeout(() => setCopied(''), 2000); }
    catch { setError('Clipboard unavailable. The preview address is shown below the site name.'); }
  }
  const job = selectedJob?.id === selectedId && !jobError ? selectedJob : null;
  const generatedPages = job?.sites.reduce((sum, site) => sum + site.pageCount, 0) ?? 0;
  const matchingSites = job?.sites.filter(site => `${site.name} ${site.id} ${site.domain} ${site.framework} ${site.previewProtocol || 'http'}`.toLowerCase().includes(siteQuery.toLowerCase())) || [];
  const lastSitePage = Math.max(0, Math.ceil(matchingSites.length / 25) - 1);
  const currentSitePage = Math.min(sitePage, lastSitePage);
  const visibleSites = matchingSites.slice(currentSitePage * 25, currentSitePage * 25 + 25);

  return <div className={styles.app}>
    <header className={styles.topbar}>
      <a href="/" className={styles.brand}><Layers3 size={23} strokeWidth={1.7} /><span>SiteForge</span></a>
      <nav aria-label="Workspace"><span aria-current="page">Test websites</span></nav>
      <span className={styles.local}><span />Local workspace</span>
    </header>
    <main className={styles.main}>
      <div className={styles.heading}><div><div className={styles.eyebrow}>SOURCE WEBSITE GENERATOR</div><h1>Test sets</h1><p className={styles.purpose}>Makes fictional websites for testing a crawler or migration tool. Every website comes with a private answer key that lists each page and field, so you can check what your tool extracted.</p></div><span className={styles.private}><LockKeyhole size={15} />Private answer keys</span></div>
      <ol className={styles.howItWorks} aria-label="How it works"><li><strong>1. Choose</strong>How many websites, how big and what kind.</li><li><strong>2. Generate</strong>Builds the websites and their answer keys on this computer.</li><li><strong>3. Test</strong>Point your tool at a preview address, or install a site into WordPress or Drupal, then compare its output with the answer key.</li></ol>
      {error && <div id="fixture-request-error" className={styles.error} role="alert"><CircleAlert size={18} /><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div>}
      {savedIssues.length > 0 && <div className={styles.savedIssues} role="status"><CircleAlert size={16} /><span>{savedIssues.length} saved test {savedIssues.length === 1 ? 'set is' : 'sets are'} unreadable. Existing files were preserved.</span><details><summary>IDs</summary><code>{savedIssues.map(issue => issue.id).join(', ')}</code></details></div>}
      <div id="fixture-workspace-start" className={styles.workspaceAnchor} aria-hidden="true" />
      <div id="fixture-workspace-switch" className={styles.workspaceNav} role="group" aria-label="Workspace views"><button type="button" aria-pressed={workspaceView === 'create'} aria-controls="fixture-settings" onClick={() => { setWorkspaceView('create'); scrollToWorkspace(); }}><SlidersHorizontal size={17} />Create</button><button type="button" aria-pressed={workspaceView === 'saved'} aria-controls="fixture-results" onClick={() => { setWorkspaceView('saved'); scrollToWorkspace(); }}><ListChecks size={17} />Saved test sets <span>{jobs.length}</span>{(listError || jobError) && <CircleAlert size={14} className={styles.mobileNavAlert} aria-label="Saved test sets unavailable" />}</button></div>
      <div className={styles.workspace} data-workspace-view={workspaceView}>
        <section id="fixture-settings" className={styles.setup} aria-label="Website settings">
          <div className={styles.sectionHeading}><h2>Create test set</h2><button className={styles.settingsCommand} type="button" disabled={submitting || Boolean(active)} onClick={randomizeSettings}><Shuffle size={15} />Randomize settings</button></div>
          {listError && <div className={styles.error} role="alert"><CircleAlert size={17} /><span>{listError}</span><button type="button" onClick={() => { setLoading(true); setListAttempt(value => value + 1); }}>Retry test sets</button></div>}
          <form onSubmit={event => void generate(event)}>
            <fieldset disabled={submitting || Boolean(active)}>
              <div className={styles.formSection}><h3>Basics</h3><div className={styles.formGrid}>
              <label className={styles.field}>Name<input aria-label="Name" aria-invalid={!validName} aria-describedby={!validName ? 'fixture-name-error' : undefined} required maxLength={80} value={config.name} onChange={event => set('name', event.target.value)} />{!validName && <small id="fixture-name-error" className={styles.fieldError} role="alert">Enter a name.</small>}</label>
              <div className={styles.twoColumns}>
                <label className={styles.field}>Websites<NumberField aria-label="Websites" aria-invalid={!validSiteCount} aria-describedby={!validSiteCount ? 'fixture-count-error' : undefined} required value={config.siteCount} onValue={value => set('siteCount', value)} />{!validSiteCount && <small id="fixture-count-error" className={styles.fieldError} role="alert">Enter 1 to 500 websites.</small>}</label>
                <label className={styles.field}>{randomPages ? 'Max pages per site' : 'Pages per site'}<NumberField aria-label={randomPages ? 'Max pages per site' : 'Pages per site'} aria-invalid={!validPages} aria-describedby={validPages ? 'fixture-pages-hint' : 'fixture-pages-error'} required value={config.pagesPerSite} onValue={value => set('pagesPerSite', value)} />{validPages ? <small id="fixture-pages-hint">{randomPages ? `Each site gets a random 5 to ${format(config.pagesPerSite)} pages (lower the max to keep sites smaller); all sites share 100,000 pages` : zeroPages ? `0 = random: each site gets 5 to ${format(totalPages / config.siteCount)} pages` : 'Exactly this many pages per site (5 to 100,000), or 0 for a random count'}</small> : <small id="fixture-pages-error" className={styles.fieldError} role="alert">{randomPages ? 'Use 5 to 100,000 pages.' : 'Use 5 to 100,000 pages, or 0 for a random count.'}</small>}</label>
              </div>
              <label className={styles.checkbox}><input type="checkbox" checked={randomPages} onChange={event => { const random = event.target.checked; setConfig(previous => ({ ...previous, randomPageCount: random, pagesPerSite: random ? 100000 : defaults.pagesPerSite })); }} />Random page count per site (5 to 100,000)</label>
              <label className={styles.field}>Site type<select value={config.domain} onChange={event => set('domain', event.target.value)}>{domains.map(domain => <option key={domain} value={domain}>{label(domain)}</option>)}</select><small>The kind of organization the fictional site belongs to</small></label>
              <div className={styles.field}><span id="technology-label">Technology</span><div className={styles.segmented} role="group" aria-labelledby="technology-label">{['html', 'react', 'angular', 'mixed', 'random'].map(value => <button key={value} type="button" aria-pressed={config.framework === value} onClick={() => set('framework', value)}>{label(value)}</button>)}</div><small>HTML pages are complete on load; React and Angular pages are built in the browser</small></div>
              <label className={styles.field}>CMS markup<select value={['none', 'wordpress', 'drupal', 'random'].includes(config.cmsProfile ?? 'none') ? config.cmsProfile ?? 'none' : 'none'} onChange={event => set('cmsProfile', event.target.value)}><option value="none">None (plain HTML)</option><option value="wordpress">WordPress</option><option value="drupal">Drupal</option><option value="random">Random (WordPress or Drupal)</option></select><small>Adds WordPress or Drupal markup, scripts and headers to the page source. To get real WordPress or Drupal output, install the WP or Drupal download of a site.</small></label>
              <div className={styles.field}><span id="noise-label">Markup noise</span><div className={styles.segmented} role="group" aria-labelledby="noise-label">{['clean', 'low', 'medium', 'high', 'mixed', 'random'].map(value => <button key={value} type="button" aria-pressed={config.noise === value} onClick={() => set('noise', value)}>{label(value)}</button>)}</div><small>How much broken or messy HTML is mixed into pages</small></div>
              </div></div>
              <div className={styles.advancedGrid}>
              <details className={styles.advanced}><summary>Look &amp; page source<ChevronDown size={15} /></summary><div className={styles.advancedBody}>
              <label className={styles.field}>Site appearance<select value={config.visualStyle} onChange={event => set('visualStyle', event.target.value)}>{['legacy', 'conventional', 'modern', 'mixed', 'random'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
              <label className={styles.field}>Page-builder markup<select value={config.builderProfile ?? 'none'} disabled={!['wordpress', 'random'].includes(config.cmsProfile ?? 'none')} onChange={event => set('builderProfile', event.target.value)}><option value="none">None</option><option value="gutenberg">Gutenberg style</option><option value="elementor">Elementor style</option><option value="beaver-builder">Beaver Builder style</option><option value="divi">Divi style</option><option value="wpbakery">WPBakery style</option><option value="random">Random</option></select></label>
              <label className={styles.field}>Page source<select value={config.sourceClutter ?? 'realistic'} onChange={event => set('sourceClutter', event.target.value)}><option value="realistic">Realistic (like live sites, 1,500–3,500 lines)</option><option value="none">Clean (short source)</option></select></label>
              <label className={styles.field}>Field layout<select value={config.fieldLayout} onChange={event => set('fieldLayout', event.target.value)}>{['definition-list', 'table', 'paragraphs', 'mixed', 'random'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
              <label className={styles.field}>Optional field variation<select value={config.optionalFields === 'random' ? 'random' : config.optionalFields ? 'include' : 'exclude'} onChange={event => set('optionalFields', event.target.value === 'random' ? 'random' : event.target.value === 'include')}><option value="include">On</option><option value="exclude">Off</option><option value="random">Random</option></select></label>
              </div></details>
              <details className={styles.advanced}><summary>Noise &amp; scenarios<ChevronDown size={15} /></summary><div className={styles.advancedBody}>
              <div className={styles.rangeField}><div className={styles.rangeHeading}><label htmlFor="randomness-range">Randomness factor</label><output htmlFor="randomness-range">{config.randomness ?? 50}%</output></div><input id="randomness-range" type="range" min={0} max={100} step={1} value={config.randomness ?? 50} onChange={event => set('randomness', Number(event.target.value))} /><div className={styles.rangeEnds}><span>0</span><span>100</span></div></div>
                <label className={styles.field}>Obstacle scenario<select value={config.scenario} onChange={event => set('scenario', event.target.value)}>{[...Object.entries(SCENARIO_LABELS), ['random', 'Random']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
                <label className={styles.field}>Challenge level<select value={config.challenge ?? 'standard'} onChange={event => set('challenge', event.target.value)}><option value="standard">Standard</option><option value="hard">Hard</option><option value="extreme">Extreme</option><option value="random">Random</option></select></label>
              </div></details>
              <details className={styles.advanced}><summary>Links &amp; responses<ChevronDown size={15} /></summary><div className={styles.advancedBody}>
                <label className={styles.field}>Server responses<select value={config.transport} onChange={event => set('transport', event.target.value)}>{[...Object.entries(TRANSPORT_LABELS), ['random', 'Random']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
                <label className={styles.field}>Link URLs<select value={config.linkMode ?? 'root-relative'} onChange={event => set('linkMode', event.target.value)}><option value="root-relative">Root relative</option><option value="relative">Page relative</option><option value="base-relative">Document base relative</option><option value="absolute">Fully qualified</option><option value="mixed">Mixed</option><option value="random">Random</option></select></label>
              </div></details>
              <details className={styles.advanced}><summary>Repeatability<ChevronDown size={15} /></summary><div className={styles.advancedBody}>
                <label className={styles.checkbox}><input type="checkbox" checked={freshSeed} onChange={event => { if (event.target.checked && !seedInRange) set('seed', defaults.seed); setFreshSeed(event.target.checked); }} />New seed every run</label>
                <label className={styles.field}>Seed<NumberField aria-label="Seed" aria-invalid={!validSeed} aria-describedby={!validSeed ? 'fixture-seed-error' : undefined} required disabled={freshSeed} value={config.seed} onValue={value => set('seed', value)} />{!validSeed && <small id="fixture-seed-error" className={styles.fieldError} role="alert">Enter 0 to 4,294,967,295.</small>}</label>
              </div></details></div>
            </fieldset>
            <div className={styles.createFoot}><div><div className={styles.total}><span>Estimated pages</span><strong>{randomRange ? `${format(config.siteCount * 5)}-${format(Math.min(100000, totalPages))}` : format(totalPages)}</strong></div>
            <div className={styles.diskEstimate}><span>Disk space: about {randomRange ? `${disk(diskBytes(config.siteCount * 5))}–${disk(diskBytes(Math.min(100000, totalPages)))}` : disk(diskBytes(totalPages))}</span>{realisticSource && <span> · Clean page source (under Look &amp; page source) uses about a third.</span>}<span> Up to twice this where the disk cannot share copies (macOS APFS shares them).</span></div></div>
            {overLimit && <p role="alert" className={styles.limit}>Maximum 100,000 pages per test set.</p>}
            <button className={styles.generate} disabled={loading || Boolean(listError) || submitting || Boolean(active) || !validConfig} type="submit">{submitting || active ? <LoaderCircle className={styles.spin} size={17} /> : <Play size={16} fill="currentColor" />}{submitting || active ? 'Generating...' : 'Generate test set'}</button></div>
          </form>
          <div className={styles.setupFoot}><LockKeyhole size={14} /><span>Source sites and answer keys are generated locally.</span></div>
        </section>
        <section id="fixture-results" className={styles.results} aria-label="Generated test sets">
          <div className={styles.resultsBar}><h2>Saved test sets <span>{jobs.length}</span></h2><button className={styles.smallButton} type="button" onClick={() => setWorkspaceView('create')}><SlidersHorizontal size={15} />Create test set</button></div>
          {loading ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={24} /><h3>Loading test sets</h3></div> : listError ? <div className={styles.empty} role="alert"><CircleAlert size={24} /><h3>Test sets unavailable</h3><p>{listError}</p><button className={styles.smallButton} type="button" onClick={() => { setLoading(true); setListAttempt(value => value + 1); }}><RefreshCw size={15} />Retry test sets</button></div> : selectedId && jobError ? <div className={styles.empty} role="alert"><CircleAlert size={24} /><h3>Test set unavailable</h3><p>{jobError}</p><div className={styles.emptyActions}><button className={styles.smallButton} type="button" onClick={showLibrary}><ChevronLeft size={15} />Back to test sets</button><button className={styles.smallButton} type="button" onClick={() => setJobAttempt(value => value + 1)}><RefreshCw size={15} />Retry test set</button></div></div> : !selectedId ? jobs.length ? <>
            <div className={styles.librarySearch}><Search size={17} /><input type="search" aria-label="Search saved test sets" placeholder="Search saved test sets" value={listQuery} onChange={event => setListQuery(event.target.value)} /><span>{matchingJobs.length} found</span></div>
            <div className={styles.libraryLabels}><span>Test set</span><span>Websites</span><span>Created</span><span>Status</span></div>
            <div className={styles.libraryList}>{matchingJobs.map(item => <button className={styles.libraryRow} key={item.id} type="button" onClick={() => selectJob(item.id)}><span className={styles.libraryName}>{item.name}<small>{item.config?.domain ? label(item.config.domain) : 'Source websites'} · Seed {item.config?.seed ?? '—'}{item.diskBytes ? ` · ${formatBytes(item.diskBytes)}` : ''}</small></span><span>{format(item.completedSites)} / {format(item.config?.siteCount ?? 0)}</span><span>{new Date(item.createdAt).toLocaleDateString('en-US')}</span><Status status={item.status} /><ChevronRight className={styles.libraryArrow} size={16} /></button>)}</div>
            {!matchingJobs.length && <div className={styles.pending}>No matching test sets.</div>}
          </> : <div className={styles.empty}><Globe2 size={28} /><h3>No saved test sets</h3><button className={styles.generate} type="button" onClick={() => setWorkspaceView('create')}>Create test set</button></div> : !job ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={24} /><h3>Loading test set</h3><button className={styles.smallButton} type="button" onClick={showLibrary}><ChevronLeft size={15} />Back to test sets</button></div> : <>
            <button className={styles.backButton} type="button" onClick={showLibrary}><ChevronLeft size={17} />Back to test sets</button>
            <div className={styles.jobHeading}><div><h2>{job.name}</h2><span>{new Date(job.createdAt).toLocaleString('en-US')} <span aria-hidden="true">/</span> Seed {job.config.seed}{job.diskBytes ? <> <span aria-hidden="true">/</span> <span className={styles.diskUsed} title={job.handoffBytes ? `Plus up to ${formatBytes(job.handoffBytes)} for the evaluator copies (shared clones on macOS APFS, full copies on other disks)` : undefined}>{formatBytes(job.diskBytes)} on disk{job.handoffBytes ? ` (+ up to ${formatBytes(job.handoffBytes)} evaluator copy)` : ''}</span></> : null}</span></div><Status status={job.status} /></div>
            <div className={styles.jobActions}>{job.status === 'completed' && <><a className={styles.generate} href={`/api/fixtures/${job.id}/download`} download><ArrowDownToLine size={16} />Download full test package</a><span className={styles.privateNotice}><LockKeyhole size={13} />Includes private answer keys</span></>}{job.status !== 'running' && job.sites.some(site => site.pageCount <= 100000) && <><a className={styles.smallButton} href={`/api/fixtures/${job.id}/download?kind=wordpress`} title="One ZIP with every finished website's WordPress theme; upload each inner ZIP to a WordPress install"><Package size={15} />All WordPress themes</a><a className={styles.smallButton} href={`/api/fixtures/${job.id}/download?kind=drupal`} title="One ZIP with every finished website's Drupal module and theme package"><Package size={15} />All Drupal packages</a></>}<button className={styles.smallButton} type="button" disabled={submitting || Boolean(active)} onClick={() => void repeatJob()} title="Generate a new test set with the saved settings and the same seed"><RefreshCw size={15} />Repeat test set</button><button ref={deleteTriggerRef} className={styles.deleteButton} type="button" disabled={deleting} onClick={() => { setDeleteError(''); setConfirmDelete(true); }}><Trash2 size={15} />Delete</button></div>
            <details className={styles.savedSettings}><summary>Saved settings <ChevronDown size={15} /></summary><dl>
              <div><dt>Site type</dt><dd>{label(job.config.domain)}</dd></div><div><dt>Technology</dt><dd>{label(job.config.framework)}</dd></div>
              <div><dt>Appearance</dt><dd>{label(job.config.visualStyle)}</dd></div><div><dt>Markup noise</dt><dd>{label(job.config.noise)}</dd></div>
              <div><dt>Obstacle scenario</dt><dd>{SCENARIO_LABELS[job.config.scenario as keyof typeof SCENARIO_LABELS] || label(job.config.scenario)}</dd></div><div><dt>Server responses</dt><dd>{TRANSPORT_LABELS[job.config.transport as keyof typeof TRANSPORT_LABELS] || label(job.config.transport)}</dd></div>
              <div><dt>CMS markup</dt><dd>{label(job.config.cmsProfile || 'none')}</dd></div><div><dt>Page builder</dt><dd>{label(job.config.builderProfile || 'none')}</dd></div><div><dt>Page source</dt><dd>{label(job.config.sourceClutter || 'none')}</dd></div>
              <div><dt>Randomness</dt><dd>{job.config.randomness ?? 50}%</dd></div><div><dt>Challenge level</dt><dd>{label(job.config.challenge || 'standard')}</dd></div>
              <div><dt>Field layout</dt><dd>{label(job.config.fieldLayout)}</dd></div><div><dt>Link URLs</dt><dd>{label(job.config.linkMode || 'root-relative')}</dd></div>
              <div><dt>Optional field variation</dt><dd>{job.config.optionalFields === 'random' ? 'Random' : job.config.optionalFields ? 'On' : 'Off'}</dd></div>
              <div><dt>Websites</dt><dd>{format(job.config.siteCount)}</dd></div><div><dt>Pages per site</dt><dd>{job.config.randomPageCount ? `Random, 5 to ${format(job.config.pagesPerSite)}` : job.config.pagesPerSite === 0 ? 'Random, 5 to 200' : format(job.config.pagesPerSite)}</dd></div>
              <div><dt>Seed</dt><dd>{job.config.seed}</dd></div><div><dt>Preview</dt><dd>{label(job.config.previewProtocol || 'http')}</dd></div>
            </dl></details>
            {job.error && <p role="alert" className={styles.error}>{job.error}</p>}
            <div className={styles.metrics}>
              <div><span>Websites</span><strong>{format(job.completedSites)}<small> / {format(job.config.siteCount)}</small></strong></div>
              <div><span>Pages generated</span><strong>{format(generatedPages + (job.status === 'running' && job.progress?.siteIndex === job.completedSites ? job.progress.completedPages : 0))}</strong></div>
              <div><span>Answer keys</span><strong>{format(job.sites.length)}</strong></div>
            </div>
            {job.status === 'running' && <div className={styles.progress} role="status"><progress aria-label="Generation progress" max={job.totalPages} value={generatedPages + (job.progress?.siteIndex === job.completedSites ? job.progress.completedPages : 0)} /><span>{job.progress?.phase === 'verifying' ? 'Verifying files' : job.progress?.phase === 'preparing-handoff' ? 'Preparing test package' : job.progress?.phase === 'preparing' ? 'Preparing source records' : 'Generating pages'} / Website {Math.min((job.progress?.siteIndex ?? job.completedSites) + 1, job.config.siteCount)} of {job.config.siteCount}</span></div>}
            <div className={styles.tabs} role="group" aria-label="Test set views"><button type="button" aria-pressed={view === 'sites'} onClick={() => setView('sites')}><Globe2 size={16} />Websites</button><button type="button" aria-pressed={view === 'answers'} disabled={!job.sites.length} onClick={() => { setView('answers'); setAnswerSite(value => value || job.sites[0]?.id || ''); }}><FileCheck2 size={16} />Answer keys</button><button type="button" aria-pressed={view === 'coverage'} disabled={!job.sites.length} onClick={() => { setView('coverage'); setAnswerSite(value => value || job.sites[0]?.id || ''); }}><ListChecks size={16} />Coverage</button></div>
            {view === 'sites' ? <div className={styles.siteList}>
              {visibleSites.some(site => site.handoff?.status === 'ready') && <details className={styles.savedSettings}><summary>Local folders <ChevronDown size={15} /></summary><dl>{visibleSites.filter(site => site.handoff?.status === 'ready').map(site => <div key={site.id}><dt>{site.name}</dt><dd><code>{site.handoff!.directory}</code><button type="button" className={styles.iconButton} aria-label={`Copy folder for ${site.name}`} title="Copy folder path" onClick={() => void copy(site.handoff!.directory)}>{copied === site.handoff!.directory ? <Check size={14} /> : <Copy size={14} />}</button></dd></div>)}</dl></details>}
              {job.sites.length > 25 && <div className={styles.siteSearch}><Search size={16} /><input type="search" aria-label="Search generated websites" placeholder="Search cases, site types or technology" value={siteQuery} onChange={event => { setSiteQuery(event.target.value); setSitePage(0); }} /><span>{format(matchingSites.length)}</span></div>}
              <p className={styles.outputLegend}><strong>Per website:</strong> ZIP = the website files for your crawler · JSON = the private answer key (keep it away from the tool under test) · WP / Drupal = a theme package that makes a real WordPress or Drupal serve the same pages with its own markup · Score = upload your tool's output (JSON) to see how well it matched the answer key</p>
              <details className={styles.savedSettings}><summary>How to install the WordPress or Drupal download <ChevronDown size={15} /></summary><div className={styles.installHelp}>
                <div><strong>WordPress</strong><ol><li>In wp-admin, go to Appearance → Themes → Add New → Upload Theme and choose the WP ZIP.</li><li>Activate it. The pages are imported (big sites finish as you open admin pages).</li><li>Crawl the WordPress site. URLs and fields match the answer key.</li></ol></div>
                <div><strong>Drupal 10 or 11</strong><ol><li>If an earlier SiteForge site is installed, uninstall “SiteForge test content” first. Then unzip the Drupal ZIP into the Drupal web folder (the one with index.php).</li><li>Enable “SiteForge test content” on the Extend page. It imports the pages and switches the theme.</li><li>Crawl the Drupal site. URLs and fields match the answer key.</li></ol></div>
                <p>Use a throwaway install. In WordPress, activating replaces the previous SiteForge test site. The CMS serves every page normally, so server response conditions (errors, redirects, slow pages) only happen on the preview. The README has a no-MySQL local setup.</p>
              </div></details>
              <div className={styles.listLabels}><span>Website</span><span>Pages</span><span>Outputs</span></div>
              {visibleSites.map(site => {
                const url = previews[`${job.id}/${site.id}`];
                return <article className={styles.siteRow} key={site.id} data-testid="generated-site">
                  <div className={styles.siteInfo}><div className={styles.siteIcon}><Globe2 size={20} /></div><div><h3>{site.name}</h3><div className={styles.siteMeta}><span>{label(site.framework)}</span>{site.cmsProfile && site.cmsProfile !== 'none' && <span>{label(site.cmsProfile)} markup</span>}{site.builderProfile && site.builderProfile !== 'none' && <span>{label(site.builderProfile)}</span>}<span>{label(site.visualStyle)}</span>{site.structure && <span>{label(site.structure)} structure</span>}<span>{label(site.noise)} noise</span>{site.previewProtocol === 'https' && <span>HTTPS / self-signed</span>}</div>{url && <a className={styles.previewUrl} href={url} target="_blank" rel="noreferrer">{url}<ArrowUpRight size={12} /></a>}</div></div>
                  <span className={styles.pageCount}>{format(site.pageCount)}</span>
                  <div className={styles.rowActions}>{url && <a className={styles.iconButton} href={url} target="_blank" rel="noreferrer" aria-label={`Open ${site.name}`} title="Open website"><ArrowUpRight size={17} /></a>}
                    <button className={styles.iconButton} type="button" disabled={opening === site.id} onClick={() => void preview(site)} aria-label={`${url ? 'Restart preview for' : 'Preview'} ${site.name}`} title={url ? 'Refresh preview address' : 'Start preview'}>{opening === site.id ? <LoaderCircle className={styles.spin} size={17} /> : url ? <RefreshCw size={17} /> : <Play size={17} />}<span>{url ? 'Restart' : 'Preview'}</span></button>
                    {url && <button className={styles.iconButton} type="button" aria-label={`Copy URL for ${site.name}`} title="Copy website URL" onClick={() => void copy(url)}>{copied === url ? <Check size={17} /> : <Copy size={17} />}</button>}
                    <a className={styles.iconButton} href={`${siteBase(job.id, site.id)}/download?kind=public`} aria-label={`Download website ${site.name}`} title="Download website ZIP"><ArrowDownToLine size={17} /><span>ZIP</span></a>
                    <a className={styles.iconButton} href={`${siteBase(job.id, site.id)}/download?kind=answers`} aria-label={`Download answer key JSON for ${site.name}`} title="Download answer key JSON"><FileJson size={17} /><span>JSON</span></a>
                    {site.pageCount <= 100000 && <><a className={styles.iconButton} href={`${siteBase(job.id, site.id)}/download?kind=wordpress`} aria-label={`Download WordPress theme for ${site.name}`} title="WordPress theme ZIP: upload and activate it in a real WordPress, which then serves this site with its own WordPress markup"><Package size={17} /><span>WP</span></a>
                    <a className={styles.iconButton} href={`${siteBase(job.id, site.id)}/download?kind=drupal`} aria-label={`Download Drupal theme for ${site.name}`} title="Drupal module and theme ZIP: unzip into a real Drupal web root and enable it; Drupal then serves this site with its own markup"><Package size={17} /><span>Drupal</span></a></>}
                    <label className={styles.iconButton} title="Score a tool's output for this website (JSON in the format in examples/smartcite-output.schema.json)"><Gauge size={17} /><span>Score</span><input className={styles.visuallyHidden} type="file" accept="application/json,.json" aria-label={`Score a tool's output for ${site.name}`} onChange={event => { void scoreResult(site, event.target.files?.[0]); event.target.value = ''; }} /></label>
                    <button className={styles.iconButton} type="button" aria-label={`Inspect answers for ${site.name}`} title="Inspect private answer key" onClick={() => { setAnswerSite(site.id); setView('answers'); }}><FileCheck2 size={17} /></button>
                    {url?.startsWith('https:') && <a className={styles.iconButton} href={`${siteBase(job.id, site.id)}/certificate`} aria-label={`Download test certificate for ${site.name}`} title="Download public test certificate"><ShieldCheck size={17} /></a>}
                  </div>
                  {scores[`${job.id}/${site.id}`] && <ScoreSummary state={scores[`${job.id}/${site.id}`]} siteName={site.name} />}
                </article>;
              })}
              {!job.sites.length && <div className={styles.pending}>{job.status === 'running' ? 'Building the first website...' : 'No websites were completed.'}</div>}
              {!!job.sites.length && !matchingSites.length && <div className={styles.pending}>No matching websites.</div>}
              {matchingSites.length > 25 && <div className={styles.pagination}><span>{format(currentSitePage * 25 + 1)}-{format(Math.min((currentSitePage + 1) * 25, matchingSites.length))} of {format(matchingSites.length)}</span><button type="button" className={styles.iconButton} aria-label="Previous websites" title="Previous websites" disabled={currentSitePage === 0} onClick={() => setSitePage(currentSitePage - 1)}><ChevronLeft size={18} /></button><button type="button" className={styles.iconButton} aria-label="Next websites" title="Next websites" disabled={currentSitePage >= lastSitePage} onClick={() => setSitePage(currentSitePage + 1)}><ChevronRight size={18} /></button></div>}
            </div> : <AnswerInspector key={`${job.id}/${answerSite}`} job={job} siteId={answerSite || job.sites[0]?.id} setSiteId={setAnswerSite} coverage={view === 'coverage'} />}
            <div className={styles.outputFoot}><span><LockKeyhole size={13} />Private answers are excluded from website downloads.</span><span>{job.status === 'completed' ? 'Ready to preview' : 'Source generation'}</span></div>
          </>}
        </section>
      </div>
      <dialog ref={deleteDialogRef} className={styles.dialog} aria-labelledby="delete-title" onCancel={event => { if (deleting) event.preventDefault(); else setConfirmDelete(false); }} onClose={() => { setConfirmDelete(false); deleteTriggerRef.current?.focus(); }}><div className={styles.dialogIcon}><Trash2 size={20} /></div><h2 id="delete-title">Delete test set?</h2><p><strong>{job?.name}</strong> contains {format(job?.completedSites ?? 0)} {job?.completedSites === 1 ? 'website' : 'websites'}. Deleting it permanently removes the generated website files and private answer keys.</p>{deleteError && <div className={styles.error} role="alert"><CircleAlert size={16} /><span>{deleteError}</span></div>}<div className={styles.dialogActions}><button id="fixture-delete-cancel" className={styles.smallButton} type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button><button className={styles.confirmDelete} type="button" disabled={deleting} onClick={() => void deleteJob()}>{deleting ? <LoaderCircle className={styles.spin} size={16} /> : <Trash2 size={16} />}{deleting ? 'Deleting...' : 'Delete test set'}</button></div></dialog>
    </main>
    <footer className={styles.footer}><span>SiteForge</span><span>Deterministic fixtures / Smartcite runs separately</span></footer>
  </div>;
}

function Status({ status }: { status: Job['status'] }) {
  return <span className={`${styles.status} ${styles[status]}`}>{status === 'completed' ? <Check size={14} /> : status === 'failed' ? <CircleAlert size={14} /> : <LoaderCircle size={14} className={styles.spin} />}{status === 'completed' ? 'Ready' : status === 'failed' ? 'Failed' : 'Generating'}</span>;
}

function AnswerInspector({ job, siteId, setSiteId, coverage }: { job: Job; siteId: string; setSiteId: (id: string) => void; coverage: boolean }) {
  const [result, setResult] = useState<{ key: string; answers: Answers } | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [pageId, setPageId] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${job.id}/${siteId}/${offset}/${query}/${attempt}`;
  useEffect(() => {
    let disposed = false;
    let timedOut = false;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      if (!siteId) return;
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
      void request<Answers>(`${siteBase(job.id, siteId)}/answers?${new URLSearchParams({ offset: String(offset), limit: '25', q: query })}`, { signal: controller.signal })
        .then(answers => { if (!disposed) { setResult({ key: requestKey, answers }); setPageId(answers.pages[0]?.pageId || ''); setLoading(false); } })
        .catch(failure => { if (!disposed) { setError(timedOut ? 'The answer key request timed out.' : (failure as Error).message); setLoading(false); } })
        .finally(() => clearTimeout(timeout));
    }, query ? 200 : 0);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [job.id, siteId, offset, query, attempt, requestKey]);
  const answers = !loading && !error && result?.key === requestKey ? result.answers : null;
  const visible = answers?.pages || [];
  const page = visible.find(item => item.pageId === pageId) || visible[0];
  const schema = page && answers?.schemaDefinitions?.[page.expectedCluster];
  return <section className={styles.answers} aria-label="Private answer key">
    <div className={styles.answerToolbar}><label><span className={styles.srOnly}>Answer key website</span><select value={siteId} onChange={event => setSiteId(event.target.value)}>{job.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><a className={styles.smallButton} href={`${siteBase(job.id, siteId)}/download?kind=answers`}><ArrowDownToLine size={15} />Answer key JSON</a></div>
    {error && <div className={styles.answerError} role="alert"><CircleAlert size={17} /><span>{error}</span><button className={styles.smallButton} type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} />Retry answer key</button></div>}
    {coverage ? answers ? <Coverage answers={answers} /> : !error && <div className={styles.pending}>Loading coverage...</div> : <>
      <div className={styles.search}><Search size={16} /><input type="search" maxLength={200} aria-label="Search answer pages" placeholder="Find a page or content type" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /><span>{loading ? 'Searching...' : answers ? format(answers.pagination.matched) : ''}</span></div>
      <div className={styles.pagination}><span>{answers ? answers.pagination.matched ? `${format(answers.pagination.offset + 1)}-${format(answers.pagination.offset + visible.length)} of ${format(answers.pagination.matched)}` : 'No matches' : error ? 'Results unavailable' : 'Loading pages'}</span><button type="button" className={styles.iconButton} title="Previous answers" aria-label="Previous answers" disabled={loading || !answers || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}><ChevronLeft size={18} /></button><button type="button" className={styles.iconButton} title="Next answers" aria-label="Next answers" disabled={loading || !answers || offset + 25 >= answers.pagination.matched} onClick={() => setOffset(offset + 25)}><ChevronRight size={18} /></button></div>
      <div className={styles.answerSplit} aria-busy={loading}>
        <div className={styles.pageList} aria-label="Answer pages">{visible.map(item => <button type="button" key={item.pageId} aria-pressed={page?.pageId === item.pageId} onClick={() => setPageId(item.pageId)}><strong>{item.contentType}</strong><span>{item.url}</span></button>)}{!visible.length && <div className={styles.pending}>{error ? 'Pages unavailable.' : loading || !answers ? 'Loading pages...' : 'No matching pages.'}</div>}</div>
        <div className={styles.pageDetail} key={page?.pageId}>{page && <>
          <div className={styles.pageDetailHeading}><span className={styles.eyebrow}>EXPECTED STRUCTURE</span><h3>{page.contentType}</h3><code>{page.url}</code></div>
          <dl className={styles.facts}><div><dt>Cluster</dt><dd>{page.expectedCluster}</dd></div><div><dt>Page kind</dt><dd>{page.kind}</dd></div><div><dt>Layout</dt><dd>{page.fieldLayout ? label(page.fieldLayout) : page.repeatedItems?.length ? 'Repeated records' : 'Navigation'}</dd></div><div><dt>Noise events</dt><dd>{page.noiseEvents.length}</dd></div></dl>
          {answers?.transport?.rules.filter(rule => rule.path === page.url).map(rule => <div className={styles.retrieval} key={rule.path}><CircleAlert size={16} /><div><strong>HTTP {rule.status} / {label(rule.type.replaceAll('-', ' '))}</strong><span>Retrieval: {rule.expected.availability}{rule.expected.finalPath ? ` / Final path: ${rule.expected.finalPath}` : ''}</span></div></div>)}
          <h4>Expected fields</h4><div className={styles.fieldValues}>{Object.entries(page.fieldStates).map(([name]) => {
            const hasObserved = Object.hasOwn(page.fields, name);
            const hasSource = Object.hasOwn(page.canonicalValues, name);
            const location = page.fieldLocations?.[name];
            const selector = location?.selector || (!location && page.fieldSelectors?.[name]);
            return <div key={name}><div><strong>{name}</strong><span>{schema?.optional.includes(name) ? 'Optional' : 'Required'} / {hasObserved ? 'In generated HTML' : hasSource ? 'Removed from page' : 'Absent at source'}</span></div><div className={styles.observedValue}>{hasObserved ? fieldValue(page.fields[name]) : 'Not present'}</div>{(hasSource || selector || location) && <details className={styles.sourceValue}><summary>Source detail</summary><dl>{hasSource && <div><dt>Canonical value</dt><dd>{fieldValue(page.canonicalValues[name])}</dd></div>}{selector && <div><dt>Selector</dt><dd><code>{selector}</code></dd></div>}{location?.read && <div><dt>Read method</dt><dd><code>{location.read}</code>{location.label !== undefined && <> / Label: {location.label}</>}</dd></div>}{location?.precision && <div><dt>Selection</dt><dd>{location.precision === 'container' ? 'Container with label' : 'Field value'}</dd></div>}{location?.reason && <div><dt>Location status</dt><dd>{label(location.reason.replaceAll('-', ' '))}</dd></div>}</dl></details>}</div>;
          })}</div>
          {page.repeatedItems && <details className={styles.repeatedDetails}><summary>Repeated listing records ({format(page.repeatedItems.length)}) <ChevronDown size={14} /></summary><div className={styles.repeatedBody}><h4>Item schema</h4>{schema?.repeatedItemSchema ? <dl>{schema.repeatedItemSchema.map(item => <div key={item.name}><dt>{item.name}</dt><dd>{item.type}{item.optional ? ' / Optional' : ' / Required'}</dd></div>)}</dl> : <div className={styles.repeatedMore}>Item schema not recorded in this saved key.</div>}<h4>Records</h4><ol>{page.repeatedItems.slice(0, 8).map(item => {
            const names = schema?.repeatedItemSchema?.map(field => field.name) ?? Object.keys(item.fields);
            const locations = page.repeatedItemLocations?.find(entry => entry.pageId === item.pageId && entry.url === item.url)?.fieldLocations;
            return <li key={item.pageId}><code>{item.url}</code><dl className={styles.repeatedValues} aria-label={`Fields for ${item.pageId}`}>{names.map(name => <div key={name}><dt>{name}</dt><dd>{Object.hasOwn(item.fields, name) ? fieldValue(item.fields[name]) : 'Absent at source'}</dd></div>)}</dl>
              {locations ? <details className={styles.repeatedLocations}><summary>Extraction locations <ChevronDown size={13} /></summary><dl>{Object.entries(locations).map(([name, location]) => <div key={name}><dt>{name}</dt><dd>{location.selector ? <><code>{location.selector}</code><span>{location.read}{location.label !== undefined && <> / Label: {location.label}</>}</span></> : label((location.reason || location.state).replaceAll('-', ' '))}</dd></div>)}</dl></details> : <span>Locations not recorded in this saved key.</span>}
            </li>;
          })}</ol>{page.repeatedItems.length > 8 && <span className={styles.repeatedMore}>{format(page.repeatedItems.length - 8)} more in answer key JSON</span>}</div></details>}
          {page.noiseEvents.length > 0 && <details className={styles.noiseDetails}><summary>Applied noise</summary><pre>{JSON.stringify(page.noiseEvents, null, 2)}</pre></details>}
        </>}</div>
      </div>
    </>}
  </section>;
}

function Coverage({ answers }: { answers: Answers }) {
  const counts = new Map(Object.entries(answers.coverage.counts));
  const rules = answers.transport?.rules || [];
  const groups = [...new Set(OBSTACLE_CATALOG.map(item => item.group))];
  return <section className={styles.coverage} aria-label="Generated obstacle coverage">
    <div className={styles.coverageHeading}><h3>Applied to this website</h3><span>Smartcite results: not evaluated</span></div>
    <div className={styles.metrics}><div><span>Markup conditions</span><strong>{counts.size}<small> / {OBSTACLE_CATALOG.length}</small></strong></div><div><span>Affected pages</span><strong>{format(answers.coverage.affectedPages)}</strong></div><div><span>Response conditions</span><strong>{rules.length}<small> / {RESPONSE_CATALOG.length}</small></strong></div></div>
    <div className={styles.coverageGroups}>{groups.map(group => <section key={group}><h4>{group}</h4><dl>{OBSTACLE_CATALOG.filter(item => item.group === group).map(item => <div key={item.id}><dt>{item.label}</dt><dd className={counts.has(item.id) ? styles.applied : ''}>{counts.has(item.id) ? `${counts.get(item.id)} pages` : 'Not applied'}</dd></div>)}</dl></section>)}</div>
    <section className={styles.responseCoverage}><div className={styles.coverageHeading}><h4>Server responses</h4><span>{rules.length ? 'Preview server only / Not in static ZIP' : 'Normal responses'}</span></div>
      <dl>{RESPONSE_CATALOG.map(item => { const rule = rules.find(value => value.type === item.id); return <div key={item.id}><dt>{item.label}{rule && <code>{rule.path}</code>}</dt><dd className={rule ? styles.applied : ''}>{rule ? `HTTP ${rule.status}` : 'Not applied'}</dd></div>; })}</dl>
    </section>
    <div className={styles.coverageLimit}><h4>Not simulated</h4><p>Login flows, CAPTCHA, TLS failures beyond self-signed trust, PDF/OCR, invalid byte encodings, third-party APIs.</p></div>
  </section>;
}

type ScoreMetric = { f1: number | null } | null;
type ScoreReport = { coverage: { recall: number | null; observed: number; expected: number; unexpected: number }; clustering: { allExpected: { pairs: { f1: number | null } } };
  contentType: { accuracy?: number | null } | null; fields: { values: ScoreMetric }; relationships: { score?: ScoreMetric }; repeatedItems?: { items: ScoreMetric; values: ScoreMetric } };
const percent = (value: number | null | undefined) => value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;

function ScoreSummary({ state, siteName }: { state: { busy?: boolean; error?: string; report?: ScoreReport; file?: string }; siteName: string }) {
  if (state.busy) return <div className={styles.scoreBox} role="status"><LoaderCircle className={styles.spin} size={15} />Scoring {state.file}...</div>;
  if (state.error) return <div className={`${styles.scoreBox} ${styles.scoreError}`} role="alert"><CircleAlert size={15} />{state.error}</div>;
  const report = state.report!;
  const download = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
  const items: [string, string][] = [
    ['Pages found', `${report.coverage.observed} of ${report.coverage.expected} (${percent(report.coverage.recall)})`],
    ['Extra URLs', String(report.coverage.unexpected)],
    ['Cluster F1', percent(report.clustering.allExpected.pairs.f1)],
    ['Content type', percent(report.contentType?.accuracy)],
    ['Field F1', percent(report.fields.values?.f1)],
    ['Relationship F1', percent(report.relationships.score?.f1)],
    ['Listing records F1', percent(report.repeatedItems?.items?.f1)],
  ];
  return <div className={styles.scoreBox} aria-label={`Score for ${siteName}`}><strong>Score for {state.file}</strong><dl>{items.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><a href={download} download={`${siteName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-score.json`}>Download the full report</a></div>;
}
