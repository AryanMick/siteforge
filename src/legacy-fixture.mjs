import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { escapeHtml, json } from './util.mjs';

const BASE_URL = 'http://127.0.0.1:4310';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJXQAAAABJRU5ErkJggg==';

const SOURCE = Object.freeze([
  { url: '/', pageId: 'priv-01-home', kind: 'listing', expectedCluster: 'private-layout-index', contentType: 'directory', fields: { title: 'Town Library Catalog' } },
  { url: '/books/wind-harbor.html', pageId: 'priv-02-wind', kind: 'detail', expectedCluster: 'private-layout-book', contentType: 'book', fields: { title: 'The Wind at Harbor', author: 'Mara Vale', publicationDate: '1987-04-12', summary: 'A cartographer returns to a fogbound port and redraws the town from memory.' } },
  { url: '/books/glass-orchard.html', pageId: 'priv-03-glass', kind: 'detail', expectedCluster: 'private-layout-book', contentType: 'book', fields: { title: 'The Glass Orchard', author: 'Elliot Finch', publicationDate: '1993-09-03', summary: 'An apprentice botanist tends a greenhouse whose fruit preserves forgotten voices.' } },
  { url: '/books/night-index.html', pageId: 'priv-04-night', kind: 'detail', expectedCluster: 'private-layout-book', contentType: 'book', fields: { title: 'Index of the Night', author: 'Mara Vale', publicationDate: '2001-01-19', summary: 'A meticulous archivist catalogs the constellations that disappear before dawn.' } },
  { url: '/authors/mara-vale.html', pageId: 'priv-05-mara', kind: 'detail', expectedCluster: 'private-layout-author', contentType: 'author', fields: { title: 'Author Record: Mara Vale', name: 'Mara Vale', biography: 'Mara Vale writes quiet speculative novels about maps, memory, and coastal towns.' } },
  { url: '/authors/elliot-finch.html', pageId: 'priv-06-elliot', kind: 'detail', expectedCluster: 'private-layout-author', contentType: 'author', fields: { title: 'Author Record: Elliot Finch', name: 'Elliot Finch', biography: 'Elliot Finch is a novelist and former horticultural archivist from Northbridge.' } },
  { url: '/books/legacy/', pageId: 'priv-07-poor', kind: 'demonstration', expectedCluster: 'private-layout-a11y', contentType: 'accessibilityDemo', fields: { title: 'Faded Reading Room', description: 'This page intentionally demonstrates low-contrast legacy text.' } },
  { url: '/books/clean/', pageId: 'priv-08-good', kind: 'demonstration', expectedCluster: 'private-layout-a11y', contentType: 'accessibilityDemo', fields: { title: 'Clear Reading Room', description: 'This page provides the controlled high-contrast comparison.' } },
  { url: '/frames/catalog.html', pageId: 'priv-09-frame', kind: 'demonstration', expectedCluster: 'private-layout-frame', contentType: 'frameDemo', fields: { title: 'Framed Catalog Notice', description: 'A same-origin frame embeds an approved catalog target.' } },
  { url: '/frames/target.html', pageId: 'priv-10-target', kind: 'demonstration', expectedCluster: 'private-layout-frame-target', contentType: 'frameTarget', fields: { title: 'Frame Target', description: 'This local page is the only iframe target in the fixture.' } },
]);

const schemas = {
  directory: ['title'],
  book: ['title', 'author', 'publicationDate', 'summary'],
  author: ['title', 'name', 'biography'],
  accessibilityDemo: ['title', 'description'],
  frameDemo: ['title', 'description'],
  frameTarget: ['title', 'description'],
};

function truthFromSource() {
  return {
    version: 1,
    site: { id: 'legacy-library-controlled', baseUrl: BASE_URL, framework: 'html', noise: { level: 'custom' } },
    pages: SOURCE.map((page) => ({
      ...page,
      fields: { ...page.fields },
      canonicalValues: { ...page.fields },
      fieldStates: Object.fromEntries(Object.keys(page.fields).map((field) => [field, 'present'])),
      relationships: [],
      noiseEvents: [],
    })),
    schemas,
  };
}

const commonCss = `
html { background: #fff; color: #222; font-family: Arial, sans-serif; }
body { margin: 0 auto; max-width: 960px; padding: 0 16px 40px; }
nav { border-bottom: 2px groove #888; padding: 10px 0; }
nav a { color: #0645ad; margin-right: 12px; }
main { padding-top: 18px; }
dt { font-weight: bold; margin-top: 10px; }
dd { margin: 2px 0 8px 24px; }
table { border-collapse: collapse; }
th, td { border: 1px solid #777; padding: 6px; text-align: left; vertical-align: top; }
`;

const nav = `<nav aria-label="Catalog"><a href="/">Home</a><a href="/books/wind-harbor.html">Books</a><a href="/authors/mara-vale.html">Authors</a><a href="/books/legacy/">Contrast</a><a href="/frames/catalog.html">Frames</a><a href="/missing-shelf.html">Old shelf</a></nav>`;

function shell(title, body, { head = '', style = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${head}<style>${commonCss}${style}</style></head><body>${nav}<main>${body}</main></body></html>\n`;
}

function dl(fields, className = '') {
  return `<dl class="${className}">${Object.entries(fields).map(([key, value]) => `<dt>${escapeHtml({ author: 'Author', publicationDate: 'Publication Date', summary: 'Summary', name: 'Name', biography: 'Biography' }[key] ?? key)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`;
}

function renderPublicPages() {
  const byUrl = new Map(SOURCE.map((page) => [page.url, page]));
  const wind = byUrl.get('/books/wind-harbor.html');
  const glass = byUrl.get('/books/glass-orchard.html');
  const night = byUrl.get('/books/night-index.html');
  const mara = byUrl.get('/authors/mara-vale.html');
  const elliot = byUrl.get('/authors/elliot-finch.html');
  const poor = byUrl.get('/books/legacy/');
  const good = byUrl.get('/books/clean/');
  const frame = byUrl.get('/frames/catalog.html');
  const target = byUrl.get('/frames/target.html');
  return new Map([
    ['index.html', shell('Town Library Catalog', `<center><font face="Times New Roman" size="6"><h1>Town Library Catalog</h1></font></center><p>Browse a deliberately small catalog preserved from an older municipal website.</p><ul><li><a href="/books/wind-harbor.html">The Wind at Harbor</a></li><li><a href="/books/glass-orchard.html">The Glass Orchard</a></li><li><a href="/books/night-index.html">Index of the Night</a></li><li><a href="/authors/mara-vale.html">Mara Vale</a></li><li><a href="/authors/elliot-finch.html">Elliot Finch</a></li><li><a href="/books/legacy/">Faded reading room</a></li><li><a href="/books/clean/">Readable comparison</a></li><li><a href="/frames/catalog.html">Framed catalog notice</a></li><li><a href="/frames/target.html">Direct frame target</a></li></ul><button type="button" onclick="location.href='/authors/elliot-finch.html'">Open author with script</button><p><img src="${TINY_PNG}"> Decorative catalog pixel with intentionally missing alternative text.</p>`)],
    ['books/wind-harbor.html', shell(wind.fields.title, `<article class="book-record semantic-record"><h1>${escapeHtml(wind.fields.title)}</h1>${dl({ author: wind.fields.author, publicationDate: wind.fields.publicationDate, summary: wind.fields.summary }, 'book-facts')}</article>`, { style: '.semantic-record { max-width: 44rem; }' })],
    ['books/glass-orchard.html', shell(glass.fields.title, `<div class="recordPane1998 fixed-layout"><h1>${escapeHtml(glass.fields.title)}</h1><table summary="Book record"><tr><th>Author</th><td>${escapeHtml(glass.fields.author)}</td></tr><tr><th>Publication Date</th><td>${escapeHtml(glass.fields.publicationDate)}</td></tr><tr><th>Summary</th><td>${escapeHtml(glass.fields.summary)}</td></tr></table></div>`, { style: '.fixed-layout { width: 760px; } .recordPane1998 { border: 4px ridge #aaa; padding: 8px; }' })],
    ['books/night-index.html', shell(night.fields.title, `<center><font face="Courier New"><h1 class="ttl_9 oldTitle">${escapeHtml(night.fields.title)}</h1></font></center><p class="wrapOuter">Archived record starts here<div class="wrapInner odd_box"><dl class="factz"><dt>Author</dt><dd id="edition">${escapeHtml(night.fields.author)}</dd><dt>Publication Date</dt><dd id="edition">${escapeHtml(night.fields.publicationDate)}</dd><dt>Summary</dt><dd><span class="copy_2001">${escapeHtml(night.fields.summary)}</span></dd></dl></div></p>`, { head: '<meta http-equiv="refresh" content="86400; url=/">', style: '.odd_box { border: 3px outset #999; padding: 12px; } .copy_2001 { font-family: serif; }' })],
    ['authors/mara-vale.html', shell(mara.fields.title, `<section class="person-v1"><h1>${escapeHtml(mara.fields.title)}</h1>${dl({ name: mara.fields.name, biography: mara.fields.biography }, 'author-definition')}</section>`)],
    ['authors/elliot-finch.html', shell(elliot.fields.title, `<div class="bio_table_legacy"><h1>${escapeHtml(elliot.fields.title)}</h1><table><tr><th>Name</th><td>${escapeHtml(elliot.fields.name)}</td></tr><tr><th>Biography</th><td>${escapeHtml(elliot.fields.biography)}</td></tr></table></div>`)],
    ['books/legacy/index.html', shell(poor.fields.title, `<div class="faded fixed-layout"><h1>${escapeHtml(poor.fields.title)}</h1><p>${escapeHtml(poor.fields.description)}</p><p><a href="/private/ground-truth.json">Staff data export</a></p></div>`, { style: '.faded, .faded a { color: #bbb; background: #fff; } .fixed-layout { width: 760px; }' })],
    ['books/clean/index.html', shell(good.fields.title, `<section class="clear"><h1>${escapeHtml(good.fields.title)}</h1><p>${escapeHtml(good.fields.description)}</p><p><a href="/books/legacy/">Compare with faded page</a></p></section>`, { style: '.clear { color: #222; background: #fff; } .clear a { color: #0645ad; background: #fff; }' })],
    ['frames/catalog.html', shell(frame.fields.title, `<h1>${escapeHtml(frame.fields.title)}</h1><p>${escapeHtml(frame.fields.description)}</p><iframe src="/frames/target.html" width="620" height="220"></iframe>`, { style: 'iframe { border: 2px inset #777; max-width: 100%; }' })],
    ['frames/target.html', shell(target.fields.title, `<h1>${escapeHtml(target.fields.title)}</h1><p>${escapeHtml(target.fields.description)}</p>`)],
  ]);
}

export async function createLegacyFixture(out) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('out must be a non-empty path');
  const root = resolve(out);
  try {
    await mkdir(root);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Output root already exists: ${root}`);
    throw error;
  }
  const publicDir = join(root, 'public');
  const privateDir = join(root, 'private');
  await Promise.all([mkdir(publicDir), mkdir(privateDir)]);

  const truth = truthFromSource();
  await writeFile(join(privateDir, 'ground-truth.json'), json(truth));

  for (const [relativePath, html] of renderPublicPages()) {
    const destination = join(publicDir, relativePath);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, html);
  }
  return { root, publicDir, truthPath: join(privateDir, 'ground-truth.json'), pages: truth.pages.length };
}
