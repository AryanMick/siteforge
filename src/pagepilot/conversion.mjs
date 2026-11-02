function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  return JSON.stringify(value);
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function slugFor(page, title) {
  let candidate = '';
  try {
    const url = new URL(String(page?.url ?? ''), 'https://pagepilot.invalid');
    candidate = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  } catch {}
  try { candidate = decodeURIComponent(candidate); } catch {}
  candidate = candidate || title;
  return candidate.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200) || 'pagepilot-draft';
}

function capturedFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [String(name), text(value)]));
}

/** Convert captured PagePilot fields to inert WordPress draft records. */
export function convertPages(result) {
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  const labels = result?.labels && typeof result.labels === 'object' ? result.labels : {};
  return pages.filter(page => page && !page.excluded && page.cluster !== 'excluded').map(page => {
    const fields = capturedFields(page.fields);
    const sourceUrl = text(page.url);
    const title = text(page.title) || fields.title || sourceUrl || 'Untitled';
    const cluster = text(labels[page.cluster]) || text(page.cluster);
    const entries = Object.entries(fields);
    const content = entries.length
      ? `<dl class="pagepilot-fields">${entries.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`
      : '<p>No captured fields were available for this page.</p>';
    return { sourceUrl, title, slug: slugFor(page, title), content, status: 'draft', cluster, fields };
  });
}
