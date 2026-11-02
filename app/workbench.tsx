'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, BookOpen, Check, ChevronRight, Circle, CircleCheck, CircleX, Code2, FileCode2, FlaskConical, Layers3, LoaderCircle, Play, RefreshCw, Search, Terminal, TestTube2 } from 'lucide-react';
import { BOOK_SCHEMA, conformsToSchema } from '@/engine/structure';
import { extractBook, renderBookFixture } from '@/engine/book-html';
import type { DashboardData, FeatureSpec, RunKind, TestRun } from '@/workbench/types';

type View = 'specifications' | 'runs' | 'structure';
const empty: DashboardData = { features: [], runs: [] };
const icons = { specifications: FileCode2, runs: Activity, structure: Layers3 };
const titles = { specifications: 'Specifications', runs: 'Test runs', structure: 'Book structure' };
const formatTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Status({ status }: { status: string }) {
  const Icon = status === 'passed' ? CircleCheck : status === 'failed' || status === 'interrupted' ? CircleX : status === 'running' ? LoaderCircle : Circle;
  return <span className={`status ${status}`}><Icon size={13} className={status === 'running' ? 'spin' : ''} />{status}</span>;
}

export function Workbench() {
  const [data, setData] = useState<DashboardData>(empty);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('specifications');
  const [busy, setBusy] = useState<RunKind | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [selectedRun, setSelectedRun] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/workbench', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load results.');
      setData(payload);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const active = busy !== null || data.runs.some(run => run.status === 'running');
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  async function run(kind: RunKind) {
    setBusy(kind); setError(''); setView('runs');
    try {
      const response = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Run could not start.');
      setSelectedRun(payload.id);
    } catch (failure) { setError((failure as Error).message); }
    finally { await refresh(); setBusy(null); }
  }

  const automated = data.features.filter(feature => !feature.planned);
  const executableCases = automated.flatMap(feature => feature.scenarios).reduce((n, scenario) => n + (scenario.examples || 1), 0);
  const plannedCases = data.features.filter(feature => feature.planned).flatMap(feature => feature.scenarios).length;
  const latestBdd = data.runs.find(run => run.kind === 'bdd' && run.status !== 'running');
  const latestMutation = data.runs.find(run => run.kind === 'mutation' && run.status !== 'running');
  const features = data.features.filter(feature => (filter === 'all' || (filter === 'planned') === feature.planned) && `${feature.name} ${feature.source}`.toLowerCase().includes(search.toLowerCase()));
  const feature = features.find(item => item.id === selectedFeature) ?? features.find(item => item.file === 'features/structure.feature') ?? features[0];
  const currentRun = data.runs.find(item => item.id === selectedRun) ?? data.runs[0];

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Siteforge test engine"><span className="brand-mark"><Layers3 size={23} /></span><span>Siteforge<small>TEST ENGINE</small></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Workbench views">{(Object.keys(titles) as View[]).map(key => {
        const Icon = icons[key];
        return <button key={key} className={view === key ? 'nav-item selected' : 'nav-item'} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}><Icon size={17} /><span>{titles[key]}</span>{key === 'specifications' && <span className="nav-count">{data.features.length}</span>}</button>;
      })}</nav>
      <div className="sidebar-bottom"><span className="local-dot" />Local workspace<small>Next.js / TypeScript</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Benchmark <ChevronRight size={14} /><strong>Test engine</strong></div><span className="runtime-label"><Code2 size={14} />BDD workbench</span></header>
      <div className="page-heading"><div><div className="eyebrow">SITEFORGE / LIBRARY BENCHMARK</div><h1>{titles[view]}</h1></div><div className="actions">
        <button className="icon-button" title="Refresh results" aria-label="Refresh results" onClick={() => { setError(''); void refresh(); }}><RefreshCw size={17} /></button>
        <button className="button secondary" disabled={active || loading} onClick={() => void run('mutation')}><FlaskConical size={16} />Run mutations</button>
        <button className="button primary" disabled={active || loading} onClick={() => void run('bdd')}>{busy === 'bdd' ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}Run behaviors</button>
      </div></div>
      <section className="metrics" aria-label="Test summary">
        <div><span>Executable scenarios</span><strong>{loading ? '\u2014' : executableCases}</strong><small>{automated.length} automated features</small></div>
        <div><span>Latest behavior run</span><strong className={latestBdd?.status === 'passed' ? 'positive' : ''}>{latestBdd?.behavior ? `${latestBdd.behavior.passed}/${latestBdd.behavior.scenarios}` : latestBdd ? 'Failed' : 'Not run'}</strong><small>{latestBdd ? latestBdd.status : 'No execution recorded'}</small></div>
        <div><span>Mutation score</span><strong>{latestMutation?.mutation?.score != null ? `${latestMutation.mutation.score.toFixed(1)}%` : latestMutation ? 'Failed' : 'Not run'}</strong><small>Reference structure module</small></div>
        <div><span>Planned scenarios</span><strong>{loading ? '\u2014' : plannedCases}</strong><small>Not counted as passing</small></div>
      </section>
      {error && <div role="alert" className="error-banner"><CircleX size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><CircleX size={16} /></button></div>}
      {active && <div role="status" className="running-banner"><LoaderCircle className="spin" size={16} />{busy === 'mutation' || data.runs[0]?.kind === 'mutation' ? 'Stryker mutation run in progress' : 'Cucumber behavior run in progress'}</div>}
      {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /><h2>Loading specifications</h2></div> : view === 'specifications' ? <>
        <div className="section-toolbar"><div className="section-title"><FileCode2 size={18} /><h2>Behavior specifications</h2><span className="subtle-count">{features.length}</span></div><div className="filters"><label className="search"><Search size={16} /><input aria-label="Search specifications" placeholder="Search specifications" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Specification status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="automated">Automated</option><option value="planned">Planned</option></select></div></div>
        <div className="spec-layout"><div className="feature-list" aria-label="Feature files">{features.map(item => <button className={`feature-row ${item.id === feature?.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedFeature(item.id)}><FileCode2 size={18} /><div><strong>{item.name}</strong><span>{item.scenarios.length} specifications <span className="dot-separator">/</span> {item.file.replace('features/', '')}</span></div><Status status={item.planned ? 'planned' : 'automated'} /></button>)}{!features.length && <div className="empty-inline">No matching specifications.</div>}</div>{feature && <FeatureDetail feature={feature} />}</div>
      </> : view === 'runs' ? <div className="run-layout"><section><div className="section-toolbar"><div className="section-title"><Activity size={18} /><h2>Run history</h2><span className="subtle-count">{data.runs.length}</span></div></div>{data.runs.length ? <div className="run-list">{data.runs.map(item => <button key={item.id} className={`run-row ${item.id === currentRun?.id ? 'active' : ''}`} onClick={() => setSelectedRun(item.id)}><div><strong>{item.kind === 'bdd' ? 'Cucumber behaviors' : 'Stryker mutations'}</strong><small>{formatTime(item.startedAt)} <span className="dot-separator">/</span> {item.durationMs == null ? 'In progress' : `${(item.durationMs / 1000).toFixed(1)}s`}</small></div><Status status={item.status} /></button>)}</div> : <div className="empty-state"><TestTube2 size={30} /><h2>No test runs yet</h2></div>}</section>{currentRun && <RunDetail run={currentRun} />}</div> : <StructureLab />}
      <footer><span><Terminal size={13} />Cucumber JS + Stryker</span><span>Local execution <span className="dot-separator">/</span> No public crawls</span></footer>
    </main>
  </div>;
}

function FeatureDetail({ feature }: { feature: FeatureSpec }) {
  return <section className="feature-detail"><div className="detail-heading"><div><span className="eyebrow">GHERKIN</span><h2>{feature.name}</h2></div><Status status={feature.planned ? 'planned' : 'automated'} /></div><div className="file-path"><FileCode2 size={14} /><code>{feature.file}</code></div><div className="code-scroll"><pre><code>{feature.source.split('\n').map((line, index) => <span className="code-line" key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><span className={/^\s*@/.test(line) ? 'code-tag' : /^\s*(Feature:|Scenario|Given |When |Then |And |But |Examples:)/.test(line) ? 'code-keyword' : ''}>{line || ' '}</span></span>)}</code></pre></div></section>;
}

function RunDetail({ run }: { run: TestRun }) {
  return <section className="run-detail"><div className="detail-heading"><div><span className="eyebrow">{run.kind === 'bdd' ? 'CUCUMBER JS' : 'STRYKER'}</span><h2>{run.kind === 'bdd' ? 'Behavior results' : 'Mutation results'}</h2></div><a className="icon-button" href={`/api/runs/${run.id}?download=1`} title="Download run JSON" aria-label="Download run JSON"><ArrowDownToLine size={17} /></a></div><div className="run-metadata"><Status status={run.status} /><code>{run.id.slice(0, 8)}</code><span>{run.durationMs == null ? 'Running' : `${(run.durationMs / 1000).toFixed(1)} seconds`}</span></div>{run.error && <p className="error-text">{run.error}</p>}
    {run.behavior && <div className="results-table"><table><thead><tr><th>Scenario</th><th>Result</th></tr></thead><tbody>{run.behavior.cases.map((result, index) => <tr key={index}><td>{result.name}{result.error && <details><summary>Failure</summary><pre>{result.error}</pre></details>}</td><td><Status status={result.status} /></td></tr>)}</tbody></table></div>}
    {run.mutation && <><div className="mutation-grid"><div><span>Killed</span><strong>{run.mutation.killed}</strong></div><div><span>Survived</span><strong>{run.mutation.survived}</strong></div><div><span>No coverage</span><strong>{run.mutation.noCoverage}</strong></div><div><span>Timeouts</span><strong>{run.mutation.timeout}</strong></div></div><div className="scope"><span>Mutation scope</span>{run.mutation.scope.map(path => <code key={path}>{path}</code>)}<span>{run.mutation.ignored} ignored / {run.mutation.compileErrors} compile errors / {run.mutation.runtimeErrors} runtime errors / {run.mutation.pending} pending</span></div></>}
    <details className="execution-log" open={run.status === 'failed'}><summary><Terminal size={15} />Execution log</summary><pre>{run.log || 'Execution has not produced a completed log.'}</pre></details>
  </section>;
}

function StructureLab() {
  const [layout, setLayout] = useState<'clean' | 'wrapped' | 'table'>('clean');
  const [cover, setCover] = useState(true);
  const html = useMemo(() => renderBookFixture({ layout, cover }), [layout, cover]);
  const fields = useMemo(() => extractBook(html), [html]);
  const matches = conformsToSchema(fields, BOOK_SCHEMA);
  return <section className="structure-lab"><div className="section-toolbar"><div className="section-title"><BookOpen size={18} /><h2>Book detail fixture</h2></div><div className="filters"><select aria-label="HTML layout" value={layout} onChange={event => setLayout(event.target.value as typeof layout)}><option value="clean">Clean HTML</option><option value="wrapped">Extra wrappers</option><option value="table">Table layout</option></select><label className="checkbox-label"><input type="checkbox" checked={cover} onChange={event => setCover(event.target.checked)} />Cover image</label></div></div><div className="structure-layout"><div className="book-record">{cover && <img className="book-cover" src="/book-cover.png" width={108} height={144} alt="Geometric cover of the fictional book" />}<div><span className="eyebrow">FICTIONAL BOOK RECORD</span><h2>{String(fields.title ?? 'No title')}</h2><p className="book-date">{String(fields.publicationDate ?? '')}</p><p>{String(fields.description ?? '')}</p><div className={matches ? 'structure-result valid' : 'structure-result invalid'}>{matches ? <Check size={17} /> : <CircleX size={17} />}{matches ? 'Matches book reference structure' : 'Does not match book reference structure'}</div></div></div><div className="field-record"><h3>Observed fields</h3><table><thead><tr><th>Field</th><th>Presence</th><th>Schema</th></tr></thead><tbody>{['title', 'publicationDate', 'description', 'coverImage'].map(field => <tr key={field}><td><code>{field}</code></td><td><Status status={Object.hasOwn(fields, field) ? 'present' : 'absent'} /></td><td>{field === 'coverImage' ? 'Optional' : 'Required'}</td></tr>)}</tbody></table></div></div><div className="html-inspector"><div className="section-toolbar"><div className="section-title"><Code2 size={18} /><h2>Source HTML</h2></div><span className="file-path">{layout} / cover {cover ? 'present' : 'absent'}</span></div><pre>{html}</pre></div></section>;
}
