// Pushes a generated site into the local Drupal (.drupal/, see runtime.mjs). It uses the same Drupal package as the
// app's Drupal download (src/cms/cms-theme.mjs): a module that creates one Drupal content type per SiteForge content
// type, imports every page as a node at its generated address, and a theme that keeps the generated markup inside
// Drupal's own page markup. Pages keep their addresses, so the site's own answer key scores a crawl of the Drupal site.
//
// The module has one fixed name (siteforge_content), so the local Drupal holds one site at a time: pushing another
// site removes the previous one first.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { cmsPackageEntries } from '../cms/cms-theme.mjs';
import { call, drupalPaths, drupalStatus, drupalToken } from './runtime.mjs';

export async function pushSiteToDrupal(siteDir, { root = process.cwd(), onProgress = () => {} } = {}) {
  const status = await drupalStatus({ root });
  if (status.state !== 'running') throw new Error('The local Drupal is not running. Start it first (Start Drupal in the app, or npm run drupal).');
  const token = await drupalToken(root);
  if (!token) throw new Error('The local Drupal has no SiteForge token. Stop it and start it again.');
  const paths = drupalPaths(root);
  const query = action => `${status.url}/siteforge-push.php?action=${action}&token=${token}`;
  siteDir = resolve(siteDir);
  const site = JSON.parse(await readFile(join(siteDir, 'private', 'answer-key.json'), 'utf8')).site ?? {};

  await onProgress({ phase: 'remove' });
  await call(query('remove'), 10 * 60 * 1000);
  await rm(join(paths.site, 'modules', 'custom', 'siteforge_content'), { recursive: true, force: true });
  await rm(join(paths.site, 'themes', 'custom', 'siteforge_theme'), { recursive: true, force: true });

  await onProgress({ phase: 'write' });
  const { content, entries } = await cmsPackageEntries(siteDir, 'drupal');
  for (const entry of entries) {
    if (entry.name === 'SITEFORGE-README.txt') continue;
    const target = join(paths.site, entry.name);
    await mkdir(dirname(target), { recursive: true });
    if (entry.data !== undefined) await writeFile(target, entry.data);
    else if (entry.path) await copyFile(entry.path, target);
    else await pipeline(await entry.open(), createWriteStream(target));
  }

  await onProgress({ phase: 'import', total: content.total });
  const result = await call(query('import'), 60 * 60 * 1000);
  await writeFile(join(paths.data, 'current.json'), JSON.stringify({ siteDir, siteId: site.id ?? null, pushedAt: new Date().toISOString() }, null, 2) + '\n');
  await onProgress({ phase: 'done', done: content.total, total: content.total });
  return {
    siteId: site.id ?? null, url: `${status.url}/`, adminUrl: `${status.url}/admin/content`, records: content.total, theme: result.theme,
    types: Object.entries(result.types ?? {}).map(([type, value]) => ({ name: type, label: value.label, count: value.count })),
  };
}
