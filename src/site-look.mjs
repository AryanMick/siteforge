import { seedFor } from './util.mjs';

// Per-site visual identity: palette, fonts, header/nav treatment, corner radius.
// Every colour pair that carries text is checked against WCAG AA (4.5:1) and darkened until it passes.

const HUES = {
  library: [186, 204, 160, 22, 262, 340, 32, 145],
  government: [214, 222, 205, 0, 190, 230, 28],
  municipality: [207, 200, 222, 12, 168, 280, 40],
  university: [0, 352, 215, 230, 140, 270, 25, 205],
  healthcare: [180, 192, 205, 160, 260, 330, 210],
  documentation: [221, 245, 265, 160, 190, 12, 280],
  museum: [0, 30, 45, 210, 340, 160, 0, 260],
  nonprofit: [125, 145, 25, 200, 280, 350, 40],
  records: [28, 35, 20, 200, 0, 120],
  news: [356, 0, 210, 220, 15, 200],
};
// Museums and news sites often run near-monochrome identities.
const MONO = new Set(['museum', 'news']);

const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  bookSerif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  didone: '"Playfair Display", "Didot", "Bodoni 72", Georgia, serif',
  humanist: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  grotesk: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  geometric: '"Avenir Next", "Century Gothic", "Trebuchet MS", Arial, sans-serif',
  slab: 'Rockwell, "Roboto Slab", "Courier New", Georgia, serif',
  condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
const PAIRINGS = [
  ['serif', 'humanist'], ['bookSerif', 'system'], ['didone', 'grotesk'], ['geometric', 'geometric'],
  ['slab', 'humanist'], ['condensed', 'serif'], ['grotesk', 'grotesk'], ['humanist', 'bookSerif'],
];

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}
const toHex = rgb => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
const fromHex = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
function luminance(hex) {
  return fromHex(hex).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Darken (or lighten) a colour along its lightness until it reaches the contrast target against `against`.
function ensure(h, s, l, against, target = 4.6, direction = -1) {
  let color = toHex(hslToRgb(h, s, l));
  for (let step = 0; step < 60 && contrast(color, against) < target; step++) {
    l = Math.max(0, Math.min(100, l + direction * 1.5));
    color = toHex(hslToRgb(h, s, l));
  }
  return color;
}

const cache = new WeakMap();

export function siteLook(site) {
  if (cache.has(site)) return cache.get(site);
  const hues = HUES[site.domain];
  if (!hues) return { className: '', css: '' };
  const pick = (salt, n) => seedFor(site.seed, site.id ?? '', 'look', salt) % n;
  const hue = (hues[pick('hue', hues.length)] + pick('hue-shift', 13) - 6 + 360) % 360;
  const mono = MONO.has(site.domain) && pick('mono', 3) === 0;
  const sat = mono ? 4 : 45 + pick('sat', 35);
  const paper = pick('paper', 4) === 0 ? toHex(hslToRgb(hue, Math.min(sat, 30), 98)) : '#ffffff';
  const ink = ensure(hue, Math.min(sat, 25), 14, paper, 12);
  const muted = ensure(hue, Math.min(sat, 15), 40, paper, 5.4);
  const accentStrong = ensure(hue, sat, 30, '#ffffff', 7);
  const accent = ensure(hue, sat, 38, '#ffffff', 4.8);
  const wash = toHex(hslToRgb(hue, Math.min(sat, 40), 95));
  const line = toHex(hslToRgb(hue, Math.min(sat, 22), 84));
  const ctaHue = pick('cta', 3) === 0 ? (hue + 150 + pick('cta-shift', 60)) % 360 : hue;
  const ctaBg = ensure(ctaHue, Math.max(sat, 55), 34, '#ffffff', 4.8);
  const warm = ensure((hue + 180) % 360, 70, 36, paper, 4.8);
  const headerMode = ['light', 'light', 'dark', 'tint'][pick('header', 4)];
  const navMode = ['band', 'plain', 'tint', 'band'][pick('nav', 4)];
  const utilityMode = ['dark', 'tint', 'light'][pick('utility', 3)];
  const footerMode = ['dark', 'accent', 'light'][pick('footer', 3)];
  const darkest = ensure(hue, Math.min(sat, 50), 14, '#ffffff', 14);
  const headerBg = headerMode === 'dark' ? darkest : headerMode === 'tint' ? wash : paper;
  const onHeader = headerMode === 'dark' ? '#ffffff' : accentStrong;
  const navBg = navMode === 'band' ? accentStrong : navMode === 'tint' ? wash : 'transparent';
  const navInk = navMode === 'band' ? '#ffffff' : headerMode === 'dark' && navMode === 'plain' ? '#ffffff' : ink;
  const utilityBg = utilityMode === 'dark' ? darkest : utilityMode === 'tint' ? wash : paper;
  const utilityInk = utilityMode === 'dark' ? '#f1f1f1' : ink;
  const footerBg = footerMode === 'dark' ? darkest : footerMode === 'accent' ? accentStrong : wash;
  const footerInk = footerMode === 'light' ? muted : '#e9e9e9';
  const footerStrong = footerMode === 'light' ? ink : '#ffffff';
  const [brandKey, bodyKey] = site.domain === 'documentation' && pick('docs-mono', 2) === 0 ? ['mono', 'system'] : PAIRINGS[pick('fonts', PAIRINGS.length)];
  const headingKey = pick('heading-font', 3) === 0 ? bodyKey : brandKey;
  const radius = ['0', '4px', '8px', '999px'][pick('radius', 4)];
  const cardRadius = ['0', '6px', '12px', '18px'][pick('card-radius', 4)];
  const brandCase = pick('brand-case', 5) === 0 ? 'uppercase' : 'none';
  const navCase = pick('nav-case', 4) === 0 ? 'uppercase' : 'none';
  const brandWeight = [700, 800, 600, 900][pick('brand-weight', 4)];
  const brandSize = ['1.45rem', '1.6rem', '1.8rem', '2rem', '1.3rem'][pick('brand-size', 5)];
  const className = `look-${(seedFor(site.seed, site.id ?? '', 'look-class') % 1e8).toString(36)} look-header-${headerMode} look-nav-${navMode}`;
  const first = className.split(' ')[0];
  const vars = {
    '--paper': paper, '--wash': wash, '--line': line, '--ink': ink, '--muted': muted,
    '--accent': accent, '--accent-strong': accentStrong, '--red': warm, '--kicker': warm,
    '--brand': onHeader, '--brand-font': `${brandWeight} ${brandSize} ${FONTS[brandKey]}`, '--heading-font': FONTS[headingKey],
    '--brand-case': brandCase, '--brand-spacing': brandCase === 'uppercase' ? '0.04em' : '0',
    '--header-bg': headerBg, '--header-muted': headerMode === 'dark' ? '#d7d7d7' : muted,
    '--utility-bg': utilityBg, '--utility-ink': utilityInk,
    '--nav-bg': navBg, '--nav-line': navMode === 'band' ? accentStrong : line, '--nav-ink': navInk,
    '--nav-current': navMode === 'band' ? '#ffd45c' : accent, '--nav-case': navCase, '--nav-size': navCase === 'uppercase' ? '0.82rem' : '0.94rem',
    '--nav-spacing': navCase === 'uppercase' ? '0.06em' : '0', '--nav-align': pick('nav-align', 4) === 0 ? 'center' : 'flex-start',
    '--cta-bg': ctaBg, '--cta-ink': '#ffffff', '--radius': radius, '--card-radius': cardRadius,
    '--footer-bg': footerBg, '--footer-ink': footerInk, '--footer-strong': footerStrong,
    '--footer-line': footerMode === 'light' ? line : 'rgba(255,255,255,0.18)', '--heading-spacing': pick('tight', 3) === 0 ? '-0.01em' : '0',
  };
  const body = Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`).join('\n');
  const css = `body.${first}.${first}:not(.style-legacy) {\n${body}\n  font-family: ${FONTS[bodyKey]};\n}\nbody.${first}.${first}:not(.style-legacy) .site-search input { background: #ffffff; color: #1b1b1b; border-color: ${line}; }\n`;
  const look = { className, css, vars, fonts: [brandKey, bodyKey], modes: { headerMode, navMode, utilityMode, footerMode } };
  cache.set(site, look);
  return look;
}
