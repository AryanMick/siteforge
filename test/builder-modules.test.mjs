import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDER_AUDIO_PATH, BUILDER_CONTAINER_CLASS, BUILDER_PHOTO_PATH, builderModuleKinds, builderModulesMarkup, builderModulesProfile, builderSampleWav } from '../src/noise/builder-modules.mjs';

// This file needs no installed packages: it checks the markup builder on its own. The operator inside real pages
// (container placement, answer key, composition with the other operators) is covered in adversarial-html.test.mjs
// and legacy-noise-contract.test.mjs.

const VOID = new Set(['img', 'source', 'br', 'input', 'meta', 'link', 'hr']);
// Every non-void tag closes in order, which catches a dropped or misplaced closing tag without an HTML parser.
function assertBalanced(html, label) {
  const stack = [];
  for (const [, closing, name] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (VOID.has(name)) continue;
    if (!closing) { stack.push(name); continue; }
    assert.equal(stack.pop(), name, `${label}: unexpected </${name}>`);
  }
  assert.deepEqual(stack, [], `${label}: unclosed tags`);
}
const markup = (profile, severity = 3, seed = 17, pageId = 'page-1') => builderModulesMarkup({ profile, severity, seed, pageId });

test('severity decides which modules are added', () => {
  assert.deepEqual(builderModuleKinds(1), ['photo', 'button']);
  assert.deepEqual(builderModuleKinds(2), ['photo', 'button', 'audio']);
  assert.deepEqual(builderModuleKinds(3), ['photo', 'button', 'audio', 'slider']);
});

test('only WordPress sites with Beaver Builder or Elementor get builder-specific markup', () => {
  assert.equal(builderModulesProfile({ cmsProfile: 'wordpress', builderProfile: 'beaver-builder' }), 'beaver');
  assert.equal(builderModulesProfile({ cmsProfile: 'wordpress', builderProfile: 'elementor' }), 'elementor');
  for (const site of [{ cmsProfile: 'wordpress', builderProfile: 'divi' }, { cmsProfile: 'wordpress', builderProfile: 'gutenberg' }, { cmsProfile: 'drupal', builderProfile: 'none' }, { cmsProfile: 'none' }, {}, undefined]) {
    assert.equal(builderModulesProfile(site), 'generic');
  }
  assert.equal(BUILDER_CONTAINER_CLASS.beaver, 'fl-col-content');
  assert.equal(BUILDER_CONTAINER_CLASS.elementor, 'e-con');
  assert.equal(BUILDER_CONTAINER_CLASS.generic, null);
});

test('Beaver Builder modules use the fl-module wrappers with a data-node id', () => {
  const html = markup('beaver');
  for (const kind of ['photo', 'button', 'audio', 'content-slider']) assert.match(html, new RegExp(`class="fl-module fl-module-${kind} fl-node-[0-9a-f]{8}" data-node="[0-9a-f]{8}"`), kind);
  assert.match(html, /class="fl-photo-img /);
  assert.match(html, /class="fl-button"/);
  assert.match(html, /class="fl-audio-player"/);
  assert.equal(html.match(/class="fl-slide fl-slide-\d /g).length, 3);
  assertBalanced(html, 'beaver');
});

test('Elementor modules use widget wrappers with data-id and widget_type', () => {
  const html = markup('elementor');
  for (const type of ['image.default', 'button.default', 'wp-widget-media_audio.default', 'image-carousel.default']) assert.match(html, new RegExp(`data-element_type="widget" data-widget_type="${type.replace('.', '\\.')}"`), type);
  assert.equal(html.match(/class="swiper-slide"/g).length, 3);
  assert.match(html, /class="elementor-image-carousel-caption"/);
  assertBalanced(html, 'elementor');
});

test('plain sites get generic blocks', () => {
  const html = markup('generic');
  assert.equal(html.match(/class="content-module /g).length, 4);
  assertBalanced(html, 'generic');
});

test('every profile and severity is balanced, script-free, local-only and never names the operator', () => {
  for (const profile of ['beaver', 'elementor', 'generic']) {
    for (const severity of [1, 2, 3]) {
      const html = markup(profile, severity);
      assertBalanced(html, `${profile} severity ${severity}`);
      assert.doesNotMatch(html, /<script\b|<iframe\b|javascript:|builder-modules|noiseEvents|pageId/i);
      const targets = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(match => match[1]);
      assert(targets.length > 0);
      for (const target of targets) assert(/^\/(?!\/)/.test(target) || target.startsWith('#'), `${profile}: ${target}`);
    }
  }
  assert.match(markup('generic', 3), new RegExp(`src="${BUILDER_PHOTO_PATH}"`));
  assert.match(markup('generic', 3), new RegExp(`src="${BUILDER_AUDIO_PATH}"`));
  assert.doesNotMatch(markup('beaver', 1), /<audio|swiper|fl-content-slider/);
});

test('output repeats for a fixed seed and page and changes with either', () => {
  assert.equal(markup('beaver'), markup('beaver'));
  assert.notEqual(markup('beaver'), markup('beaver', 3, 18));
  assert.notEqual(markup('beaver'), markup('beaver', 3, 17, 'page-2'));
});

test('the module text carries no record data and is the same on every page', () => {
  const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(text(markup('generic', 3, 17, 'page-1')), text(markup('generic', 3, 99, 'page-2')));
});

test('the sample audio file is a valid PCM WAV', () => {
  const wav = builderSampleWav();
  assert.equal(wav.length, 44 + 3200);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), 3200);
  assert.deepEqual(builderSampleWav(), wav);
});
