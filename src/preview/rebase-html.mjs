// Rewrites a page's own-origin URLs (href/src attributes and the client app's page-data payload) to another origin,
// leaving visible text and deliberate wrong-host links unchanged. Used by preview servers and by the WordPress/Drupal
// packages, so a page served from a new address links to that address.
import { parse } from 'parse5';

export function previewUrl(value, origin) {
  try { const url = new URL(value); return `${origin}${url.pathname}${url.search}${url.hash}`; } catch { return value; }
}

export function rebaseHtml(source, origin, sourceOrigin, includePageData = true) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const edits = [];
  const visit = node => {
    for (const attribute of node?.attrs ?? []) {
      if (!['href', 'src'].includes(attribute.name)) continue;
      const location = node.sourceCodeLocation?.attrs?.[attribute.name];
      if (!Number.isInteger(location?.startOffset) || !Number.isInteger(location?.endOffset)) continue;
      const canonical = node.tagName === 'link' && attribute.name === 'href' && node.attrs.some(item => item.name === 'rel' && item.value.split(/\s+/).includes('canonical'));
      let sameSource = false;
      try { sameSource = Boolean(sourceOrigin) && new URL(attribute.value).origin === sourceOrigin; } catch {}
      let protocolRelative = false;
      try { protocolRelative = Boolean(sourceOrigin) && attribute.value.startsWith('//') && new URL(attribute.value, sourceOrigin).origin === sourceOrigin; } catch {}
      if (!canonical && !sameSource && !protocolRelative) continue;
      const original = source.slice(location.startOffset, location.endOffset);
      const rebased = protocolRelative ? `//${new URL(origin).host}${attribute.value.replace(/^\/\/[^/?#]*/, '')}` : previewUrl(attribute.value, origin);
      const value = rebased.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      const quoted = /^(.*?=\s*)(["'])([\s\S]*)(\2)$/i.exec(original);
      edits.push({ start: location.startOffset, end: location.endOffset, replacement: quoted ? `${quoted[1]}${quoted[2]}${value}${quoted[2]}` : `${attribute.name}="${value}"` });
    }
    if (includePageData && node?.tagName === 'script' && sourceOrigin && node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === 'page-data')) {
      const location = node.sourceCodeLocation;
      if (location?.startTag?.endOffset && location?.endTag?.startOffset) {
        const original = source.slice(location.startTag.endOffset, location.endTag.startOffset);
        try {
          const payload = JSON.parse(original);
          if (Array.isArray(payload) && payload.length === 2 && typeof payload[0] === 'string' && typeof payload[1] === 'number') {
            const html = rebaseHtml(payload[0], origin, sourceOrigin, false);
            if (html !== payload[0]) {
              const replacement = JSON.stringify([html, payload[1]])
                .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
              edits.push({ start: location.startTag.endOffset, end: location.endTag.startOffset, replacement });
            }
          }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
    }
    for (const child of node?.childNodes ?? []) visit(child);
  };
  visit(document);
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}
