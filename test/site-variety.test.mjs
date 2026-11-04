import test from 'node:test';
import assert from 'node:assert/strict';
import * as parse5 from 'parse5';
import { createModel } from '../src/site/model.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { renderPage } from '../src/render/renderers.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { siteLook, contrast } from '../src/render/site-look.mjs';
import { DOMAINS } from '../src/site/presets.mjs';
import { walk, attr } from '../src/site/util.mjs';

const model = (domain, seed) => createModel(validateConfig(sitePlan({ name: 'Variety', domain, pagesPerSite: 30, seed, visualStyle: 'conventional', randomness: 50 }, 0).config));

test('sites of the same type differ in name, sections, palette, fonts, header and home layout', () => {
  for (const domain of DOMAINS) {
    const signatures = new Set(); const palettes = new Set(); const homes = new Set(); const names = new Set(); const sections = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const source = model(domain, seed * 977);
      const html = renderPage(source.site, source.pages[0]);
      const look = siteLook(source.site);
      names.add(source.site.name);
      sections.add(source.site.navigation.map(item => item.label).join('|'));
      palettes.add(look.vars['--accent-strong']);
      homes.add(/home-v-\d/.exec(html)[0] + /tiles-\w+/.exec(html)[0]);
      signatures.add([/header-v-\d/.exec(html)?.[0], /footer-v-\d/.exec(html)?.[0], look.modes.headerMode, look.modes.navMode, look.fonts.join('+')].join(' '));
    }
    assert(names.size >= 10, `${domain}: names`);
    assert(sections.size >= 5, `${domain}: section labels`);
    assert(palettes.size >= 8, `${domain}: palettes`);
    assert(homes.size >= 6, `${domain}: home layouts`);
    assert(signatures.size >= 10, `${domain}: header/footer/font combinations`);
  }
});

test('every generated palette keeps text readable (WCAG AA)', () => {
  for (const domain of DOMAINS) for (let seed = 1; seed <= 25; seed++) {
    const { vars } = siteLook(model(domain, seed * 131).site);
    const pairs = [['--ink', '--paper'], ['--muted', '--paper'], ['--accent', '--paper'], ['--kicker', '--paper'], ['--brand', '--header-bg'], ['--utility-ink', '--utility-bg'], ['--footer-strong', '--footer-bg'], ['--footer-ink', '--footer-bg'], ['--cta-ink', '--cta-bg']];
    if (vars['--nav-bg'] !== 'transparent') pairs.push(['--nav-ink', '--nav-bg']);
    for (const [fg, bg] of pairs) assert(contrast(vars[fg], vars[bg]) >= 4.5, `${domain}/${seed}: ${fg} on ${bg} = ${contrast(vars[fg], vars[bg]).toFixed(2)}`);
  }
});

test('home pages keep every link once and stay parseable', () => {
  for (const domain of DOMAINS) for (const seed of [3, 4, 5]) {
    const source = model(domain, seed);
    const home = source.pages[0];
    const main = walk(parse5.parse(renderPage(source.site, home)), node => node.tagName === 'main')[0];
    const hrefs = walk(main, node => node.tagName === 'a').map(node => attr(node, 'href'));
    for (const link of home.links) assert.equal(hrefs.filter(href => href === link.href).length, 1, `${domain}: ${link.href}`);
    assert.equal(walk(main, node => attr(node, 'id') === 'related-heading').length, 1);
  }
});
