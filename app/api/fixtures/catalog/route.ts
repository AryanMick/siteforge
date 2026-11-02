import { z } from 'zod';
import { createJob } from '@/fixture-lab/store.mjs';
import { apiError, bodyJson, json, localOnly, FixtureHttpError } from '@/fixture-lab/http.mjs';
import { FIXTURE_DOMAINS, FRAMEWORKS, FIELD_LAYOUTS } from '@/fixture-lab/config.mjs';
import { CATALOG_SETTINGS, CATALOG_VERSION, ALL_CASE_PROFILES, CORE_CASE_COUNT, TOTAL_CASE_COUNT, getCatalogCase, listCatalogCases } from '@/fixture-lab/case-catalog.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(TOTAL_CASE_COUNT).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  search: z.string().trim().max(100).default(''),
  domain: z.string().max(50).optional(), framework: z.string().max(50).optional(),
  fieldLayout: z.string().max(50).optional(), protocol: z.enum(['http', 'https']).optional(),
  profile: z.string().max(50).optional(),
  set: z.enum(['all', 'core', 'real-world']).default('all'),
}).strict();
const commandSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all'), name: z.string().trim().min(1).max(80).default('Full regression catalog'), seed: z.number().int().min(0).max(0xffffffff).default(48291) }).strict(),
  z.object({ mode: z.literal('single'), caseId: z.string().regex(/^case-\d{4}$/), name: z.string().trim().min(1).max(80).default('Catalog case'), seed: z.number().int().min(0).max(0xffffffff).default(48291) }).strict(),
]);

export async function GET(request: Request) {
  try {
    localOnly(request);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const cases = listCatalogCases({ set: query.set }).filter(item => {
      for (const key of ['domain', 'framework', 'fieldLayout', 'protocol', 'profile'] as const) {
        if (query[key] && item[key] !== query[key]) return false;
      }
      return `${item.id} ${item.label} ${item.profile}`.toLowerCase().includes(query.search.toLowerCase());
    });
    const page = Math.min(query.page, Math.max(1, Math.ceil(cases.length / query.pageSize)));
    return json({ version: CATALOG_VERSION, total: TOTAL_CASE_COUNT, core: CORE_CASE_COUNT, matched: cases.length, page, pageSize: query.pageSize,
      cases: cases.slice((page - 1) * query.pageSize, page * query.pageSize), profiles: ALL_CASE_PROFILES,
      domains: FIXTURE_DOMAINS, frameworks: FRAMEWORKS, layouts: FIELD_LAYOUTS });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    localOnly(request, true);
    const command = commandSchema.parse(await bodyJson(request));
    if (command.mode === 'single' && !listCatalogCases({ id: command.caseId }).length) throw new FixtureHttpError(400, 'Unknown catalog case.');
    const config = { ...CATALOG_SETTINGS, name: command.name, seed: command.seed,
      ...(command.mode === 'single' ? { suite: 'catalog-case', siteCount: 1, caseId: command.caseId, previewProtocol: getCatalogCase(command.caseId).protocol } : {}) };
    return json({ job: await createJob(config) }, 202);
  } catch (error) { return apiError(error); }
}
