import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePage } from '../src/page-analysis.mjs';

const url = path => `https://example.test${path}`;
const wrap = body => `<!doctype html><html lang="en"><head><title>Legacy</title></head><body>${body}</body></html>`;

test('anchors, iframes, and image-map areas retain DOM order and base semantics', () => {
  const page = analyzePage(wrap(`<base href="/archive/">
    <a href="first.html#top">First</a>
    <area href="map/detail.html" alt="Detail">
    <iframe src="embed.html" title="Embed"></iframe>
    <a href="first.html#other">Duplicate</a>`), url('/start/index.html'));

  assert.deepEqual(page.links, [
    url('/archive/first.html'),
    url('/archive/map/detail.html'),
    url('/archive/embed.html'),
  ]);
  assert.equal(page.stats.linkCount, 4);
});

test('valid legacy framesets expose frame sources in deterministic order', () => {
  const page = analyzePage(`<!doctype html><html lang="en"><head><title>Frames</title><base href="/archive/"></head>
    <frameset cols="30%,70%"><frame src="nav.html"><frame src="content.html" title="Content"></frameset></html>`, url('/start'));
  assert.deepEqual(page.links, [url('/archive/nav.html'), url('/archive/content.html')]);
  assert.equal(page.issues.find(issue => issue.code === 'frame-missing-title')?.count, 1);
});

test('link sources expose public external URLs but reject script and non-web schemes', () => {
  const page = analyzePage(wrap(`<a href="https://outside.test/a#fragment">External</a>
    <frame src="javascript:parent.run()">
    <iframe src="data:text/html,hello"></iframe>
    <area href="mailto:person@example.test">
    <area href="/allowed#map">
    <iframe src="//cdn.example.test/embed" title="Remote"></iframe>`), url('/source'));

  assert.deepEqual(page.links, [
    'https://outside.test/a',
    url('/allowed'),
    'https://cdn.example.test/embed',
  ]);
  assert.equal(page.issues.find(issue => issue.code === 'frame-missing-title')?.count, 1);
});

test('colon labels survive font and span wrappers without consuming the next label', () => {
  const page = analyzePage(wrap(`<main><h1>Record</h1><p>
    <font face="serif"><b>Author:</b></font> Avery Cole
    <span><font><strong>Published:</strong></font></span> 1984
    <span><b>Edition:</b></span><span>Second</span>
    <span><b>Language:</b></span> English
  </p><div><b>Ordinary emphasis</b> is prose.</div></main>`), url('/labels'));

  assert.deepEqual(page.fields, {
    title: 'Record',
    author: 'Avery Cole',
    published: '1984',
    edition: 'Second',
    language: 'English',
  });
});

test('layout rows with nested tables, navigation, and prose do not invent fields', () => {
  const page = analyzePage(wrap(`<main><h1>Catalog</h1>
    <table role="presentation"><tr><td>Sidebar</td><td>Welcome</td></tr></table>
    <table><tr><td><table><tr><td>Nested Label</td><td>Nested Value</td></tr></table></td><td>Outer copy</td></tr></table>
    <table><tr><td><a href="/">Home</a></td><td><a href="/next">Next</a></td></tr></table>
    <table><tr><td>This introductory sentence explains the whole catalog.</td><td>More prose for visitors.</td></tr></table>
  </main>`), url('/layout'));

  assert.deepEqual(page.fields, { title: 'Catalog', nestedLabel: 'Nested Value' });
  for (const key of ['sidebar', 'home', 'thisIntroductorySentenceExplainsTheWholeCatalog']) {
    assert(!Object.hasOwn(page.fields, key), key);
  }
});

test('simple th and legacy td record tables still yield fields', () => {
  const page = analyzePage(wrap(`<main><h1>Book</h1><table>
    <tr><th>Author</th><td>Mara Vale</td></tr>
    <tr><td>Publication Date</td><td>1978</td></tr>
  </table></main>`), url('/book'));
  assert.deepEqual(page.fields, { title: 'Book', author: 'Mara Vale', publicationDate: '1978' });
});

test('malformed legacy tables and unclosed font labels remain bounded and useful', () => {
  const page = analyzePage('<html><body><main><h1>Open<table><tr><td>Author<td>Avery<tr><td>Year<td>1900</table><p><font><b>Format:</b></font> Print', url('/broken'));
  assert.equal(page.fields.author, 'Avery');
  assert.equal(page.fields.year, '1900');
  assert.equal(page.fields.format, 'Print');
  assert(page.issues.some(issue => issue.code === 'missing-doctype'));
});
