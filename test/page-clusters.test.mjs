import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePage } from '../src/page-analysis.mjs';
import { clusterPages } from '../src/page-clusters.mjs';

const url = path => `https://example.test${path}`;
const wrap = body => `<!doctype html><html lang="en"><head><title>Catalog</title></head><body>${body}</body></html>`;

function clusterFor(result, pageUrl) {
  return result.pages.find(page => page.url === pageUrl)?.cluster;
}

test('same record schema survives wrappers, class churn, reordered fields, and legacy tables', () => {
  const pages = [
    analyzePage(wrap('<main class="v1"><h1>Ada Book</h1><dl><dt>Author</dt><dd>Ada</dd><dt>ISBN</dt><dd>111</dd><dt>Published</dt><dd>2020</dd></dl></main>'), url('/books/ada')),
    analyzePage(wrap('<main><section class="random-981"><div><h1>Grace Book</h1></div><dl><dt>Published</dt><dd>2021</dd><div><dt>ISBN</dt><dd>222</dd></div><dt>Author</dt><dd>Grace</dd></dl></section></main>'), url('/books/grace')),
    analyzePage(wrap('<main><h1>Linus Book</h1><table bgcolor="#fff"><tr><td>ISBN</td><td>333</td></tr><tr><td>Author</td><td>Linus</td></tr><tr><td>Published</td><td>2022</td></tr></table></main>'), url('/books/linus')),
    analyzePage(wrap('<main><h1>Ada Lovelace</h1><dl><dt>Born</dt><dd>1815</dd><dt>Occupation</dt><dd>Mathematician</dd><dt>Nationality</dt><dd>British</dd></dl></main>'), url('/authors/ada')),
    analyzePage(wrap('<main><h1>Grace Hopper</h1><dl><dt>Occupation</dt><dd>Scientist</dd><dt>Nationality</dt><dd>American</dd><dt>Born</dt><dd>1906</dd></dl></main>'), url('/authors/grace')),
  ];
  const result = clusterPages(pages);
  assert.equal(clusterFor(result, url('/books/ada')), clusterFor(result, url('/books/grace')));
  assert.equal(clusterFor(result, url('/books/ada')), clusterFor(result, url('/books/linus')));
  assert.equal(clusterFor(result, url('/authors/ada')), clusterFor(result, url('/authors/grace')));
  assert.notEqual(clusterFor(result, url('/books/ada')), clusterFor(result, url('/authors/ada')));
  assert(pages[2].issues.some(item => item.code === 'table-layout-suspected'));
});

test('schema.org microdata keeps repeated records separate and contributes signature labels', () => {
  const listing = analyzePage(wrap(`<h1><a href="/">Quotes</a></h1><main>
    <article itemscope itemtype="https://schema.org/Quotation"><span itemprop="text">One</span><small itemprop="author">A</small></article>
    <article itemscope itemtype="https://schema.org/Quotation"><span itemprop="text">Two</span><small itemprop="author">B</small></article>
  </main>`), url('/page/1'));
  assert.equal(listing.records.length, 2);
  assert.deepEqual(listing.records.map(record => record.fields.author), ['A', 'B']);
  assert(!Object.hasOwn(listing.fields, 'author'));
  assert(listing.fieldLabels.includes('author'));
  assert(listing.fieldLabels.includes('text'));

  const implicit = analyzePage(wrap(`<main>
    <div><span itemprop="text">Three</span><small itemprop="author">C</small></div>
    <div><span itemprop="text">Four</span><small itemprop="author">D</small></div>
  </main>`), url('/page/2'));
  assert.equal(implicit.records.length, 2);
  assert.equal(clusterFor(clusterPages([listing, implicit]), listing.url), clusterFor(clusterPages([listing, implicit]), implicit.url));

  const onePropertyEach = analyzePage(wrap('<main><p><span itemprop="name">First</span></p><p><span itemprop="name">Second</span></p></main>'), url('/names'));
  assert.equal(onePropertyEach.records.length, 2);
  assert.deepEqual(onePropertyEach.records.map(record => record.fields.name), ['First', 'Second']);
});

test('unmarked product and quote cards stay separate without mistaking simple navigation for records', () => {
  const products = analyzePage(wrap(`<h1>Catalog</h1><ol class="row">
    <li class="product"><article><h3><a href="/a" title="First fictional book about archives">First fictional book...</a></h3><p class="price">Price 12</p></article></li>
    <li class="product"><article><h3><a href="/b">Second fictional book about archives</a></h3><p class="price">Price 14</p></article></li>
    <li class="product"><article><h3><a href="/c">Third fictional book about archives</a></h3><p class="price">Price 16</p></article></li>
  </ol>`), url('/products'));
  assert.equal(products.records.length, 3);
  assert.deepEqual(products.records.map(record => record.fields.title), ['First fictional book about archives', 'Second fictional book about archives', 'Third fictional book about archives']);
  assert(products.fieldLabels.includes('recordTitle'));
  const quotes = analyzePage(wrap(`<h1>Quotes</h1><div class="quotes">
    <div class="quote"><span class="text">A long fictional statement about the local archives.</span><small>Ada</small><a href="/tag/a">Tag</a></div>
    <div class="quote"><span class="text">A second fictional statement about preservation.</span><small>Bea</small><a href="/tag/b">Tag</a></div>
  </div>`), url('/quotes'));
  assert.equal(quotes.records.length, 2);
  assert(quotes.records[0].fields.title.startsWith('A long fictional statement'));
  const navigation = analyzePage(wrap('<ul><li><a href="/a">Archives A</a></li><li><a href="/b">Archives B</a></li></ul>'), url('/menu'));
  assert.equal(navigation.records.length, 0);
});

test('microdata traversal prunes private script, style, and template properties', () => {
  const page = analyzePage(wrap(`<main><article itemscope itemtype="https://schema.org/CreativeWork">
    <span itemprop="name">Public name</span>
    <script itemprop="scriptSecret">private script text</script>
    <style itemprop="styleSecret">private style text</style>
    <template><meta itemprop="templateSecret" content="private template text"></template>
  </article></main>`), url('/microdata-pruning'));
  assert.equal(page.records.length, 1);
  assert.deepEqual(page.records[0].fields, { name: 'Public name' });
  assert.deepEqual(page.records[0].fieldLabels, ['name']);
  assert(!page.fieldLabels.includes('scriptSecret'));
  assert(!page.fieldLabels.includes('styleSecret'));
  assert(!page.fieldLabels.includes('templateSecret'));
  assert(!Object.keys(page.features.terms).some(term => ['private', 'script', 'style', 'template'].includes(term)));
});

test('public links retain deterministic DOM order for caller BFS', () => {
  const page = analyzePage(wrap('<a href="/z-author">Author</a><a href="/page/2">Next</a><a href="/a-author">Other</a><a href="/page/2#again">Duplicate</a>'), url('/'));
  assert.deepEqual(page.links, [url('/z-author'), url('/page/2'), url('/a-author')]);
});

test('the first base href controls relative links, with invalid bases falling back', () => {
  const page = analyzePage(wrap('<base href="/archive/"><base href="/wrong/"><a href="record.html">Record</a>'), url('/start/page'));
  assert.deepEqual(page.links, [url('/archive/record.html')]);
  const broken = analyzePage(wrap('<base href="http://["><base href="/wrong/"><a href="record.html">Record</a>'), url('/start/page'));
  assert.deepEqual(broken.links, [url('/start/record.html')]);
  assert(broken.issues.some(issue => issue.code === 'invalid-base-url'));
});

test('legacy colon labels retain plain text and inline values without swallowing the next field', () => {
  const page = analyzePage(wrap('<main><h1>Record</h1><p><b>Publication Date:</b> 2024-01-01<br><b>Author:</b> Avery <em>Cole</em></p><p><strong>Ordinary emphasis</strong> is not a field</p></main>'), url('/plain'));
  assert.deepEqual(page.fields, { title: 'Record', publicationDate: '2024-01-01', author: 'Avery Cole' });
});

test('optional fields and different presentations retain one underlying record cluster', () => {
  const pages = [
    analyzePage(wrap('<main><h1>One</h1><dl><dt>Author</dt><dd>A</dd><dt>Published</dt><dd>2020</dd></dl></main>'), url('/one')),
    analyzePage(wrap('<main><h1>Two</h1><table><tr><th>Author</th><td>B</td></tr><tr><th>Published</th><td>2021</td></tr><tr><th>Cover</th><td>image.png</td></tr></table></main>'), url('/two')),
    analyzePage(wrap('<main><h1>Three</h1><p><b>Author:</b> C</p><p><b>Published:</b> 2022</p><p><b>Subtitle:</b> Notes</p></main>'), url('/three')),
  ];
  assert.equal(clusterPages(pages).clusters.length, 1);
});

test('bold label pairs support detail pages without relying on classes or URL paths', () => {
  const page = analyzePage(wrap('<h1><a href="/">Site</a></h1><h3>Jane Doe</h3><p><strong>Born:</strong><span>1900</span></p><p><b>Location:</b><span>Earth</span></p>'), url('/opaque'));
  assert.equal(page.title, 'Jane Doe');
  assert.equal(page.fields.born, '1900');
  assert.equal(page.fields.location, 'Earth');
});

test('content headers are retained while global shell headers stay pruned', () => {
  const page = analyzePage(`<!doctype html><html lang="en"><head><title>Actual Title | Site</title></head><body>
    <header><h1><a href="/">Shell Brand</a></h1><nav>Global navigation</nav></header>
    <main><header itemscope itemtype="https://schema.org/Article"><h1 itemprop="headline">Actual Title</h1></header><p>Substantive page copy.</p></main>
  </body></html>`, url('/nested-header'));
  assert.equal(page.title, 'Actual Title');
  assert.equal(page.fields.title, 'Actual Title');
  assert.equal(page.records[0].fields.headline, 'Actual Title');
  assert(Object.hasOwn(page.features.terms, 'actual'));
  assert(!Object.hasOwn(page.features.terms, 'shell'));
  assert(!Object.hasOwn(page.features.terms, 'navigation'));
});

test('linked shell heading does not promote an unrelated sidebar heading', () => {
  const page = analyzePage(wrap(`<h1><a href="/">Site Brand</a></h1>
    <section><div><p>A short quote body gives the page useful content.</p></div></section>
    <aside><div><h2>Popular labels</h2><a href="/one">one</a><a href="/two">two</a></div></aside>`), url('/listing'));
  assert.equal(page.title, 'Catalog');
  assert.equal(page.fields.title, 'Catalog');
});

test('empty and singleton inputs are safe', () => {
  assert.deepEqual(clusterPages([]), {
    version: 1,
    method: 'agglomerative average-linkage over bounded heuristic distances (ml-hclust)',
    threshold: 0.32,
    pages: [],
    clusters: [],
    warnings: [],
  });
  const single = clusterPages([{ url: url('/only') }]);
  assert.equal(single.pages[0].cluster, 'cluster-001');
  assert.equal(single.clusters[0].cohesion, 1);
  assert.equal(single.warnings.length, 2);
});

test('cluster output is invariant to input order', () => {
  const pages = [
    analyzePage(wrap('<main><h1>A</h1><dl><dt>Author</dt><dd>X</dd><dt>ISBN</dt><dd>1</dd></dl></main>'), url('/z')),
    analyzePage(wrap('<main><h1>B</h1><dl><dt>ISBN</dt><dd>2</dd><dt>Author</dt><dd>Y</dd></dl></main>'), url('/a')),
    analyzePage(wrap('<main><h1>C</h1><dl><dt>Born</dt><dd>3</dd><dt>Country</dt><dd>Q</dd></dl></main>'), url('/m')),
  ];
  assert.deepEqual(clusterPages(pages), clusterPages([...pages].reverse()));
});

test('missing features and malformed HTML degrade to bounded observations', () => {
  const malformed = analyzePage('<html><body><main><h1>Open<div><dt>Label<dd>Value<script>never indexed</script>', url('/broken'));
  assert.equal(malformed.fields.label, 'Value');
  assert(malformed.issues.some(item => item.code === 'missing-doctype'));
  assert(malformed.issues.some(item => item.code === 'missing-lang'));
  const result = clusterPages([{ url: url('/blank-a'), fields: null }, { url: url('/blank-b'), features: 'bad' }]);
  assert.equal(result.pages.length, 2);
  assert.equal(result.clusters.length, 2);
});

test('topic changes alone do not split identical article structures', () => {
  const shell = content => wrap(`<nav>home catalog account repeated boilerplate</nav><article>${content}</article>`);
  const cooking = analyzePage(shell('<h1>Pasta Guide</h1><p>tomato basil spaghetti boiling sauce</p>'), url('/one'));
  const database = analyzePage(shell('<h1>Database Index</h1><p>query transaction schema relational storage</p>'), url('/two'));
  const result = clusterPages([cooking, database]);
  assert.equal(clusterFor(result, cooking.url), clusterFor(result, database.url));
  assert(!Object.hasOwn(cooking.features.terms, 'account'));
});

test('unsafe labels cannot mutate prototypes', () => {
  const page = analyzePage(wrap('<main><h1>Safety</h1><dl><dt>constructor</dt><dd>x</dd><dt>prototype</dt><dd>y</dd><dt>__proto__</dt><dd>z</dd></dl></main>'), url('/safe'));
  assert(!Object.hasOwn(page.fields, 'constructor'));
  assert(!Object.hasOwn(page.fields, 'prototype'));
  assert(!Object.hasOwn(page.fields, '__proto__'));
  assert.equal({}.polluted, undefined);
  const clustered = clusterPages([{ url: url('/safe'), fields: JSON.parse('{"__proto__":"x","constructor":"y"}') }]);
  assert.deepEqual(clustered.pages[0].fields, {});
});

test('legacy detectors report bounded indicators without claiming computed contrast', () => {
  const page = analyzePage('<html><head><meta http-equiv="refresh" content="2"><title>Old</title></head><body bgcolor="white"><nav>Same links<script>private</script></nav><nav>Same links</nav><center><font color="gray"><img src="x"><a href="#" onclick="go()">Go</a><button onclick="go()">Open</button></font></center></body></html>', url('/old'));
  const codes = new Set(page.issues.map(item => item.code));
  for (const code of ['missing-doctype', 'missing-lang', 'missing-main', 'meta-refresh', 'legacy-center', 'legacy-font', 'legacy-color-attribute', 'image-missing-alt', 'javascript-only-link', 'onclick-navigation-signal', 'duplicate-navigation']) assert(codes.has(code), code);
  assert(![...codes].some(code => code.includes('contrast')));
});

test('duplicate URLs, page caps, and invalid thresholds are rejected', () => {
  assert.throws(() => clusterPages([{ url: url('/x') }, { url: url('/x') }]), /duplicate page URL/);
  assert.throws(() => clusterPages([{ url: url('/x') }, { url: url('/y') }], { maxPages: 1 }), /exceeds maxPages/);
  assert.throws(() => clusterPages([], { maxPages: 501 }), /between 1 and 500/);
  for (const threshold of [-0.1, 1.1, Number.NaN]) assert.throws(() => clusterPages([], { threshold }), /threshold/);
});
