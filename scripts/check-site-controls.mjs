#!/usr/bin/env node
// Browser check for the controls on generated test websites (2026-11-02).
//
// Generates a few varied small sites (plain HTML, WordPress/React, Drupal/Angular, Wix, Shopify, a site without
// source clutter), serves each with the preview server and:
//  1. requests every same-site link, form action, script, stylesheet and image in every public HTML file and expects
//     200, except URLs recorded as deliberate noise in the private answer key (or its transport plan);
//  2. clicks every button in <main> on one listing and several detail pages and asserts that each one has a visible
//     effect (navigation to a page that exists, a toast, a dialog, a download, a copy, print, a pressed state or a
//     changed listing), and drives the header, footer, consent, menu, newsletter, search, my-list, request and
//     sign-in flows end to end.
// Usage: PLAYWRIGHT_BROWSERS_PATH=... node scripts/check-site-controls.mjs   (artifacts are removed afterwards)
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { generate, listFiles } from '../src/generator.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { serve } from '../src/server.mjs';

const cheerio = createRequire(import.meta.url)('cheerio');
const SITES = [
  { cmsProfile: 'none', domain: 'library', framework: 'html', linkMode: 'root-relative' },
  { cmsProfile: 'wordpress', domain: 'university', framework: 'react', linkMode: 'root-relative' },
  { cmsProfile: 'drupal', domain: 'museum', framework: 'angular', linkMode: 'relative' },
  { cmsProfile: 'wix', domain: 'healthcare', framework: 'html', linkMode: 'absolute' },
  { cmsProfile: 'shopify', domain: 'news', framework: 'html', linkMode: 'root-relative' },
  { cmsProfile: 'none', domain: 'municipality', framework: 'html', linkMode: 'root-relative', sourceClutter: 'none' },
];
const only = process.env.SITE_FILTER ? new RegExp(process.env.SITE_FILTER) : null;
const failures = [];
const fail = (site, message) => { failures.push(`${site}: ${message}`); console.log(`  FAIL ${message}`); };

async function linkCheck(label, directory, origin) {
  const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
  const transport = await readFile(join(directory, 'private', 'transport.json'), 'utf8').catch(() => '');
  const recorded = JSON.stringify(truth.pages.map(page => page.noiseEvents)) + transport;
  // Broken-image noise points the page image at /assets/missing-<n>.png; it is recorded by type on that page.
  const brokenImagePages = new Set(truth.pages.filter(page => page.noiseEvents.some(event => event.type === 'broken-image')).map(page => page.url));
  const sourceOrigin = new URL(truth.site?.baseUrl ?? (await readFile(join(directory, 'private', 'config.json'), 'utf8').then(text => JSON.parse(text).site.baseUrl))).origin;
  const files = (await listFiles(join(directory, 'public'))).filter(file => /\.html?$/.test(file));
  const urls = new Map();
  for (const file of files) {
    const html = await readFile(join(directory, 'public', file), 'utf8');
    const $ = cheerio.load(html);
    const base = new URL($('base[href]').attr('href') ?? (file.endsWith('index.html') ? `/${file.replace(/index\.html$/, '')}` : `/${file}`), origin);
    $('a[href], link[href], script[src], img[src], iframe[src], form[action], source[src]').each((_, el) => {
      // The hidden rel=nofollow "Staff sign in" honeypot points at the CMS admin login on purpose (a real page once the
      // site is installed into WordPress/Drupal; 404 on the static preview).
      if ($(el).closest('template, noscript, .crawler-honeypot').length || ['dns-prefetch', 'preconnect', 'shortlink'].includes(el.attribs.rel)) return;
      const raw = el.attribs.href ?? el.attribs.src ?? el.attribs.action;
      if (!raw || /^(mailto|tel|sms|javascript|data|ftp|file):/i.test(raw) || raw.startsWith('#')) return;
      let target;
      try { target = new URL(raw, base); } catch { return; }
      if (target.origin === sourceOrigin) target = new URL(`${target.pathname}${target.search}`, origin);
      if (target.origin !== origin) {
        if (!recorded.includes(raw) && !/\.invalid$|example\.invalid/.test(target.hostname)) urls.set(`EXTERNAL ${raw}`, file);
        return;
      }
      target.hash = '';
      if (/^\/assets\/missing-\d+(-[12]x)?\.png$/.test(target.pathname) && brokenImagePages.has(`/${file.replace(/index\.html$/, '')}`)) return;
      if (!urls.has(target.href)) urls.set(target.href, `${file} (${raw})`);
    });
  }
  const bad = [];
  const entries = [...urls];
  for (let i = 0; i < entries.length; i += 24) {
    await Promise.all(entries.slice(i, i + 24).map(async ([url, from]) => {
      if (url.startsWith('EXTERNAL ')) { bad.push(`${url} from ${from}`); return; }
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) }).catch(error => ({ status: error.name }));
      if (response.status === 200) { await response.arrayBuffer?.(); return; }
      const { pathname, search } = new URL(url);
      if (recorded.includes(pathname) || (search && recorded.includes(search.slice(1, 40))) || recorded.includes(decodeURIComponent(pathname))) return;
      bad.push(`${response.status} ${url} from ${from}`);
    }));
  }
  console.log(`  links: ${urls.size} unique same-site URLs checked, ${bad.length} unexpected failures`);
  for (const line of bad.slice(0, 20)) fail(label, line);
  return truth;
}

async function ready(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-sf-ready') === 'true', null, { timeout: 15000 });
}

async function state(page) {
  return page.evaluate(() => ({
    url: location.href,
    toast: [...document.querySelectorAll('.sf-toast:not([hidden])')].map(t => t.textContent).join(''),
    dialog: document.querySelectorAll('.sf-dialog').length,
    attrs: ['data-sf-download', 'data-sf-copied', 'data-sf-printed'].map(name => document.documentElement.getAttribute(name)).join('|'),
    pressed: [...document.querySelectorAll('main [aria-pressed]')].map(b => b.getAttribute('aria-pressed') + b.textContent).join('|'),
    listing: (document.querySelector('.pg-result-count')?.textContent ?? '') + (document.querySelector('.pg-inner')?.className ?? ''),
  }));
}

async function clickEveryButton(label, page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await ready(page);
  const count = await page.locator('main button').count();
  let checked = 0;
  for (let i = 0; i < count; i++) {
    if (page.url().split('#')[0] !== url) { await page.goto(url, { waitUntil: 'load' }); await ready(page); }
    const button = page.locator('main button').nth(i);
    const info = await button.evaluate(b => ({ text: (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' '), onclick: b.hasAttribute('onclick'), visible: !!(b.offsetWidth || b.offsetHeight) && !b.closest('[hidden]'), submit: b.type === 'submit' && !!b.closest('form') })).catch(() => null);
    if (!info || !info.visible || info.onclick) continue; // inline-handler buttons are recorded crawler-trap/link noise
    await page.evaluate(() => { document.querySelectorAll('.sf-toast').forEach(t => { t.hidden = true; t.textContent = ''; }); document.querySelectorAll('.sf-dialog').forEach(d => d.remove()); ['data-sf-download', 'data-sf-copied', 'data-sf-printed'].forEach(n => document.documentElement.removeAttribute(n)); });
    if (info.submit) await button.evaluate(b => { const f = b.closest('form'); f.querySelectorAll('input[type=email]').forEach(i => { i.value = 'reader@example.org'; }); });
    const before = await state(page);
    const download = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
    await button.click({ timeout: 5000 }).catch(error => fail(label, `${url} button "${info.text}" could not be clicked: ${error.message.split('\n')[0]}`));
    const downloaded = await download;
    await page.waitForTimeout(250);
    await page.waitForLoadState('load').catch(() => {});
    let after;
    try { after = await state(page); } catch { await page.waitForLoadState('load'); after = await state(page); }
    const effects = [];
    if (after.url !== before.url) {
      const response = await page.request.get(after.url);
      if (response.status() !== 200) fail(label, `"${info.text}" navigated to ${after.url} (${response.status()})`);
      effects.push(`navigates to ${new URL(after.url).pathname}`);
    }
    if (after.toast && after.toast !== before.toast) effects.push(`toast "${after.toast.replace('×', '').slice(0, 60)}"`);
    if (after.dialog > before.dialog) effects.push('dialog');
    if (after.attrs !== before.attrs) effects.push(`attrs ${after.attrs}`);
    if (downloaded) effects.push(`download ${downloaded.suggestedFilename()}`);
    if (after.pressed !== before.pressed) effects.push('pressed state');
    if (after.listing !== before.listing) effects.push('listing updated');
    if (!effects.length) fail(label, `${new URL(url).pathname} button "${info.text}" had no visible effect`);
    else checked++;
    if (process.env.VERBOSE) console.log(`    "${info.text}": ${effects.join(', ')}`);
  }
  return checked;
}

async function flows(label, page, origin, truth, opts) {
  const step = name => { if (opts.verbose) console.log(`    flow: ${name}`); };
  const home = new URL('/', origin).href;
  await page.goto(home, { waitUntil: 'load' });
  await ready(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  step('Consent banner');
  // Consent banner: shown once, each button hides it and the choice is remembered.
  if (await page.locator('#consent-banner').count()) {
    assert.equal(await page.locator('#consent-banner').isVisible(), true, 'consent banner shows on a first visit');
    await page.locator('#consent-banner [data-open="consent-preferences"]').click();
    assert.equal(await page.locator('#consent-preferences').isVisible(), true, 'Manage preferences opens the preferences');
    await page.locator('#consent-preferences input:not([disabled])').first().check();
    await page.locator('#consent-preferences button[type=submit]').click();
    assert.equal(await page.locator('#consent-preferences').isVisible(), false, 'Save preferences closes the dialog');
    assert.equal(await page.locator('#consent-banner').isVisible(), false, 'saving hides the banner');
    await page.reload(); await ready(page);
    assert.equal(await page.locator('#consent-banner').isVisible(), false, 'consent choice is remembered');
    await page.evaluate(() => localStorage.removeItem('sf:consent')); await page.reload(); await ready(page);
    await page.locator('#consent-banner [data-consent="deny"]').click();
    assert.equal(await page.locator('#consent-banner').isVisible(), false, 'Reject hides the banner');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('sf:consent'))).analytics, false);
    await page.evaluate(() => localStorage.removeItem('sf:consent')); await page.reload(); await ready(page);
    await page.locator('#consent-banner [data-consent="accept"]').click();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('sf:consent'))).analytics, true, 'Accept all stores consent');
    await page.locator('footer a', { hasText: 'Cookie settings' }).click();
    assert.equal(await page.locator('#consent-preferences').isVisible(), true, 'footer Cookie settings opens preferences');
    await page.keyboard.press('Escape');
    await page.locator('#consent-preferences button[type=submit]').click();
  }
  step('Mobile menu');
  // Mobile menu, submenu and mega-menu toggles open and close.
  if (await page.locator('.sf-menu-toggle').count()) {
    await page.locator('.sf-menu-toggle').click();
    assert.equal(await page.locator('#mobile-menu').isVisible(), true, 'Menu opens the off-canvas menu');
    await page.locator('#mobile-menu .mobile-menu__toggle').first().click();
    assert.equal(await page.locator('#mobile-sub-1').isVisible(), true, 'submenu toggle opens the submenu');
    await page.locator('#mobile-menu .off-canvas__close').click();
    assert.equal(await page.locator('#mobile-menu').isVisible(), false, 'Close menu closes it');
  }
  if (await page.locator('.sf-mega-toggle').count()) {
    await page.locator('.sf-mega-toggle').first().click();
    assert.equal(await page.locator('#megamenu-panel-1').isVisible(), true, 'mega-menu toggle opens the panel');
    const link = page.locator('#megamenu-panel-1 a').first();
    assert.equal((await page.request.get(new URL(await link.getAttribute('href'), page.url()).href)).status(), 200, 'mega-menu link exists');
    await page.locator('.sf-mega-toggle').first().click();
    assert.equal(await page.locator('#megamenu-panel-1').isVisible(), false, 'mega-menu toggle closes the panel');
  }
  if (await page.locator('#accessibility-toolbar').count()) {
    await page.locator('[data-a11y="text-larger"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '110%', 'A+ enlarges text');
    await page.locator('[data-a11y="text-smaller"]').click();
    await page.locator('[data-a11y="contrast"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sf-contrast')), true, 'High contrast toggles');
    await page.locator('[data-a11y="contrast"]').click();
  }
  step('Header search');
  // Header search goes to a results page listing the matching page.
  const target = truth.pages.find(p => p.kind === 'detail');
  const word = target.title.split(/\s+/).find(w => w.length > 4) ?? target.title;
  await page.locator('header form[role=search] input[type=search]').first().fill(word);
  await page.locator('header form[role=search] button[type=submit]').first().click();
  await page.waitForURL(/site-search\.html/);
  await page.waitForSelector('.sf-search-status:not(:empty)');
  const results = await page.locator('.sf-result__title').allTextContents();
  assert.ok(results.includes(target.title), `search for "${word}" lists "${target.title}" (got ${results.slice(0, 5).join(' / ')})`);
  await page.locator('.sf-result__title', { hasText: target.title }).first().click();
  await ready(page);
  assert.equal(new URL(page.url()).pathname, target.url, 'search result opens the page');
  // The WordPress-style /?s= address also reaches the results page.
  await page.goto(new URL(`/?s=${encodeURIComponent(word)}`, origin).href); await page.waitForURL(/site-search\.html/);
  step('Header call to action');
  // Header call to action.
  const cta = page.locator('header .header-cta');
  if (await cta.count()) {
    const text = (await cta.textContent()).trim();
    await cta.click(); await page.waitForLoadState('load');
    assert.equal((await page.request.get(page.url())).status(), 200, `header CTA "${text}" target exists`);
    if (opts.verbose) console.log(`    header CTA "${text}" -> ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
  }
  // Footer: policy links open their notice, Print version prints, social icons open "Follow us".
  await page.goto(home); await ready(page);
  if (await page.locator('footer a[href="#privacy"]').count()) {
    await page.locator('footer a[href="#privacy"]').click();
    assert.equal(await page.locator('#privacy').evaluate(d => d.open), true, 'Privacy opens the privacy notice');
    if (await page.locator('.social-links__link').count()) { await page.locator('.social-links__link').first().click(); assert.equal(await page.locator('#connect').evaluate(d => d.open), true, 'social icon opens Follow us'); }
    await page.locator('.footer-print').click();
    assert.equal(await page.evaluate(() => window.__printed), 1, 'Print version calls window.print()');
  }
  step('Newsletter sign-up');
  // Newsletter sign-up ends on a confirmation.
  await page.goto(home); await ready(page);
  let form = page.locator('.newsletter-band__form, .pg-inline-form').first();
  if (!(await form.count())) { for (const p of truth.pages.slice(0, 12)) { await page.goto(new URL(p.url, origin).href); await ready(page); form = page.locator('.newsletter-band__form, .pg-inline-form').first(); if (await form.count()) break; } }
  if (await form.count()) {
    await form.locator('input[type=email]').fill('reader@example.org');
    await form.locator('button').click();
    await page.waitForURL(/subscribe\.html/);
    await page.waitForSelector('.sf-subscribed:not([hidden])');
    assert.match(await page.locator('.sf-subscribed').textContent(), /reader@example\.org is now subscribed/);
  }
  step('Request form');
  // Request form ends on a confirmation with a reference; sign-in signs in and out.
  await page.goto(new URL('/request.html?type=Book%20a%20room&item=Study%20room', origin).href); await ready(page);
  await page.locator('.sf-request-form button[type=submit]').click();
  assert.equal(await page.locator('.sf-error').isVisible(), true, 'empty request shows an error');
  await page.fill('.sf-request-form [name=name]', 'Test Reader'); await page.fill('.sf-request-form [name=email]', 'reader@example.org');
  await page.locator('.sf-request-form button[type=submit]').click();
  assert.match(await page.locator('.sf-request-done').textContent(), /Request received[\s\S]*R-[0-9A-Z]{6}/);
  await page.goto(new URL('/sign-in.html?for=Renew%20items', origin).href); await ready(page);
  await page.fill('.sf-signin-form [name=email]', 'reader@example.org'); await page.fill('.sf-signin-form [name=password]', 'secret1');
  await page.locator('.sf-signin-form button[type=submit]').click();
  assert.match(await page.locator('.sf-signed-in').textContent(), /Signed in as reader@example\.org[\s\S]*nothing to renew/);
  await page.locator('[data-sign-out]').click();
  assert.equal(await page.locator('.sf-signin-form').isVisible(), true, 'Sign out shows the form again');
  step('Print view');
  // Print view and back to top.
  await page.goto(new URL(`${target.url}?print=1`, origin).href); await ready(page);
  assert.equal(await page.locator('.sf-printbar').isVisible(), true, 'Print version shows the print view');
  await page.locator('.sf-printbar button').click();
  assert.ok(await page.evaluate(() => window.__printed) >= 1, 'Print this page calls window.print()');
  if (await page.locator('.back-to-top').count()) {
    await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 2000); window.dispatchEvent(new Event('scroll')); });
    await page.locator('.back-to-top').click();
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Back to top scrolls up');
  }
  if (errors.length) fail(label, `page errors: ${errors.slice(0, 3).join(' | ')}`);
}

async function checkSite(browser, root, spec, index) {
  const label = `${spec.cmsProfile}/${spec.domain}/${spec.framework}/${spec.linkMode}${spec.sourceClutter ? `/clutter-${spec.sourceClutter}` : ''}`;
  console.log(`site ${label}`);
  const directory = join(root, `site-${index}`);
  const plan = sitePlan({ name: 'Controls', domain: spec.domain, pagesPerSite: 24, seed: 9100 + index, visualStyle: 'modern', randomness: 60, cmsProfile: spec.cmsProfile, noise: 'medium', framework: spec.framework, linkMode: spec.linkMode, sourceClutter: spec.sourceClutter ?? 'realistic', optionalFields: true }, 0);
  await generate(plan.config, directory);
  const preview = await serve(directory, { port: 0, rebaseOrigin: true });
  const context = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  const page = await context.newPage();
  try {
    const truth = await linkCheck(label, directory, preview.url);
    await flows(label, page, preview.url, truth, { verbose: !!process.env.VERBOSE }).catch(error => fail(label, `flow: ${error.message.split('\n').slice(0, process.env.VERBOSE ? 6 : 1).join(' | ')}`));
    const listing = truth.pages.find(p => p.kind === 'listing');
    const details = [...new Map(truth.pages.filter(p => p.kind === 'detail').map(p => [p.contentType, p])).values()].slice(0, 4);
    let clicked = 0;
    for (const p of [listing, ...details].filter(Boolean)) clicked += await clickEveryButton(label, page, new URL(p.url, preview.url).href).catch(error => { fail(label, `${p.url}: ${error.message.split('\n')[0]}`); return 0; });
    // "Place hold" / "Add to list" / "Follow" style buttons put the item on the My list page.
    await page.goto(new URL('/my-list.html', preview.url).href); await ready(page);
    const listText = await page.locator('.sf-list').textContent();
    console.log(`  buttons with a verified effect: ${clicked}; my list: ${listText.slice(0, 120).replace(/\s+/g, ' ')}`);
    assert.ok(!/Your list is empty/.test(listText), 'saved items and requests appear on My list');
  } catch (error) {
    fail(label, error.message.split('\n')[0]);
  } finally {
    await context.close();
    await preview.close();
  }
}

const root = await mkdtemp(join(tmpdir(), 'siteforge-controls-'));
const browser = await chromium.launch({ headless: true });
try {
  for (const [index, spec] of SITES.entries()) if (!only || only.test(`${spec.cmsProfile}/${spec.domain}`)) await checkSite(browser, root, spec, index);
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nAll site controls passed.');
