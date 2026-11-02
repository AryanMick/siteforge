import { seedFor } from './util.mjs';

export const TRANSPORT_PROFILES = Object.freeze(['none', 'errors', 'redirects', 'mixed', 'legacy-server']);

const VIRTUAL_PREFIX = '/__siteforge_transport__/v1/';
const HTTP_ERRORS = Object.freeze([
  { type: 'http-403', status: 403 },
  { type: 'http-404', status: 404 },
  { type: 'http-410', status: 410 },
  { type: 'http-429', status: 429, retryAfterSeconds: 1 },
  { type: 'http-503', status: 503 },
]);
const ERROR_TYPES = new Set([...HTTP_ERRORS.map(rule => rule.type), 'soft-404']);
const REDIRECT_TYPES = new Set(['redirect-chain', 'redirect-loop']);
const MIXED_TYPES = new Set([...ERROR_TYPES, 'wrong-content-type', 'slow-response', ...REDIRECT_TYPES]);
// Legacy-server conditions: separate from the fixed ten-rule mixed profile.
// expected: [availability, finalPath] where 'self' means the rule path.
const LEGACY_RULES = Object.freeze({
  'redirect-status-chain': { status: 301, expected: ['available', '/'], hopStatuses: [302, 303, 307, 308] },
  'redirect-case-variant': { status: 301, expected: ['unavailable', null] },
  'redirect-external': { status: 302, expected: ['unavailable', null] },
  'intermittent-503': { status: 503, expected: ['available', 'self'], failCount: 2, retryAfterSeconds: 1 },
  'http-503-retry-after': { status: 503, expected: ['unavailable', null], retryAfterSeconds: 120 },
  'http-500': { status: 500, expected: ['unavailable', null] },
  'slow-drip': { status: 200, expected: ['available', 'self'], chunkCount: 6, chunkDelayMs: 80 },
  'truncated-body': { status: 200, expected: ['unavailable', null] },
  'missing-content-type': { status: 200, expected: ['available', 'self'] },
  'gzip-mismatch': { status: 200, expected: ['unavailable', null] },
  'x-robots-tag': { status: 200, expected: ['available', 'self'], header: 'noindex, nofollow' },
  'link-header-canonical': { status: 200, expected: ['available', 'self'], canonicalPath: '/' },
  'cookie-required': { status: 302, expected: ['available', 'self'], cookieName: 'ASPSESSIONIDSF' },
  'soft-404-navigation': { status: 200, expected: ['unavailable', null] },
  // Dynamic rendering: bot user agents receive server-rendered HTML; browsers receive the normal page.
  'bot-prerender': { status: 200, expected: ['available', 'self'], agentPattern: 'bot|crawl|spider|slurp|smartcite' },
  // Web application firewall: generic HTTP clients are refused; browsers and named crawlers are served.
  'user-agent-block': { status: 403, expected: ['available', 'self'], agentPattern: '^$|curl|wget|python|java/|go-http|libwww|scrapy|httpclient|okhttp' },
});
export const LEGACY_SERVER_TYPES = Object.freeze(Object.keys(LEGACY_RULES));
const LEGACY_EXTRAS = ['hopStatuses', 'failCount', 'retryAfterSeconds', 'chunkCount', 'chunkDelayMs', 'header', 'canonicalPath', 'cookieName', 'agentPattern'];
export const EXTERNAL_REDIRECT_ORIGIN = 'http://moved.siteforge.invalid';
const ALL_TYPES = new Set([...MIXED_TYPES, ...LEGACY_SERVER_TYPES]);
const PROFILE_TYPES = {
  none: new Set(),
  errors: ERROR_TYPES,
  redirects: REDIRECT_TYPES,
  mixed: MIXED_TYPES,
  'legacy-server': new Set(LEGACY_SERVER_TYPES),
};
const PROFILE_LIMITS = { none: 0, errors: 6, redirects: 2, mixed: 10, 'legacy-server': LEGACY_SERVER_TYPES.length };
const MAX_PATH_LENGTH = 2048;

function fail(message) {
  throw new TypeError(`Invalid transport plan: ${message}`);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} must contain exactly: ${wanted.join(', ')}`);
}

function safePath(value, { virtual = false, root = false } = {}) {
  if (typeof value !== 'string'
    || value.length > MAX_PATH_LENGTH
    || !value.startsWith('/')
    || value.startsWith('//')
    || /[\u0000-\u0020\u007f]/.test(value)
    || value.includes('?')
    || value.includes('#')
    || value.includes('\\')) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (decoded !== value || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#')) return false;
  const pathBody = value === '/' ? '' : value.slice(1, value.endsWith('/') ? -1 : undefined);
  if (value !== '/' && (!pathBody || pathBody.split('/').some(segment => segment.length === 0))) return false;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) return false;
  if (!root && value === '/') return false;
  if (virtual) return value.startsWith(VIRTUAL_PREFIX) && segments.length >= 3;
  if (root) return !value.startsWith(VIRTUAL_PREFIX) && segments[0]?.toLowerCase() !== 'private';
  return !value.startsWith(VIRTUAL_PREFIX)
    && !['private', 'assets'].includes(segments[0]?.toLowerCase())
    && decoded !== '/robots.txt'
    && !/^\/sitemap(?:-|\.)/i.test(decoded);
}

function expected(availability, finalPath) {
  return { availability, finalPath };
}

function virtualPaths(path, seed, type, count) {
  const id = seedFor(seed, path, type).toString(16).padStart(8, '0');
  return Array.from({ length: count }, (_, index) => `${VIRTUAL_PREFIX}${id}/${type}/${index + 1}`);
}

function errorRules() {
  return [
    ...HTTP_ERRORS.map(rule => ({ ...rule, expected: expected('unavailable', null) })),
    { type: 'soft-404', status: 200, expected: expected('unavailable', null) },
  ];
}

function mixedRules() {
  return [
    ...errorRules(),
    { type: 'wrong-content-type', status: 200, contentType: 'text/plain; charset=utf-8', expected: expected('available', null) },
    { type: 'slow-response', status: 200, delayMs: 300, expected: expected('available', null) },
    { type: 'redirect-chain', status: 302, expected: expected('available', '/') },
    { type: 'redirect-loop', status: 302, expected: expected('unavailable', null) },
  ];
}

function legacyRules() {
  return LEGACY_SERVER_TYPES.map(type => {
    const { expected: [availability, finalPath], ...rest } = LEGACY_RULES[type];
    return { type, ...rest, expected: expected(availability, finalPath) };
  });
}

function ruleTemplates(profile) {
  if (profile === 'none') return [];
  if (profile === 'legacy-server') return legacyRules();
  if (profile === 'errors') return errorRules();
  if (profile === 'redirects') return mixedRules().slice(-2);
  return mixedRules();
}

export function buildTransportPlan(pages, { profile = 'none', seed = 0 } = {}) {
  if (!Array.isArray(pages)) throw new TypeError('pages must be an array');
  if (!TRANSPORT_PROFILES.includes(profile)) throw new TypeError(`profile must be one of: ${TRANSPORT_PROFILES.join(', ')}`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be an unsigned 32-bit integer');
  if (profile === 'none') return { version: 1, profile, rules: [] };

  const candidates = [...new Set(pages
    .filter(page => page?.kind === 'detail' && safePath(page.url))
    .map(page => page.url))]
    .map(path => ({ path, rank: seedFor(seed, path, 'transport-order') }))
    .sort((left, right) => left.rank - right.rank || left.path.localeCompare(right.path))
    .map(item => item.path);

  const rules = ruleTemplates(profile).slice(0, candidates.length).map((template, index) => {
    const path = candidates[index];
    const rule = { path, ...template };
    if (template.expected.finalPath === null && ['wrong-content-type', 'slow-response'].includes(template.type)) {
      rule.expected = expected('available', path);
    }
    if (template.expected.finalPath === 'self') rule.expected = expected(template.expected.availability, path);
    if (template.type === 'redirect-status-chain') rule.virtualPaths = virtualPaths(path, seed, template.type, 4);
    if (template.type === 'redirect-case-variant') rule.location = path.toUpperCase();
    if (template.type === 'redirect-external') rule.location = `${EXTERNAL_REDIRECT_ORIGIN}${path}`;
    if (template.type === 'redirect-chain') rule.virtualPaths = virtualPaths(path, seed, template.type, 2);
    if (template.type === 'redirect-loop') rule.virtualPaths = virtualPaths(path, seed, template.type, 1);
    return rule;
  });
  return validateTransportPlan({ version: 1, profile, rules });
}

function validateExpected(value, type, path) {
  if (!plainObject(value)) fail(`${type}.expected must be an object`);
  exactKeys(value, ['availability', 'finalPath'], `${type}.expected`);
  if (!['available', 'unavailable'].includes(value.availability)) fail(`${type}.expected.availability is invalid`);
  if (value.finalPath !== null && !safePath(value.finalPath, { root: true })) fail(`${type}.expected.finalPath must be a safe local path or null`);
  if (LEGACY_RULES[type]) {
    const [availability, finalPath] = LEGACY_RULES[type].expected;
    if (value.availability !== availability || value.finalPath !== (finalPath === 'self' ? path : finalPath)) fail(`${type}.expected is fixed`);
    return;
  }
  if (ERROR_TYPES.has(type) && (value.availability !== 'unavailable' || value.finalPath !== null)) fail(`${type} must be expected unavailable without a final path`);
  if (['wrong-content-type', 'slow-response'].includes(type) && (value.availability !== 'available' || value.finalPath !== path)) fail(`${type} must remain available at its source path`);
  if (type === 'redirect-chain' && (value.availability !== 'available' || value.finalPath !== '/')) fail('redirect-chain must resolve to the healthy root');
  if (type === 'redirect-loop' && (value.availability !== 'unavailable' || value.finalPath !== null)) fail('redirect-loop must be unavailable without a final path');
}

function validateRule(rule, profile, index, claimedPaths) {
  if (!plainObject(rule)) fail(`rules[${index}] must be an object`);
  if (!ALL_TYPES.has(rule.type) || !PROFILE_TYPES[profile].has(rule.type)) fail(`rules[${index}].type is not allowed by profile ${profile}`);
  const extras = [];
  if (rule.type === 'http-429') extras.push('retryAfterSeconds');
  if (rule.type === 'wrong-content-type') extras.push('contentType');
  if (rule.type === 'slow-response') extras.push('delayMs');
  if (REDIRECT_TYPES.has(rule.type) || rule.type === 'redirect-status-chain') extras.push('virtualPaths');
  if (['redirect-case-variant', 'redirect-external'].includes(rule.type)) extras.push('location');
  if (LEGACY_RULES[rule.type]) extras.push(...LEGACY_EXTRAS.filter(key => key in LEGACY_RULES[rule.type]));
  exactKeys(rule, ['path', 'type', 'status', 'expected', ...new Set(extras)], `rules[${index}]`);
  if (!safePath(rule.path)) fail(`rules[${index}].path must be a safe non-root public path`);
  if (claimedPaths.has(rule.path)) fail(`rules[${index}].path is duplicated`);
  claimedPaths.add(rule.path);

  const fixedStatus = LEGACY_RULES[rule.type]?.status ?? HTTP_ERRORS.find(item => item.type === rule.type)?.status ?? (REDIRECT_TYPES.has(rule.type) ? 302 : 200);
  if (rule.status !== fixedStatus) fail(`${rule.type}.status must be ${fixedStatus}`);
  validateExpected(rule.expected, rule.type, rule.path);

  if (LEGACY_RULES[rule.type]) {
    for (const key of LEGACY_EXTRAS.filter(name => name in LEGACY_RULES[rule.type])) {
      if (JSON.stringify(rule[key]) !== JSON.stringify(LEGACY_RULES[rule.type][key])) fail(`${rule.type}.${key} is fixed`);
    }
    if (rule.type === 'redirect-case-variant' && rule.location !== rule.path.toUpperCase()) fail('redirect-case-variant.location must be the upper-case path');
    if (rule.type === 'redirect-external' && rule.location !== `${EXTERNAL_REDIRECT_ORIGIN}${rule.path}`) fail('redirect-external.location is fixed');
    if (rule.type === 'redirect-status-chain') {
      if (!Array.isArray(rule.virtualPaths) || rule.virtualPaths.length !== 4) fail('redirect-status-chain.virtualPaths must contain 4 local paths');
      for (const path of rule.virtualPaths) {
        if (!safePath(path, { virtual: true }) || claimedPaths.has(path)) fail('redirect-status-chain contains an unsafe or duplicated virtual path');
        claimedPaths.add(path);
      }
    }
    return;
  }
  if (rule.type === 'http-429' && (!Number.isInteger(rule.retryAfterSeconds) || rule.retryAfterSeconds < 1 || rule.retryAfterSeconds > 60)) fail('http-429.retryAfterSeconds must be between 1 and 60');
  if (rule.type === 'wrong-content-type' && rule.contentType !== 'text/plain; charset=utf-8') fail('wrong-content-type.contentType is fixed');
  if (rule.type === 'slow-response' && (!Number.isInteger(rule.delayMs) || rule.delayMs < 1 || rule.delayMs > 300)) fail('slow-response.delayMs must be between 1 and 300');
  if (REDIRECT_TYPES.has(rule.type)) {
    if (!Array.isArray(rule.virtualPaths)) fail(`${rule.type}.virtualPaths must be an array`);
    const wanted = rule.type === 'redirect-chain' ? 2 : 1;
    if (rule.virtualPaths.length !== wanted) fail(`${rule.type}.virtualPaths must contain ${wanted} local path${wanted === 1 ? '' : 's'}`);
    for (const path of rule.virtualPaths) {
      if (!safePath(path, { virtual: true })) fail(`${rule.type} contains an unsafe virtual path`);
      if (claimedPaths.has(path)) fail(`${rule.type} contains a duplicated virtual path`);
      claimedPaths.add(path);
    }
  }
}

export function validateTransportPlan(value) {
  if (!plainObject(value)) fail('manifest must be an object');
  exactKeys(value, ['version', 'profile', 'rules'], 'manifest');
  if (value.version !== 1) fail('version must be 1');
  if (!TRANSPORT_PROFILES.includes(value.profile)) fail(`profile must be one of: ${TRANSPORT_PROFILES.join(', ')}`);
  if (!Array.isArray(value.rules) || value.rules.length > PROFILE_LIMITS[value.profile]) fail(`profile ${value.profile} allows at most ${PROFILE_LIMITS[value.profile]} rules`);
  const claimedPaths = new Set();
  const types = new Set();
  value.rules.forEach((rule, index) => {
    validateRule(rule, value.profile, index, claimedPaths);
    if (types.has(rule.type)) fail(`rule type ${rule.type} is duplicated`);
    types.add(rule.type);
  });
  return structuredClone(value);
}
