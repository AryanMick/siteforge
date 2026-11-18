import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyTitle } from '../src/site/domain-content.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { DOMAINS } from '../src/site/presets.mjs';

test('titles never repeat a word in a row', () => {
  assert.equal(tidyTitle('Arts funding funding falls short, report finds'), 'Arts funding falls short, report finds');
  assert.equal(tidyTitle('Community Community Gardens Grants'), 'Community Gardens Grants');
  assert.equal(tidyTitle('Guide to the Planning Records Records'), 'Guide to the Planning Records');
  assert.equal(tidyTitle('Council approves new coastal planning plan'), 'Council approves new coastal planning strategy');
  assert.equal(tidyTitle('Council approves new school programs plan'), 'Council approves new school programs plan');
  for (const domain of DOMAINS) for (const seed of [1, 2, 3, 4, 5]) {
    const model = createModel(validateConfig({ version: 1, seed, site: { id: 'titles', domain, pageCount: 200 }, noise: { level: 'clean' } }));
    for (const page of model.pages) assert.doesNotMatch(String(page.fields?.title ?? ''), /\b(\w+)\s+\1\b/i, `${domain} seed ${seed}`);
  }
});
