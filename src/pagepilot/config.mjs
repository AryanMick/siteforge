import { z } from 'zod';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  mode: z.enum(['synthetic', 'public']).default('synthetic'),
  profile: z.enum(['library', 'archive', 'government']).default('library'),
  noise: z.enum(['clean', 'low', 'medium', 'high']).default('clean'),
  pageCount: z.number().int().min(12).max(100).default(24),
  seed: z.number().int().min(0).max(2147483647).default(48291),
  url: z.string().max(2048).default(''),
  pathPrefix: z.string().min(1).max(512).default('/'),
  maxPages: z.number().int().min(1).max(500).default(100),
  maxDepth: z.number().int().min(0).max(10).default(6),
  maxDurationMinutes: z.number().int().min(1).max(30).default(15),
  threshold: z.number().min(0).max(1).default(0.32),
}).strict();

export class ProjectInputError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ProjectInputError';
    this.field = field;
  }
}

export function validateProject(input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? 'input');
    const messages = {
      maxPages: 'Page limit must be a whole number from 1 to 500.',
      maxDepth: 'Crawl depth must be a whole number from 0 to 10.',
      maxDurationMinutes: 'Crawl duration must be a whole number from 1 to 30 minutes.',
      pathPrefix: 'Path scope must contain 1 to 512 characters and begin with /.',
      url: 'Website address must contain at most 2048 characters.',
    };
    throw new ProjectInputError(field, messages[field] ?? `${field}: ${issue.message}`);
  }
  const value = parsed.data;
  let prefix;
  try { prefix = decodeURIComponent(value.pathPrefix); } catch { throw new ProjectInputError('pathPrefix', 'Path scope has invalid URL encoding.'); }
  if (!prefix.startsWith('/') || /[?#\\\u0000-\u001f\u007f]/.test(prefix) || prefix.split('/').some(part => part.startsWith('.'))) {
    throw new ProjectInputError('pathPrefix', 'Path scope must be an absolute URL path without queries, hidden segments or control characters.');
  }
  if (value.mode === 'public') {
    if (!/^https?:\/\//i.test(value.url) || /[\s\\\u0000-\u001f\u007f]/.test(value.url)) {
      throw new ProjectInputError('url', 'Enter a full HTTP or HTTPS URL without spaces or backslashes.');
    }
    let url;
    try { url = new URL(value.url); } catch { throw new ProjectInputError('url', 'Enter a valid public HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ProjectInputError('url', 'Only public HTTP(S) URLs without credentials are supported.');
    // The crawler additionally vets and pins all DNS answers before connecting.
    const hostname = url.hostname.replace(/\.$/, '');
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost')) throw new ProjectInputError('url', 'Local URLs are not allowed in public mode.');
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { throw new ProjectInputError('url', 'Website address has invalid URL encoding.'); }
    if (/[\\\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part.startsWith('.'))) {
      throw new ProjectInputError('url', 'Website address cannot contain hidden segments, backslashes or control characters.');
    }
    const scope = prefix.replace(/\/$/, '');
    if (scope && path !== scope && !path.startsWith(`${scope}/`)) throw new ProjectInputError('pathPrefix', 'The website address must be inside the path scope.');
    url.hash = '';
    value.url = url.href;
  } else value.url = '';
  return value;
}

export function projectInput(project) {
  return validateProject(Object.fromEntries(Object.keys(schema.shape).map(key => [key, project[key]])));
}

/** Browser-safe shortcut; network address checks still run in the crawler. */
export function publicProjectInput(rawUrl, { maxPages = 100, maxDepth = 6, maxDurationMinutes = 15, pathPrefix = '/' } = {}) {
  const address = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!address || /[\s\\\u0000-\u001f\u007f]/.test(address)) throw new ProjectInputError('url', 'Enter a public website address without spaces or backslashes.');
  let url;
  try {
    if (/^https?:\/\//i.test(address)) url = new URL(address);
    else if (/^[^/:?#]+\.[^/:?#]+(?::\d+)?(?:[/?#]|$)/.test(address)) url = new URL(`https://${address}`);
    else throw new Error('Invalid address');
  } catch { throw new ProjectInputError('url', 'Enter a website such as example.com or https://example.com.'); }
  if (!url.hostname.includes('.') && !url.hostname.startsWith('[') && url.hostname !== 'localhost') throw new ProjectInputError('url', 'Enter a public website hostname.');
  return validateProject({ name: url.hostname.slice(0, 80), mode: 'public', url: url.href, maxPages, maxDepth, maxDurationMinutes, pathPrefix });
}

export const initialStages = () => [
  ['prepare', 'Prepare site'], ['crawl', 'Crawl & extract'], ['cluster', 'Group pages'],
  ['evaluate', 'Check answers'], ['export', 'Save report'],
].map(([id, label]) => ({ id, label, status: 'pending', message: '' }));

export function evaluationGate(metrics, synthetic) {
  if (!synthetic) return { status: 'not_available', reason: 'Public-site groups are predictions. No private answer key exists, so accuracy is not measured.', thresholds: null };
  const thresholds = { coverage: 1, pairwiseF1: 0.95, fieldValueF1: 0.95 };
  const passed = Object.entries(thresholds).every(([key, minimum]) => Number.isFinite(metrics?.[key]) && metrics[key] >= minimum && metrics[key] <= 1);
  return { status: passed ? 'passed' : 'failed', thresholds,
    reason: passed ? 'All benchmark gates passed: full coverage, cluster F1 >= 0.95 and field-value F1 >= 0.95.' : 'One or more benchmark gates were missed. Inspect the groups and extracted fields; a completed run is not necessarily an accurate result.' };
}
