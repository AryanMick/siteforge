import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLegacyFixture } from '../src/legacy-fixture.mjs';
import { auditLocalContrast } from '../src/contrast-audit.mjs';
import { serve } from '../src/server.mjs';
import { json } from '../src/util.mjs';

const parent = resolve(process.env.LEGACY_CHECK_OUT ?? join(tmpdir(), `siteforge-legacy-browser-${Date.now()}`));
await mkdir(parent, { recursive: true });
const fixture = join(parent, 'fixture');
await createLegacyFixture(fixture);
const server = await serve(fixture, { port: 0 });
let result;
try {
  result = await auditLocalContrast(server.url, ['/books/legacy/', '/books/clean/'], {
    outDir: join(parent, 'screenshots'),
  });
} finally {
  await server.close();
}

await writeFile(join(parent, 'contrast-results.json'), json(result));
if (result.status === 'unavailable') {
  console.error(result.note);
  console.error(`Evidence: ${parent}`);
  process.exitCode = 2;
} else {
  const poor = result.samples.filter((sample) => new URL(sample.url).pathname === '/books/legacy/');
  const good = result.samples.filter((sample) => new URL(sample.url).pathname === '/books/clean/');
  assert.equal(poor.length, 2);
  assert.equal(good.length, 2);
  assert(poor.every((sample) => sample.violations.some((violation) => violation.id === 'color-contrast')), 'poor page must produce a rendered color-contrast violation at every viewport');
  assert(good.every((sample) => !sample.violations.some((violation) => violation.id === 'color-contrast')), 'good page must not produce a rendered color-contrast violation');
  assert(poor.some((sample) => sample.viewport.width === 390 && sample.horizontalOverflow), 'poor page must demonstrate mobile horizontal overflow');
  console.log(`PASS: ${poor.length} poor-page samples failed color contrast and ${good.length} good-page samples did not.`);
  console.log(`Incomplete results are retained separately in ${join(parent, 'contrast-results.json')}.`);
  console.log(`Evidence: ${parent}`);
}
