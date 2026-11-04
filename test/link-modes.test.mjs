import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/site/generator.mjs';
import { serve } from '../src/preview/server.mjs';

test('all link modes preserve the same private page answers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-link-modes-'));
  const pages = [];
  try {
    for (const mode of ['relative', 'absolute', 'mixed', 'base-relative']) {
      const directory = join(root, mode);
      await generate({ version: 1, seed: 124, site: { id: 'link-demo', domain: 'library', framework: 'html', pageCount: 8, baseUrl: 'http://link-demo.siteforge.test', linkMode: mode }, noise: { level: 'clean' } }, directory);
      const answer = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
      pages.push(answer.pages);
      const home = await readFile(join(directory, 'public', 'index.html'), 'utf8');
      if (mode === 'relative') assert.match(home, /href="\.\/assets\/site\.css"/);
      if (mode === 'absolute') assert.match(home, /href="http:\/\/link-demo\.siteforge\.test\/assets\/site\.css"/);
      if (mode === 'base-relative') {
        assert.match(home, /<base href="\/">/);
        assert.match(home, /href="\.\/assets\/site\.css"/);
      }
      const preview = await serve(directory, { port: 0, rebaseOrigin: true });
      try {
        const response = await fetch(preview.url);
        assert.equal(response.status, 200);
        const served = await response.text();
        assert.ok(!served.includes('href="http://link-demo.siteforge.test/'));
        const stylesheet = new URL(served.match(/<link rel="stylesheet" href="([^"]+)"/)[1], preview.url);
        assert.equal((await fetch(stylesheet)).status, 200);
      } finally { await preview.close(); }
    }
    assert.deepEqual(pages[0], pages[1]);
    assert.deepEqual(pages[1], pages[2]);
    assert.deepEqual(pages[2], pages[3]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
