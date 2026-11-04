import { createHash } from 'node:crypto';

export const VERSION = '1.9.0';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const seedFor = (...parts) => Number.parseInt(hash(parts).slice(0, 8), 16);
export const chance = (...parts) => seedFor(...parts) / 0x100000000;
export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const normalizeSourceText = value => String(value).toWellFormed().replace(/\r\n?/g, '\n').replaceAll('\0', '\uFFFD');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const label = value => value.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
export const slug = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'entry';
export function walk(node, predicate, results = []) {
  if (predicate(node)) results.push(node);
  for (const child of node.childNodes ?? []) walk(child, predicate, results);
  return results;
}
export const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
export const textContent = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join(' ');
