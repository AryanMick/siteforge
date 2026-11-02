import { parse, parseFragment, serialize, serializeOuter } from 'parse5';
import { chance, seedFor, label, walk } from './util.mjs';
import { planFieldLocations } from './field-locations.mjs';
import { NON_SEMANTIC_TRAP_TYPES, isCrawlerTrap, trapDetails, trapEligible, trapHeadMarkup, trapMainMarkup, trapMutateHead, trapPostProcess, trapRawMarkup } from './crawler-traps.mjs';

const DATA_TYPES = new Set(['missing-field', 'label-variation', 'date-format', 'delayed-content']);
const NON_SEMANTIC_TYPES = new Set(['missing-field', 'malformed-nesting', 'boilerplate', 'delayed-content', 'missing-metadata', 'hidden-boilerplate', 'duplicate-heading', 'broken-image', 'conflicting-metadata', 'missing-main', 'legacy-document', 'image-missing-alt', 'frame-missing-title', 'shortcode-residue', 'hidden-reader-copy', 'analytics-beacon', 'spacer-elements', ...NON_SEMANTIC_TRAP_TYPES]);
const scalarFields = page => Object.keys(page.fields).filter(key => key !== 'title' && key !== page.image?.field);
const hasAdditionalFields = page => scalarFields(page).length > 0;
const hasRenderedFieldList = (page, site) => (page.kind !== 'listing' || !site.shell)
  && Object.entries(page.fields).some(([key, value]) => key !== 'title' && key !== page.image?.field && value !== undefined && value !== null);
const isLocalPageTarget = value => typeof value === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(value);

// 2026-11-02 real-world display variants. Each pool entry is a format or label seen on real
// sites; the choice is seeded by (site seed, page ID) so generation is repeatable and the
// answer-key validator re-derives the same displayed value. The plain ISO form is not in the
// date pool because it is the canonical rendering and would make the defect a no-op.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = value => String(value).padStart(2, '0');
export const DATE_FORMAT_POOL = [
  { id: 'us-long', format: (y, m, d) => `${MONTHS[m - 1]} ${d}, ${y}` },
  { id: 'us-numeric', format: (y, m, d) => `${pad(m)}/${pad(d)}/${y}` },
  { id: 'day-month-year', format: (y, m, d) => `${d} ${MONTHS[m - 1]} ${y}` },
  { id: 'abbreviated-month', format: (y, m, d) => `${MONTH_ABBR[m - 1]} ${d}, ${y}` },
  { id: 'dotted-european', format: (y, m, d) => `${d}.${m}.${y}` },
  { id: 'weekday-long', format: (y, m, d) => `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}` },
  { id: 'month-year', format: (y, m) => `${MONTHS[m - 1]} ${y}` },
  { id: 'iso-datetime', format: (y, m, d) => `${y}-${pad(m)}-${pad(d)}T00:00:00Z` },
];
export function dateFormatVariant(iso, seed, pageId) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const entry = DATE_FORMAT_POOL[seedFor(seed, pageId, 'date-format', 'variant') % DATE_FORMAT_POOL.length];
  return entry.format(Number(match[1]), Number(match[2]), Number(match[3]));
}
export const FIELD_LABEL_POOLS = [
  { match: /^(author|creator|writer)$/i, labels: ['Author:', 'By', 'Written by', 'Author(s)'] },
  { match: /^(publicationDate|recordDate)$/, labels: ['Published', 'Pub. date', 'Date issued', 'Released'] },
  { match: /^releaseDate$/, labels: ['Released', 'Release date:', 'Published', 'Date released'] },
  { match: /^isbn$/i, labels: ['ISBN-13', 'ISBN', 'International Standard Book Number'] },
  { match: /^startDate$/, labels: ['Starts', 'Start date:', 'When', 'Date'] },
  { match: /^endDate$/, labels: ['Ends', 'End date:', 'Until', 'Closes'] },
  { match: /^meetingDate$/, labels: ['Meeting date:', 'Date of meeting', 'When', 'Held on'] },
  { match: /^deadline$/, labels: ['Closing date', 'Apply by', 'Deadline:', 'Due date'] },
  { match: /^effectiveDate$/, labels: ['Effective', 'Effective from', 'In effect from', 'Date effective'] },
  { match: /^(location|serviceArea)$/, labels: ['Venue', 'Where', 'Location:', 'Area served'] },
  { match: /^address$/, labels: ['Address:', 'Find us', 'Street address', 'Visit us'] },
  { match: /^openingHours$/, labels: ['Hours', 'Opening times', 'Hours of operation', 'Open'] },
  { match: /^(summary|abstract|overview|description)$/, labels: ['Summary:', 'Overview', 'Abstract', 'About'] },
];
const humanizeKey = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
// The paragraphs layout already prints "Label:", so a pool label with its own colon drops it there.
// Labels identical to the default rendering are skipped so the defect is always observable.
export function fieldLabelCandidates(key, fieldLayout) {
  const pool = FIELD_LABEL_POOLS.find(entry => entry.match.test(key))?.labels
    ?? [`${label(key)} details`, `${label(key)}:`, `${label(key)} information`];
  const defaults = new Set([label(key), humanizeKey(key)]);
  const shaped = pool.map(value => fieldLayout === 'paragraphs' ? value.replace(/:$/, '') : value);
  return [...new Set(shaped)].filter(value => !defaults.has(value));
}
export function fieldLabelVariant(key, fieldLayout, seed, pageId) {
  const candidates = fieldLabelCandidates(key, fieldLayout);
  return candidates[seedFor(seed, pageId, 'label-variation', key) % candidates.length];
}

function eligible(page, type, site) {
  if (isCrawlerTrap(type)) return trapEligible(type, page, site);
  if (type === 'delayed-content') return site.framework !== 'html';
  if (type === 'missing-main') return site.framework === 'html';
  if (type === 'date-format') return Object.values(page.fields).some(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (type === 'label-variation') return hasAdditionalFields(page);
  if (['reorder-fields', 'duplicate-id'].includes(type)) return scalarFields(page).length >= 2;
  if (type === 'missing-field') return Object.keys(page.fields).some(key => key !== 'title');
  if (['nested-layout-table', 'obsolete-markup', 'deep-wrapper-tree'].includes(type)) return hasRenderedFieldList(page, site);
  if (type === 'link-variants') return isLocalPageTarget(page.url);
  if (type === 'broken-image') return Boolean(page.image?.src);
  if (type === 'image-missing-alt') return Boolean(page.image?.src);
  if (type === 'onclick-navigation') return page.links.some(link => isLocalPageTarget(link.href)) || page.url !== '/';
  if (type === 'javascript-only-link') return page.url !== '/' || page.links.some(link => isLocalPageTarget(link.href));
  // 2026-11-02 operators that rewrite the field list itself need one in the server-rendered HTML.
  if (['split-text-runs', 'entity-encoded-text', 'microdata-attributes', 'inline-svg-icons'].includes(type)) return hasRenderedFieldList(page, site);
  if (type === 'uppercase-legacy-tags') return site.framework === 'html' && hasRenderedFieldList(page, site);
  return true;
}

export function applyDataNoise(canonical, site) {
  const page = structuredClone(canonical);
  const settings = site.noise;
  const selected = settings.types.map(type => ({ type, rank: chance(site.seed, page.pageId, 'noise', type) }))
    .filter(({ type, rank }) => rank < (settings.overrides[type] ?? settings.probability) && eligible(page, type, site))
    .sort((a,b) => a.rank - b.rank || a.type.localeCompare(b.type)).slice(0, settings.maxPerPage);
  for (const { type } of selected) {
    if (!eligible(page,type,site)) continue;
    const event = { type, severity: settings.severity, preservesSemantics: !NON_SEMANTIC_TYPES.has(type) };
    // Trap facts are fixed here, before rendering, so the private answer key states exactly what the HTML/server expose.
    if (isCrawlerTrap(type)) event.details = trapDetails(type, page, site, settings.severity);
    const keys = Object.keys(page.fields).filter(k => k !== 'title' && (type !== 'label-variation' || k !== page.image?.field));
    const key = keys[seedFor(site.seed, page.pageId, type, 'field') % keys.length];
    if (type === 'missing-field') {
      event.field = key;
      delete page.fields[key];
      page.fieldStates[key] = 'absent';
      if (page.image?.field === key) page.image = null;
    }
    if (type === 'label-variation' && key && key in page.fields) { event.field = key; page.fieldLabels ??= {}; page.fieldLabels[key] = fieldLabelVariant(key, page.fieldLayout, site.seed, page.pageId); }
    if (type === 'date-format') {
      const field = Object.keys(page.fields).find(k => /^\d{4}-\d{2}-\d{2}$/.test(page.fields[k]));
      if (!field) continue;
      page.fields[field] = dateFormatVariant(page.fields[field], site.seed, page.pageId);
      event.field = field;
    }
    if (type === 'delayed-content') page.delayMs = settings.severity * 200;
    if (type === 'broken-image') {
      const resource = seedFor(site.seed, page.pageId, 'broken-image') % 100000;
      page.image.src = `/assets/missing-${resource}.png`;
      if (page.image.field) {
        event.field = page.image.field;
        page.fields[event.field] = page.image.src;
      }
      if (settings.severity >= 2) page.image.srcset = `/assets/missing-${resource}-1x.png 1x, /assets/missing-${resource}-2x.png 2x`;
    }
    page.noiseEvents.push(event);
  }
  page.noiseEvents = page.noiseEvents.filter(event => {
    if (['label-variation','date-format'].includes(event.type)) return event.field in page.fields;
    if (!DATA_TYPES.has(event.type)) return eligible(page,event.type,site);
    return true;
  });
  page.fieldLocations = planFieldLocations(page);
  return page;
}

function setAttr(node, name, value) {
  const existing = node.attrs.find(a => a.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}
function append(parent, html) {
  const nodes = parseFragment(html).childNodes;
  for (const child of nodes) child.parentNode = parent;
  parent.childNodes.push(...nodes);
}

function attr(node, name) {
  return node.attrs?.find(attribute => attribute.name === name)?.value;
}

function documentBaseUrl(doc, page, site) {
  const documentUrl = new URL(page.url, site.baseUrl);
  for (const base of walk(doc, node => node.tagName === 'base')) {
    const href = attr(base, 'href');
    if (href === undefined) continue;
    try {
      const resolved = new URL(href, documentUrl);
      return ['data:', 'javascript:'].includes(resolved.protocol) ? documentUrl : resolved;
    } catch { return documentUrl; }
  }
  return documentUrl;
}

function localLinkDestination(href, baseUrl, site) {
  if (typeof href !== 'string') return null;
  try {
    const origin = new URL(site.baseUrl);
    const target = new URL(href, baseUrl);
    if (!['http:', 'https:'].includes(target.protocol) || target.origin !== origin.origin || target.username || target.password) return null;
    const destination = `${target.pathname}${target.search}${target.hash}`;
    if (target.pathname.startsWith('//') || new URL(destination, origin).origin !== origin.origin) return null;
    return destination;
  } catch {
    return null;
  }
}

function hasClass(node, name) {
  return attr(node, 'class')?.split(/\s+/).includes(name);
}

function addClass(node, name) {
  setAttr(node, 'class', [attr(node, 'class'), name].filter(Boolean).join(' '));
}

function wrap(target, wrapper, container = wrapper) {
  const parent = target.parentNode;
  const index = parent.childNodes.indexOf(target);
  wrapper.parentNode = parent;
  parent.childNodes[index] = wrapper;
  target.parentNode = container;
  container.childNodes.push(target);
}

function fieldList(main) {
  return walk(main, node => hasClass(node, 'field-list'))[0];
}

function heading(main) {
  return walk(main, node => node.tagName === 'h1')[0];
}

const HEAD_HELPERS = {
  prepend(documentHead, html) {
    const nodes = parseFragment(html).childNodes;
    for (const node of nodes) node.parentNode = documentHead;
    documentHead.childNodes.unshift(...nodes);
  },
  setCanonical(documentHead, href) {
    const canonical = walk(documentHead, node => node.tagName === 'link' && attr(node, 'rel')?.split(/\s+/).includes('canonical'))[0];
    if (canonical) setAttr(canonical, 'href', href);
    else append(documentHead, `<link rel="canonical" href="${href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`);
  },
  removeCharset(documentHead) {
    for (const meta of walk(documentHead, node => node.tagName === 'meta' && (attr(node, 'charset') !== undefined || attr(node, 'http-equiv')?.toLowerCase() === 'content-type'))) meta.parentNode.childNodes = meta.parentNode.childNodes.filter(node => node !== meta);
  },
};

// The page's own image lives in <aside class="visual">; thumbnails in listings and cards are secondary.
function primaryImage(main) {
  const visual = walk(main, node => node.tagName === 'aside' && (node.attrs ?? []).some(a => a.name === 'class' && a.value.split(/\s+/).includes('visual')))[0];
  return (visual && walk(visual, node => node.tagName === 'img')[0]) ?? walk(main, node => node.tagName === 'img')[0];
}

function head(doc) {
  return walk(doc, node => node.tagName === 'head')[0];
}

export function applyHtmlNoise(html, page, site) {
  const events = page.noiseEvents.filter(e => !DATA_TYPES.has(e.type));
  if (!events.length) return html;
  const doc = parse(html);
  const main = walk(doc, n => n.tagName === 'main')[0];
  if (!main) throw new Error('Renderer must provide a main element');
  // Older callers may pass trap events without details; derive them exactly as applyDataNoise would.
  const trapEvent = event => event.details ? event : { ...event, details: trapDetails(event.type, page, site, event.severity) };
  const rawMarkup = [];
  for (const event of events) {
    if (event.type === 'extra-wrapper') {
      const target = walk(main, n => n.attrs?.some(a => a.name === 'class' && a.value.split(/\s+/).includes('field-list')))[0] ?? main.childNodes.find(n => n.tagName);
      if (!target) continue;
      const parent = target.parentNode;
      const wrapper = parseFragment('<div></div>').childNodes[0];
      setAttr(wrapper, 'class', `layout-${seedFor(site.seed, page.pageId, 'wrapper') % 1000}`);
      wrapper.parentNode = parent;
      parent.childNodes[parent.childNodes.indexOf(target)] = wrapper;
      let inner = wrapper;
      for (let i = 1; i < event.severity; i++) { const next = parseFragment('<div></div>').childNodes[0]; next.parentNode = inner; inner.childNodes.push(next); inner = next; }
      inner.childNodes.push(target); target.parentNode = inner;
    }
    if (event.type === 'class-churn') {
      for (const [i,node] of walk(main, n => !!n.tagName).entries()) {
        const old = node.attrs.find(a => a.name === 'class')?.value ?? '';
        setAttr(node, 'class', `${old} theme-${seedFor(site.seed, page.pageId, i) % 100003}`.trim());
      }
    }
    if (event.type === 'inline-style') setAttr(main, 'style', `border-top: ${event.severity}px solid ${seedFor(site.seed,page.pageId) % 2 ? '#b6484c' : '#287268'}`);
    if (event.type === 'duplicate-id') {
      const container = walk(main, n => n.attrs?.some(a => a.name === 'class' && a.value.split(/\s+/).includes('field-list')))[0] ?? main;
      const nodes = walk(container, n => ['dd','td','p'].includes(n.tagName));
      for (const node of nodes.slice(0, 2)) setAttr(node, 'id', 'content-value');
    }
    if (event.type === 'reorder-fields') {
      for (const dl of walk(main, n => n.tagName === 'dl')) {
        const elements = dl.childNodes.filter(n => n.tagName);
        const pairs = [];
        for (let i = 0; i < elements.length; i += 2) pairs.push(elements.slice(i, i + 2));
        if (pairs.every(p => p.length === 2 && p[0].tagName === 'dt' && p[1].tagName === 'dd')) dl.childNodes = pairs.reverse().flat();
      }
      for (const container of walk(main, n => n.attrs?.some(a => a.name === 'class' && a.value.split(/\s+/).includes('field-list')))) {
        if (container.tagName === 'table') {
          for (const body of walk(container, n => n.tagName === 'tbody')) body.childNodes.reverse();
        } else if (container.tagName === 'section') container.childNodes.reverse();
      }
    }
    if (event.type === 'boilerplate') {
      append(main, '<aside class="notice"><h2>Service update</h2><p>Some facilities have seasonal hours. Consult the service directory before your visit.</p><a href="/">View current services</a></aside>');
      if (event.severity >= 2) append(main, '<aside class="archive-notice"><table class="legacy-notice-table" border="1" cellpadding="8" width="100%"><tbody><tr><td><font size="2"><b>Web archive notice</b><br>Some notices refer to older editions. Contact the records office for current information.</font></td><td><a href="/">Main index</a></td></tr></tbody></table></aside>');
      if (event.severity >= 3) append(main, '<nav aria-label="Archive shortcuts"><p><a href="/">Home</a> | <a href="/#content">Return to directory</a> | <a href="/">Site index</a></p><small>Archive edition 2004. This notice is repeated across the collection.</small></nav>');
    }
    if (event.type === 'shortcode-residue') {
      // Unrendered shortcodes left behind when a page builder or plugin was switched off (a common migration source).
      const sets = {
        wpbakery: ['[vc_row full_width="stretch_row"][vc_column][vc_column_text css=".vc_custom_1611234567890{margin-bottom: 0px !important;}"]', '[vc_separator color="grey"][vc_empty_space height="32px"]', '[/vc_column_text][/vc_column][/vc_row]'],
        divi: ['[et_pb_section fb_built="1" _builder_version="4.27.4" global_colors_info="{}"][et_pb_row _builder_version="4.27.4"][et_pb_column type="4_4" _builder_version="4.27.4"]', '[et_pb_divider _builder_version="4.27.4" global_colors_info="{}"][/et_pb_divider]', '[/et_pb_column][/et_pb_row][/et_pb_section]'],
        other: ['[caption id="attachment_412" align="alignnone" width="300"]', '[contact-form-7 id="1f3a2b9" title="Contact form 1"]', '[/caption]'],
      };
      const [open, middle, close] = (site.cmsProfile === 'wordpress' && sets[site.builderProfile]) || sets.other;
      const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      append(main, `<div class="legacy-content"><p>${esc(open)}</p>${event.severity >= 2 ? `<p>${esc(middle)}</p>` : ''}<p>${esc(close)}</p></div>`);
    }
    if (event.type === 'missing-metadata') {
      for (const meta of walk(doc, n => n.tagName === 'meta' && n.attrs.some(a => a.name === 'name' && a.value === 'description'))) meta.parentNode.childNodes = meta.parentNode.childNodes.filter(n => n !== meta);
    }
    if (event.type === 'comment-clutter') {
      for (let i = 0; i < event.severity * 2; i++) append(main, `<!-- archive layout marker ${seedFor(site.seed, page.pageId, 'comment-clutter', i) % 10000} -->`);
    }
    if (event.type === 'hidden-boilerplate') {
      append(main, '<section class="supplemental-archive" hidden aria-hidden="true"><h2>Archived service information</h2><p>This catalog interface is retained for compatibility with older finding aids.</p></section>');
      if (event.severity >= 2) append(main, '<nav class="supplemental-archive" hidden aria-hidden="true"><a href="/">Archive index</a><a href="/#content">Catalog content</a></nav>');
      if (event.severity >= 3) append(main, '<div class="supplemental-archive" hidden aria-hidden="true"><table><tbody><tr><td>Legacy directory notice</td></tr></tbody></table></div>');
    }
    if (event.type === 'duplicate-heading') {
      const original = heading(main);
      if (!original) continue;
      for (let i = 0; i < event.severity; i++) {
        const copy = parseFragment(serializeOuter(original)).childNodes[0];
        addClass(copy, 'record-title-copy');
        setAttr(copy, 'data-copy', String(i + 1));
        copy.parentNode = main;
        main.childNodes.push(copy);
      }
    }
    if (event.type === 'nested-layout-table') {
      const target = fieldList(main);
      if (!target) continue;
      let outer;
      let slot;
      for (let i = 0; i < event.severity; i++) {
        const table = parseFragment(`<table class="layout-table layout-table-${i + 1}" role="presentation"><tbody><tr><td></td></tr></tbody></table>`).childNodes[0];
        const cell = walk(table, node => node.tagName === 'td')[0];
        if (!outer) { outer = table; slot = cell; }
        else { table.parentNode = slot; slot.childNodes.push(table); slot = cell; }
      }
      wrap(target, outer, slot);
    }
    if (event.type === 'link-variants') {
      const suffixes = ['#content', '?view=compact', '?view=compact#content'].slice(0, event.severity);
      const nav = parseFragment('<nav class="record-views" aria-label="Alternate record links"><ul></ul></nav>').childNodes[0];
      const list = walk(nav, node => node.tagName === 'ul')[0];
      for (const [i, suffix] of suffixes.entries()) append(list, `<li><a href="${page.url}${suffix}">Record view ${i + 1}</a></li>`);
      nav.parentNode = main;
      main.childNodes.push(nav);
    }
    if (event.type === 'broken-image') {
      const image = primaryImage(main);
      if (!image) continue;
      const key = seedFor(site.seed, page.pageId, 'broken-image') % 100000;
      setAttr(image, 'src', `/assets/missing-${key}.png`);
      if (event.severity >= 2) setAttr(image, 'srcset', `/assets/missing-${key}-1x.png 1x, /assets/missing-${key}-2x.png 2x`);
      if (event.severity >= 3) setAttr(image, 'data-resource-state', 'unavailable');
    }
    if (event.type === 'conflicting-metadata') {
      const documentHead = head(doc);
      if (!documentHead) continue;
      append(documentHead, '<meta name="description" content="Archived directory entry; details may be incomplete.">');
      append(documentHead, '<meta name="title" content="Untitled legacy catalog record">');
      if (event.severity >= 2) append(documentHead, '<meta property="og:title" content="Unverified archive item">');
      if (event.severity >= 3) append(documentHead, '<meta itemprop="name" content="Uncataloged record">');
    }
    if (event.type === 'obsolete-markup') {
      const target = fieldList(main);
      if (!target) continue;
      const obsolete = parseFragment('<center class="obsolete-layout"><font face="serif"></font></center>').childNodes[0];
      let slot = walk(obsolete, node => node.tagName === 'font')[0];
      if (event.severity >= 2) {
        const big = parseFragment('<big></big>').childNodes[0];
        big.parentNode = slot;
        slot.childNodes.push(big);
        slot = big;
      }
      if (event.severity >= 3) {
        const teletype = parseFragment('<tt></tt>').childNodes[0];
        teletype.parentNode = slot;
        slot.childNodes.push(teletype);
        slot = teletype;
      }
      wrap(target, obsolete, slot);
    }
    if (event.type === 'legacy-document') {
      const root = walk(doc, node => node.tagName === 'html')[0];
      if (root) root.attrs = root.attrs.filter(attribute => attribute.name !== 'lang');
    }
    if (event.type === 'image-missing-alt') {
      const image = primaryImage(main);
      if (image) image.attrs = image.attrs.filter(attribute => attribute.name !== 'alt');
    }
    if (event.type === 'onclick-navigation') {
      const destination = page.links.find(link => isLocalPageTarget(link.href))?.href ?? (page.url === '/' ? undefined : '/');
      if (destination) append(main, `<button class="archive-action" type="button" onclick="window.location.href='${destination}'">Open related page</button>`);
    }
    if (event.type === 'javascript-only-link') {
      const baseUrl = documentBaseUrl(doc, page, site);
      const anchor = walk(main, node => node.tagName === 'a' && localLinkDestination(attr(node, 'href'), baseUrl, site) !== null)[0];
      if (anchor) {
        const destination = localLinkDestination(attr(anchor, 'href'), baseUrl, site);
        const serialized = `'${JSON.stringify(destination).slice(1, -1).replaceAll("'", '\\u0027')}'`;
        setAttr(anchor, 'href', 'javascript:void(0)');
        setAttr(anchor, 'onclick', `window.location.href=${serialized}`);
      }
    }
    if (event.type === 'deep-wrapper-tree') {
      const target = fieldList(main);
      if (!target) continue;
      let inner = target;
      for (let depth = 0; depth < 4 + event.severity * 4; depth++) {
        const wrapper = parseFragment('<div class="legacy-wrapper"></div>').childNodes[0];
        if (depth === 0) wrap(target, wrapper);
        else wrap(inner, wrapper);
        inner = wrapper;
      }
    }
    if (event.type === 'frame-missing-title') {
      append(main, '<iframe class="legacy-frame" srcdoc="&lt;p&gt;Archive reference panel&lt;/p&gt;" width="320" height="120" loading="lazy"></iframe>');
    }
    if (isCrawlerTrap(event.type)) {
      const trap = trapEvent(event);
      const markup = trapMainMarkup(trap, page, site);
      if (markup) append(main, markup);
      const raw = trapRawMarkup(trap);
      if (raw) { append(main, `<!--sf-raw-${rawMarkup.length}-->`); rawMarkup.push(raw); }
      const documentHead = head(doc);
      if (documentHead) {
        const headMarkup = trapHeadMarkup(trap, site, page);
        if (headMarkup) append(documentHead, headMarkup);
        trapMutateHead(trap, documentHead, site, HEAD_HELPERS);
      }
    }
    // ---- 2026-11-02: eight more markup operators. None changes a field's text as a browser reads it.
    if (event.type === 'split-text-runs') {
      // Word processors and old WYSIWYG editors split text into many inline runs: <span>Rog</span><span>ers</span>.
      const target = fieldList(main);
      if (!target) continue;
      const texts = walk(target, node => node.nodeName === '#text' && node.value.trim().length >= 4 && node.parentNode?.tagName !== 'script');
      for (const [index, textNode] of texts.entries()) {
        if (index % (4 - event.severity) !== 0) continue;
        const cut = 1 + seedFor(site.seed, page.pageId, 'split', index) % (textNode.value.length - 1);
        const parts = event.severity >= 3 ? [textNode.value.slice(0, cut), textNode.value.slice(cut, cut + Math.ceil((textNode.value.length - cut) / 2)), textNode.value.slice(cut + Math.ceil((textNode.value.length - cut) / 2))].filter(Boolean) : [textNode.value.slice(0, cut), textNode.value.slice(cut)];
        const spans = parts.map((part, i) => { const span = parseFragment(`<span class="${i % 2 ? 'Apple-converted-space' : 'mso-run'}"></span>`).childNodes[0]; span.childNodes = [{ nodeName: '#text', value: part, parentNode: span }]; span.parentNode = textNode.parentNode; return span; });
        const siblings = textNode.parentNode.childNodes;
        siblings.splice(siblings.indexOf(textNode), 1, ...spans);
      }
    }
    if (event.type === 'entity-encoded-text') {
      // Legacy encoders write characters as numeric references (&#39; &#45; &#x65;); the decoded text is unchanged.
      const target = fieldList(main);
      if (!target) continue;
      for (const textNode of walk(target, node => node.nodeName === '#text' && node.value.trim() && node.parentNode?.tagName !== 'script')) {
        const encoded = [...textNode.value].map((char, i) => {
          if (char === '&') return '&amp;'; if (char === '<') return '&lt;'; if (char === '>') return '&gt;';
          if (/[.,:;'\-()/]/.test(char)) return `&#${char.codePointAt(0)};`;
          if (event.severity >= 2 && /[0-9]/.test(char)) return `&#${char.codePointAt(0)};`;
          if (event.severity >= 3 && /[A-Za-z]/.test(char) && i % 3 === 0) return `&#x${char.codePointAt(0).toString(16)};`;
          if (char === ' ') return '&nbsp;';
          return char;
        }).join('');
        const marker = { nodeName: '#comment', data: `sf-raw-${rawMarkup.length}`, parentNode: textNode.parentNode };
        rawMarkup.push(encoded);
        const siblings = textNode.parentNode.childNodes;
        siblings[siblings.indexOf(textNode)] = marker;
      }
    }
    if (event.type === 'microdata-attributes') {
      // schema.org microdata sprinkled over the record (itemscope, itemprop), as SEO plugins add it.
      const target = fieldList(main);
      if (!target) continue;
      setAttr(target, 'itemscope', '');
      setAttr(target, 'itemtype', `https://schema.org/${event.severity >= 2 ? 'CreativeWork' : 'Thing'}`);
      for (const [index, node] of walk(target, n => ['dd', 'td'].includes(n.tagName)).entries()) setAttr(node, 'itemprop', ['name', 'author', 'datePublished', 'description', 'identifier', 'about'][index % 6]);
      if (event.severity >= 3) append(target.parentNode, '<meta itemprop="inLanguage" content="en">');
    }
    if (event.type === 'inline-svg-icons') {
      // Icon fonts and inline SVG icons inside labels; they add markup but no text.
      const target = fieldList(main);
      if (!target) continue;
      const labels = walk(target, n => ['dt', 'th', 'strong'].includes(n.tagName));
      // Paragraph field lists ("Label: value") get the icon at the start of each paragraph.
      for (const label of labels.length ? labels : walk(target, n => n.tagName === 'p')) {
        const icon = parseFragment(`<svg class="field-icon" aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="${3 + event.severity}"></circle></svg>`).childNodes[0];
        icon.parentNode = label;
        label.childNodes.unshift(icon);
      }
    }
    if (event.type === 'hidden-reader-copy') {
      // Visually hidden text for screen readers: a second copy of the title and "opens in new window" hints.
      const title = heading(main);
      const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      append(main, `<p class="visually-hidden sr-only">You are viewing: ${esc(title ? walk(title, n => n.nodeName === '#text').map(n => n.value).join('') : page.title)}</p>`);
      if (event.severity >= 2) append(main, '<span class="screen-reader-text">(opens in a new window)</span>');
      if (event.severity >= 3) append(main, '<div class="sr-only" role="status" aria-live="polite">Page loaded. 0 items in your list.</div>');
    }
    if (event.type === 'analytics-beacon') {
      // Analytics beacons: 1x1 images, hidden from view, at the end of the content.
      const id = seedFor(site.seed, page.pageId, 'pixel') % 1000000;
      append(main, `<img class="tracking-pixel" src="/assets/collection.png?beacon=${id}" width="1" height="1" alt="" style="position:absolute;left:-9999px">`);
      if (event.severity >= 2) append(main, `<img class="tracking-pixel" src="/assets/collection.png?ev=pageview&amp;id=${id}" width="1" height="1" alt="" hidden>`);
    }
    if (event.type === 'spacer-elements') {
      // Layout spacers from old editors: empty paragraphs, &nbsp; lines, stacked <br> and clearing divs.
      append(main, `<p>&nbsp;</p><p></p>${event.severity >= 2 ? '<br><br><div class="clear" style="clear:both"></div>' : ''}${event.severity >= 3 ? '<table class="spacer" width="100%" height="10"><tbody><tr><td>&nbsp;</td></tr></tbody></table>' : ''}`);
    }
    if (event.type === 'legacy-color-attribute') {
      const body = walk(doc, node => node.tagName === 'body')[0];
      if (body) {
        setAttr(body, 'bgcolor', '#ffffff');
        setAttr(body, 'text', '#222222');
        if (event.severity >= 2) setAttr(body, 'link', '#003399');
        if (event.severity >= 3) setAttr(body, 'vlink', '#663399');
      }
    }
  }
  let result = serialize(doc);
  if (events.some(event => event.type === 'legacy-document')) result = result.replace(/^<!DOCTYPE html>/i, '');
  // Inject after serialization so parser recovery itself remains part of the fixture.
  if (events.some(e => e.type === 'malformed-nesting')) result = result.replace('</main>', '<p class="archive-note"><div>Record last reviewed.</p></div></main>');
  const upper = events.find(event => event.type === 'uppercase-legacy-tags');
  if (upper) {
    // Hand-written 1990s HTML: upper-case tags, unquoted and upper-case attribute names (the parser sees the same page).
    const start = result.indexOf('<main'), end = result.indexOf('</main>');
    if (start >= 0 && end > start) {
      let inner = result.slice(start, end).replace(/<(\/?)(div|p|dl|dt|dd|table|tbody|tr|td|th|span|strong|ul|li)(?=[\s>])/g, (_, slash, tag) => `<${slash}${tag.toUpperCase()}`);
      if (upper.severity >= 2) inner = inner.replace(/ (class|id)="([A-Za-z0-9_-]+)"/g, (_, name, value) => ` ${name}=${value}`);
      if (upper.severity >= 3) inner = inner.replace(/ (class|id|width|height)=/g, (_, name) => ` ${name.toUpperCase()}=`);
      result = result.slice(0, start) + inner + result.slice(end);
    }
  }
  if (events.some(event => event.type === 'missing-main')) result = result.replace(/<main\b/, '<div').replace('</main>', '</div>');
  // Raw trap markup (entity-encoded hrefs) must bypass parse5, which would normalise it.
  rawMarkup.forEach((raw, index) => { result = result.replace(`<!--sf-raw-${index}-->`, raw); });
  for (const event of events) if (isCrawlerTrap(event.type)) result = trapPostProcess(trapEvent(event), result);
  return result;
}
