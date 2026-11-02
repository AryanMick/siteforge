'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, FlaskConical, Layers3, ListChecks, LoaderCircle, Play, Search } from 'lucide-react';
import styles from './cases.module.css';

type CatalogCase = {
  id: string;
  label: string;
  domain: string;
  framework: string;
  fieldLayout: string;
  protocol: string;
  profile: string;
  visualStyle: string;
};

type Profile = { id: string; label: string };

type CatalogResponse = {
  version: 1;
  total: number;
  core?: number;
  matched: number;
  page: number;
  pageSize: number;
  cases: CatalogCase[];
  profiles: Profile[];
  domains: string[];
  frameworks: string[];
  layouts: string[];
};

type Filters = {
  search: string;
  domain: string;
  framework: string;
  fieldLayout: string;
  protocol: string;
  profile: string;
};

const emptyFilters: Filters = { search: '', domain: '', framework: '', fieldLayout: '', protocol: '', profile: '' };

const format = (value: number) => value.toLocaleString('en-US');
const display = (value: string) => {
  const labels: Record<string, string> = {
    html: 'HTML', react: 'React', angular: 'Angular', 'definition-list': 'Definition list', paragraphs: 'Paragraphs', table: 'Table',
    nonprofit: 'Nonprofit', municipality: 'Local government', government: 'Government', records: 'Public records', http: 'HTTP', https: 'HTTPS',
  };
  return labels[value] || value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The catalog could not be loaded. Please try again.');
  return body as T;
}

export default function CaseCatalogPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<'all' | string>('');
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
    return params.toString();
  }, [filters, page]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void request<CatalogResponse>(`/api/fixtures/catalog?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCatalog(result); })
      .catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);

  const lastPage = Math.max(1, Math.ceil((catalog?.matched || 0) / (catalog?.pageSize || 25)));
  const selectedFilterCount = Object.values(filters).filter(Boolean).length;

  function updateFilter(key: keyof Filters, value: string) {
    setFilters(previous => ({ ...previous, [key]: value }));
    setPage(1);
  }

  async function generate(mode: 'all' | 'single', caseId?: string) {
    if (posting) return;
    setPosting(mode === 'all' ? 'all' : caseId || 'single');
    setError('');
    try {
      const body = mode === 'all'
        ? { mode: 'all', name: 'Full regression catalog', seed: 48291 }
        : { mode: 'single', caseId, name: 'Catalog case', seed: 48291 };
      const { job } = await request<{ job: { id: string } }>('/api/fixtures/catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      window.location.assign(`/?job=${encodeURIComponent(job.id)}`);
    } catch (failure) {
      setError((failure as Error).message);
      setPosting('');
    }
  }

  return <div className={styles.app}>
    <header className={styles.topbar}>
      <a href="/" className={styles.brand}><Layers3 size={22} strokeWidth={1.7} /><span>SiteForge</span></a>
      <nav aria-label="Workspace">
        <a href="/">Test websites</a>
        <span aria-current="page"><ListChecks size={16} />Case catalog</span>
        <a href="/test-lab"><FlaskConical size={16} />Test lab</a>
      </nav>
      <span className={styles.local}><i />Local workspace</span>
    </header>

    <main className={styles.main}>
      <div className={styles.heading}>
        <div><span className={styles.eyebrow}>FIXTURE REGISTRY</span><h1>Case catalog</h1></div>
        <button className={styles.generateAll} type="button" onClick={() => void generate('all')} disabled={Boolean(posting)}>
          {posting === 'all' ? <LoaderCircle className={styles.spin} size={16} /> : <Play size={16} fill="currentColor" />} {posting === 'all' ? 'Generating...' : `Generate ${format(catalog?.core || 1440)} core websites`}
        </button>
      </div>

      <section className={styles.summary} aria-label="Catalog summary">
        <div><strong>{format(catalog?.total || 0)}</strong><span>scenario combinations</span></div>
        <div><strong>{format((catalog?.total || 0) * 16)}</strong><span>pages</span></div>
        <div><strong>16</strong><span>per website</span></div>
      </section>

      {error && <div className={styles.error} role="alert"><CircleAlert size={17} /><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div>}

      <section className={styles.catalog} aria-label="Catalog cases">
        <div className={styles.catalogHeader}>
          <div><h2>Available cases</h2><span>{format(catalog?.matched || 0)} matching</span></div>
          <button className={styles.clear} type="button" disabled={!selectedFilterCount || Boolean(posting)} onClick={() => { setFilters(emptyFilters); setPage(1); }}>Clear filters</button>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}><Search size={17} /><span className={styles.srOnly}>Search cases</span><input type="search" value={filters.search} onChange={event => updateFilter('search', event.target.value)} placeholder="Search cases" /></label>
          <label>Domain<select value={filters.domain} onChange={event => updateFilter('domain', event.target.value)}><option value="">All domains</option>{(catalog?.domains || []).map(value => <option key={value} value={value}>{display(value)}</option>)}</select></label>
          <label>Framework<select value={filters.framework} onChange={event => updateFilter('framework', event.target.value)}><option value="">All frameworks</option>{(catalog?.frameworks || []).map(value => <option key={value} value={value}>{display(value)}</option>)}</select></label>
          <label>Field layout<select value={filters.fieldLayout} onChange={event => updateFilter('fieldLayout', event.target.value)}><option value="">All layouts</option>{(catalog?.layouts || []).map(value => <option key={value} value={value}>{display(value)}</option>)}</select></label>
          <label>Protocol<select value={filters.protocol} onChange={event => updateFilter('protocol', event.target.value)}><option value="">All protocols</option><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          <label>Profile<select value={filters.profile} onChange={event => updateFilter('profile', event.target.value)}><option value="">All profiles</option>{(catalog?.profiles || []).map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        </div>

        <div className={styles.tableWrap} aria-busy={loading}>
          <table>
            <thead><tr><th>Case</th><th>Domain</th><th>Framework</th><th>Layout</th><th>Protocol</th><th>Profile</th><th><span className={styles.srOnly}>Generate</span></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className={styles.loading}><LoaderCircle className={styles.spin} size={21} /> Loading catalog</td></tr>}
              {!loading && !catalog?.cases.length && <tr><td colSpan={7} className={styles.empty}>No cases match the current filters.</td></tr>}
              {!loading && catalog?.cases.map(item => <tr key={item.id}>
                <td><strong>{item.label || display(item.id)}</strong><code>{item.id}</code></td>
                <td>{display(item.domain)}</td><td>{display(item.framework)}</td><td>{display(item.fieldLayout)}</td><td>{display(item.protocol)}</td><td>{display(item.profile)}</td>
                <td><button className={styles.iconButton} type="button" onClick={() => void generate('single', item.id)} disabled={Boolean(posting)} aria-label={`Generate ${item.label || item.id}`} title="Generate website"><Play size={16} fill="currentColor" /></button></td>
              </tr>)}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>Page {catalog?.page || page} of {lastPage}</span>
          <div><button className={styles.iconButton} type="button" title="Previous page" aria-label="Previous page" disabled={loading || page <= 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}><ChevronLeft size={18} /></button><button className={styles.iconButton} type="button" title="Next page" aria-label="Next page" disabled={loading || page >= lastPage} onClick={() => setPage(previous => Math.min(lastPage, previous + 1))}><ChevronRight size={18} /></button></div>
        </div>
      </section>
    </main>
  </div>;
}
