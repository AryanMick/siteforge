import { parse } from 'parse5';
import { attr } from './util.mjs';

const LIMITS = Object.freeze({
  html: 2_000_000,
  nodes: 50_000,
  text: 200_000,
  links: 2_000,
  fields: 100,
  label: 80,
  value: 1_000,
  terms: 300,
  tags: 100,
});
const PRUNED = new Set(['nav', 'footer', 'script', 'style', 'template', 'noscript']);
const LEGACY_TAGS = new Set(['font', 'center', 'marquee', 'frameset', 'frame']);
const LEGACY_COLOR_ATTRIBUTES = new Set(['bgcolor', 'color', 'text', 'link', 'vlink', 'alink']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with',
]);

function cleanText(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function isPruned(node) {
  if (PRUNED.has(node?.tagName)) return true;
  if (node?.tagName !== 'header') return false;
  for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (ancestor.tagName === 'main' || ancestor.tagName === 'article') return false;
    if (ancestor.tagName === 'body') return true;
  }
  return true;
}

function nodeText(root, limit = LIMITS.value, includePrunedRoot = false) {
  let result = '';
  const stack = [{ node: root, isRoot: true }];
  while (stack.length && result.length < limit) {
    const { node, isRoot } = stack.pop();
    if (isPruned(node) && !(isRoot && includePrunedRoot)) continue;
    if (node?.nodeName === '#text') result += ` ${node.value}`;
    const children = node?.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], isRoot: false });
  }
  return cleanText(result, limit);
}

function scan(root, { prune = false, maxNodes = LIMITS.nodes } = {}) {
  const result = [];
  const stack = [{ node: root, depth: 0 }];
  while (stack.length && result.length < maxNodes) {
    const current = stack.pop();
    result.push(current);
    if (prune && isPruned(current.node)) continue;
    const children = current.node?.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  return { entries: result, truncated: stack.length > 0 };
}

function firstTag(entries, tagName) {
  return entries.find(({ node }) => node.tagName === tagName)?.node;
}

export function normalizeFieldLabel(value) {
  const words = cleanText(value, LIMITS.label)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  if (!words.length) return '';
  const key = words[0] + words.slice(1).map(word => word[0].toUpperCase() + word.slice(1)).join('');
  return UNSAFE_KEYS.has(key) ? '' : key.slice(0, LIMITS.label);
}

function issueCollector() {
  const issues = new Map();
  return {
    add(code, severity, evidence) {
      const existing = issues.get(code);
      if (existing) {
        existing.count++;
        if (evidence && !existing.evidence) existing.evidence = cleanText(evidence, 160);
      } else {
        const issue = { code, count: 1, severity };
        if (evidence) issue.evidence = cleanText(evidence, 160);
        issues.set(code, issue);
      }
    },
    values() { return [...issues.values()].sort((a, b) => a.code.localeCompare(b.code)); },
  };
}

function publicLink(href, baseUrl) {
  const value = cleanText(href, 2_048);
  if (!value || value.startsWith('#') || /^(?:javascript|data|mailto|tel):/i.test(value)) return null;
  try {
    const resolved = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    resolved.hash = '';
    return resolved.href;
  } catch {
    return /^\/?[^\s]+$/.test(value) ? value : null;
  }
}

function addField(fields, labels, rawLabel, rawValue) {
  if (labels.length >= LIMITS.fields) return false;
  const key = normalizeFieldLabel(rawLabel);
  const value = cleanText(rawValue, LIMITS.value);
  if (!key || !value || Object.hasOwn(fields, key)) return false;
  fields[key] = value;
  labels.push(key);
  return true;
}

function elementChildren(node) {
  return (node?.childNodes ?? []).filter(child => child.tagName);
}

function containsElement(node, predicate, maxNodes = 500) {
  return scan(node, { prune: true, maxNodes }).entries
    .some(entry => entry.node !== node && predicate(entry.node));
}

function tableRowLooksLikeField(node, cells) {
  if (cells.length !== 2 || cells.some(cell => Number(attr(cell, 'colspan') ?? 1) > 1)) return false;
  let table = node.parentNode;
  while (table && table.tagName !== 'table') table = table.parentNode;
  if (!table || /^(?:presentation|none)$/i.test(attr(table, 'role') ?? '')) return false;
  if (cells.some(cell => containsElement(cell, child => child.tagName === 'table'))) return false;
  if (cells.some(cell => containsElement(cell, child => child.tagName === 'nav'))) return false;

  const label = nodeText(cells[0]);
  const labelWords = label.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!label || label.length > LIMITS.label || labelWords.length > 8) return false;
  if (containsElement(cells[0], child =>
    ['a', 'img', 'form', 'p', 'div', 'ul', 'ol', 'menu', 'blockquote'].includes(child.tagName))) return false;
  return cells[0].tagName === 'th' || !/[.!?](?:\s|$)/.test(label);
}

function isWrappedFieldLabel(node) {
  if (!['strong', 'b'].includes(node?.tagName)) return false;
  return /:\s*$/.test(nodeText(node));
}

function labelValueSiblings(node) {
  let cursor = node;
  while (['font', 'span'].includes(cursor.parentNode?.tagName)) {
    const parent = cursor.parentNode;
    const otherContent = (parent.childNodes ?? []).some(child =>
      child !== cursor && (child.tagName || cleanText(child.value, 1)));
    if (otherContent) break;
    cursor = parent;
  }
  const siblings = cursor.parentNode?.childNodes ?? [];
  return siblings.slice(siblings.indexOf(cursor) + 1);
}

function extractFields(scope, fields, labels) {
  const { entries } = scan(scope, { prune: true });
  for (const { node } of entries) {
    if (labels.length >= LIMITS.fields) break;
    if (node.tagName === 'dt') {
      const siblings = elementChildren(node.parentNode);
      const value = siblings[siblings.indexOf(node) + 1];
      if (value?.tagName === 'dd') addField(fields, labels, nodeText(node), nodeText(value));
    }
    if (node.tagName === 'tr') {
      const cells = elementChildren(node).filter(child => child.tagName === 'th' || child.tagName === 'td');
      if (tableRowLooksLikeField(node, cells)) {
        addField(fields, labels, nodeText(cells[0]), nodeText(cells[1]));
      }
    }
    if (node.tagName === 'strong' || node.tagName === 'b') {
      const label = nodeText(node);
      const following = labelValueSiblings(node);
      const nextElement = following.find(child => child.tagName);
      // A colon distinguishes a plain-text label from ordinary emphasized prose.
      if (/:\s*$/.test(label) || (nextElement?.tagName === 'span' && following[0] === nextElement)) {
        const valueNodes = [];
        for (const child of following) {
          if (['strong', 'b', 'br', 'p', 'div', 'dl', 'table', 'tr', 'section', 'article', 'li'].includes(child.tagName)
            || containsElement(child, isWrappedFieldLabel, 100)) break;
          valueNodes.push(child);
        }
        addField(fields, labels, label.replace(/:\s*$/, ''), valueNodes.map(child => nodeText(child)).join(' '));
      }
    }
  }
}

function microdataValue(node) {
  for (const name of ['content', 'datetime', 'href', 'src']) {
    const value = attr(node, name);
    if (value) return cleanText(value, LIMITS.value);
  }
  return nodeText(node);
}

function microdataType(node) {
  const raw = cleanText(attr(node, 'itemtype'), 300).split(/\s+/)[0];
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return cleanText(parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.hostname, LIMITS.label);
  } catch {
    return cleanText(raw.split(/[\/#]/).filter(Boolean).at(-1), LIMITS.label);
  }
}

function extractMicrodata(scope, labels) {
  const { entries } = scan(scope, { prune: true });
  const roots = entries.map(({ node }) => node).filter(node => attr(node, 'itemscope') !== undefined);
  const records = [];
  for (const root of roots.slice(0, LIMITS.fields)) {
    const fields = {};
    const recordLabels = [];
    const nestedRoots = new Set(scan(root, { prune: true, maxNodes: 5_000 }).entries
      .map(({ node }) => node)
      .filter(node => node !== root && attr(node, 'itemscope') !== undefined));
    const stack = [root];
    let visited = 0;
    while (stack.length && recordLabels.length < LIMITS.fields && visited < 5_000) {
      const node = stack.pop();
      visited++;
      if (isPruned(node)) continue;
      if (node !== root && nestedRoots.has(node)) continue;
      const properties = cleanText(attr(node, 'itemprop'), LIMITS.label).split(/\s+/).filter(Boolean);
      for (const property of properties) addField(fields, recordLabels, property, microdataValue(node));
      const children = node.childNodes ?? [];
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    if (recordLabels.length) {
      for (const label of recordLabels) labels.push(label);
      records.push({ type: microdataType(root), fields, fieldLabels: [...new Set(recordLabels)].sort() });
    }
  }

  // Some pages use itemprop without an explicit itemscope. Preserve one bounded record
  // per nearest property group rather than flattening repeated values into page fields.
  if (!records.length) {
    const propertyNodes = entries.map(({ node }) => node).filter(node => attr(node, 'itemprop'));
    const groupRoots = new Set();
    for (const propertyNode of propertyNodes) {
      const fallback = propertyNode.parentNode ?? propertyNode;
      let candidate = fallback;
      let found;
      while (candidate !== scope && candidate?.parentNode) {
        const properties = new Set(scan(candidate, { prune: true, maxNodes: 500 }).entries
          .flatMap(({ node }) => cleanText(attr(node, 'itemprop'), LIMITS.label).split(/\s+/).filter(Boolean)));
        if (properties.size > 1) {
          found = candidate;
          break;
        }
        candidate = candidate.parentNode;
      }
      groupRoots.add(found ?? fallback);
    }
    for (const root of [...groupRoots].slice(0, LIMITS.fields)) {
      const fields = {};
      const recordLabels = [];
      for (const { node } of scan(root, { prune: true, maxNodes: 2_000 }).entries) {
        const properties = cleanText(attr(node, 'itemprop'), LIMITS.label).split(/\s+/).filter(Boolean);
        for (const property of properties) addField(fields, recordLabels, property, microdataValue(node));
      }
      if (recordLabels.length) {
        for (const label of recordLabels) labels.push(label);
        records.push({ type: '', fields, fieldLabels: [...new Set(recordLabels)].sort() });
      }
    }
  }
  return records;
}

function extractRepeatedCards(scope, labels) {
  let best = [];
  for (const { node: parent } of scan(scope, { prune: true, maxNodes: 20_000 }).entries) {
    const groups = new Map();
    for (const child of elementChildren(parent)) {
      if (!['article', 'li', 'div'].includes(child.tagName)) continue;
      const className = cleanText(attr(child, 'class'), 120).split(/\s+/).slice(0, 2).join(' ');
      if (child.tagName === 'div' && !className) continue;
      const content = nodeText(child, 500);
      const descendants = scan(child, { prune: true, maxNodes: 500 }).entries;
      const hasHeading = descendants.some(({ node }) => ['h2', 'h3', 'h4'].includes(node.tagName));
      if (content.length < 25 && !hasHeading) continue;
      const hasLink = descendants.some(({ node }) => node.tagName === 'a' && attr(node, 'href'));
      const hasRecordShape = hasHeading || descendants.some(({ node }) => ['blockquote', 'p'].includes(node.tagName))
        || descendants.some(({ node }) => node.tagName === 'span' && attr(node, 'class')?.split(/\s+/).includes('text'));
      if (!hasLink || !hasRecordShape) continue;
      const signature = `${child.tagName}:${className}`;
      if (!groups.has(signature)) groups.set(signature, []);
      groups.get(signature).push(child);
    }
    for (const group of groups.values()) if (group.length >= 2 && group.length > best.length) best = group;
  }
  if (!best.length) return [];
  labels.push('recordTitle', 'recordSummary');
  return best.slice(0, LIMITS.fields).map(root => {
    const descendants = scan(root, { prune: true, maxNodes: 500 }).entries;
    const titleNode = descendants.find(({ node }) => ['h2', 'h3', 'h4', 'blockquote'].includes(node.tagName))?.node
      ?? descendants.find(({ node }) => node.tagName === 'span' && attr(node, 'class')?.split(/\s+/).includes('text'))?.node
      ?? descendants.find(({ node }) => node.tagName === 'a')?.node;
    const titleLink = titleNode && scan(titleNode, { maxNodes: 100 }).entries.find(({ node }) => node.tagName === 'a')?.node;
    const title = cleanText((titleLink ? attr(titleLink, 'title') : '') || nodeText(titleNode, 200), 200);
    const summary = nodeText(root, LIMITS.value);
    return { type: 'Repeated card', fields: { title, summary }, fieldLabels: ['summary', 'title'] };
  });
}

function countMap(entries, selector, cap) {
  const counts = new Map();
  for (const entry of entries) {
    const key = selector(entry);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .sort((a, b) => a[0].localeCompare(b[0])));
}

function tableLooksLikeLayout(table) {
  const { entries } = scan(table, { prune: true, maxNodes: 2_000 });
  const hasHeader = entries.some(({ node }) => node.tagName === 'th' || node.tagName === 'caption');
  const rows = entries.filter(({ node }) => node.tagName === 'tr').length;
  const presentational = /^(?:presentation|none)$/i.test(attr(table, 'role') ?? '');
  return presentational || (!hasHeader && rows > 1);
}

function termKey({ node }) {
  return node.nodeName === '#text' ? node.value : '';
}

function hasSubstantiveHeadingContext(heading) {
  const container = heading?.parentNode;
  if (!container) return false;
  const entries = scan(container, { prune: true, maxNodes: 2_000 }).entries;
  const paragraphLength = entries
    .filter(({ node }) => node.tagName === 'p')
    .reduce((length, { node }) => length + nodeText(node, 500).length, 0);
  const hasStructuredDetails = entries.some(({ node }) =>
    ['dt', 'th', 'strong', 'b'].includes(node.tagName) || attr(node, 'itemprop'));
  return paragraphLength >= 20 || hasStructuredDetails;
}

export function analyzePage(html, url) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  if (typeof url !== 'string' || !url.trim()) throw new TypeError('url must be a non-empty string');
  const issue = issueCollector();
  const inputLength = html.length;
  const boundedHtml = html.slice(0, LIMITS.html);
  if (boundedHtml.length < inputLength) issue.add('input-truncated', 'warning', `HTML exceeded ${LIMITS.html} characters`);

  const parserErrors = [];
  const document = parse(boundedHtml, { onParseError: error => parserErrors.push(error) });
  const all = scan(document);
  if (all.truncated) issue.add('dom-node-limit', 'warning', `Analysis stopped after ${LIMITS.nodes} nodes`);
  const elements = all.entries.filter(({ node }) => node.tagName);
  const htmlNode = firstTag(all.entries, 'html');
  const body = firstTag(all.entries, 'body') ?? document;
  const main = firstTag(all.entries, 'main');
  const articles = all.entries.filter(({ node }) => node.tagName === 'article');
  const titleElement = firstTag(all.entries, 'title');
  const scope = main ?? (articles.length === 1 ? articles[0].node : body);
  const scoped = scan(scope, { prune: true });
  const heading = firstTag(scoped.entries, 'h1');
  const subordinateHeading = scoped.entries.find(({ node }) =>
    (node.tagName === 'h2' || node.tagName === 'h3') && hasSubstantiveHeadingContext(node))?.node;
  const headingHasLink = heading && scan(heading, { maxNodes: 100 }).entries.some(({ node }) => node.tagName === 'a');
  const contentHeading = !heading || (scope === body && headingHasLink) ? subordinateHeading : heading;
  const title = nodeText(contentHeading ?? titleElement, LIMITS.value);

  const fields = {};
  const fieldLabels = [];
  if (title) addField(fields, fieldLabels, 'title', title);
  extractFields(scope, fields, fieldLabels);
  const records = extractMicrodata(scope, fieldLabels);
  if (!records.length) records.push(...extractRepeatedCards(scope, fieldLabels));
  if (fieldLabels.length >= LIMITS.fields) issue.add('field-limit', 'info', `Only ${LIMITS.fields} fields were retained`);

  const linkSources = elements.filter(({ node }) =>
    ((node.tagName === 'a' || node.tagName === 'area') && attr(node, 'href') !== undefined)
    || ((node.tagName === 'frame' || node.tagName === 'iframe') && attr(node, 'src') !== undefined));
  let baseUrl = url;
  const base = elements.find(({ node }) => node.tagName === 'base' && attr(node, 'href') !== undefined)?.node;
  if (base) {
    try {
      const resolved = new URL(attr(base, 'href'), url);
      if (['http:', 'https:'].includes(resolved.protocol)) baseUrl = resolved.href;
      else issue.add('unsupported-base-url', 'warning');
    } catch { issue.add('invalid-base-url', 'warning'); }
  }
  const links = [];
  const seenLinks = new Set();
  for (const { node } of linkSources) {
    const reference = node.tagName === 'frame' || node.tagName === 'iframe' ? attr(node, 'src') : attr(node, 'href');
    const href = publicLink(reference, baseUrl);
    if (href && !seenLinks.has(href) && links.length < LIMITS.links) {
      seenLinks.add(href);
      links.push(href);
    }
  }
  if (seenLinks.size >= LIMITS.links && linkSources.length > LIMITS.links) issue.add('link-limit', 'info', `Only ${LIMITS.links} links were retained`);

  const featureElements = scoped.entries.filter(({ node }) => node.tagName && !isPruned(node));
  const tags = countMap(featureElements, ({ node }) => node.tagName, LIMITS.tags);
  let searchableText = '';
  for (const entry of scoped.entries) {
    if (searchableText.length >= LIMITS.text) break;
    searchableText += ` ${termKey(entry)}`;
  }
  searchableText = cleanText(searchableText, LIMITS.text);
  const termEntries = [...searchableText.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,39}/gu)]
    .map(match => match[0].replace(/^['-]+|['-]+$/g, ''))
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
  const terms = countMap(termEntries, word => word, LIMITS.terms);

  const hasDoctype = (document.childNodes ?? []).some(node => node.nodeName === '#documentType');
  if (!hasDoctype) issue.add('missing-doctype', 'warning');
  for (const error of parserErrors) {
    if (error.code !== 'missing-doctype') issue.add('html-parse-error', 'warning', error.code);
  }
  if (!attr(htmlNode, 'lang')) issue.add('missing-lang', 'warning');
  if (!nodeText(titleElement)) issue.add('missing-title', 'warning');
  if (!main) issue.add('missing-main', 'info');

  const ids = new Map();
  const navSignatures = new Map();
  let maxDepth = 0;
  let imageCount = 0;
  let imageMissingAltCount = 0;
  let tableCount = 0;
  let layoutTableCount = 0;
  let inlineStyleCount = 0;
  for (const { node, depth } of elements) {
    maxDepth = Math.max(maxDepth, depth);
    if (LEGACY_TAGS.has(node.tagName)) issue.add(`legacy-${node.tagName}`, 'warning');
    if (attr(node, 'style')) inlineStyleCount++;
    for (const attribute of node.attrs ?? []) {
      if (LEGACY_COLOR_ATTRIBUTES.has(attribute.name)) issue.add('legacy-color-attribute', 'warning', attribute.name);
    }
    const id = attr(node, 'id');
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    if (node.tagName === 'img') {
      imageCount++;
      if (attr(node, 'alt') === undefined) imageMissingAltCount++;
    }
    if ((node.tagName === 'frame' || node.tagName === 'iframe') && !cleanText(attr(node, 'title'), LIMITS.label)) {
      issue.add('frame-missing-title', 'warning', node.tagName);
    }
    if (node.tagName === 'table') {
      tableCount++;
      if (tableLooksLikeLayout(node)) layoutTableCount++;
    }
    if (node.tagName === 'meta' && /^refresh$/i.test(attr(node, 'http-equiv') ?? '')) issue.add('meta-refresh', 'warning');
    if (node.tagName === 'a') {
      const href = attr(node, 'href') ?? '';
      if (attr(node, 'onclick') && (!href || href === '#' || /^javascript:/i.test(href))) issue.add('javascript-only-link', 'warning');
    } else if (attr(node, 'onclick')) {
      issue.add('onclick-navigation-signal', 'info', node.tagName);
    }
    if (node.tagName === 'nav') {
      const signature = nodeText(node, 500, true).toLowerCase();
      if (signature) navSignatures.set(signature, (navSignatures.get(signature) ?? 0) + 1);
    }
  }
  for (const count of ids.values()) if (count > 1) issue.add('duplicate-id', 'warning');
  if (imageMissingAltCount) {
    for (let index = 0; index < imageMissingAltCount; index++) issue.add('image-missing-alt', 'warning');
  }
  if (inlineStyleCount) {
    for (let index = 0; index < inlineStyleCount; index++) issue.add('inline-style', 'info');
  }
  if (layoutTableCount) {
    for (let index = 0; index < layoutTableCount; index++) issue.add('table-layout-suspected', 'info');
  }
  for (const count of navSignatures.values()) {
    for (let index = 1; index < count; index++) issue.add('duplicate-navigation', 'info');
  }
  if (maxDepth > 24) issue.add('deep-wrapper-tree', 'info', `Maximum DOM depth was ${maxDepth}`);

  return {
    url,
    title,
    fields,
    fieldLabels: [...new Set(fieldLabels)].sort(),
    records,
    features: { tags, terms },
    links,
    issues: issue.values(),
    stats: {
      inputLength,
      textLength: searchableText.length,
      elementCount: elements.length,
      linkCount: linkSources.length,
      tableCount,
      layoutTableCount,
      imageCount,
      fieldCount: Object.keys(fields).length,
      maxDepth,
    },
  };
}
