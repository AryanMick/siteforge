// Inner page designs (detail and listing pages) for the conventional and modern visual styles.
// Each site picks its own page-design system from the seed, so two library sites lay out their book,
// author, event and branch pages differently while still looking like the pages real sites publish.
// Everything here is decoration around the answer-key markup: the field list, related links and image
// are passed in as finished strings and are included exactly once, unchanged. This module never emits
// links to other pages (only in-page #pg-* fragments), images, dt/dd elements or data-field attributes.
import { seedFor } from '../site/util.mjs';

const ESC = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const humanize = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
const slugish = value => String(value ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

// Content type -> page archetype. Archetypes own the type-appropriate widgets; frames own the structure.
const ARCH = {
  library: { book: 'catalog', author: 'person', event: 'event', branch: 'place' },
  government: { program: 'service', department: 'place', policy: 'document', publication: 'document' },
  municipality: { service: 'service', office: 'place', meeting: 'event', notice: 'document' },
  university: { course: 'service', faculty: 'person', program: 'service', research: 'article' },
  healthcare: { service: 'service', clinic: 'place', provider: 'person', article: 'article' },
  documentation: { guide: 'docs', reference: 'docs', release: 'docs', tutorial: 'docs' },
  museum: { object: 'catalog', creator: 'person', exhibition: 'event', resource: 'service' },
  nonprofit: { project: 'service', grant: 'service', report: 'document', opportunity: 'service' },
  records: { record: 'catalog', collection: 'collection', findingAid: 'collection', office: 'place' },
  news: { article: 'article', journalist: 'person', feature: 'article', edition: 'catalog' },
};
const DETAIL_FRAMES = { default: ['rail', 'hero', 'left', 'column'], docs: ['three', 'left', 'rail', 'column'], article: ['rail', 'hero', 'column', 'left'] };
const LISTING_FRAMES = ['facets', 'filterbar', 'intro', 'accordion'];

function archetypeFor(domain, type) {
  const direct = ARCH[domain]?.[type];
  if (direct) return direct;
  if (/author|faculty|provider|creator|journalist|person|staff|people/i.test(type)) return 'person';
  if (/event|meeting|exhibition/i.test(type)) return 'event';
  if (/branch|office|clinic|location|department/i.test(type)) return 'place';
  if (/article|feature|news|story|research|post/i.test(type)) return 'article';
  if (/guide|reference|tutorial|release/i.test(type)) return domain === 'documentation' ? 'docs' : 'document';
  if (/policy|notice|publication|report/i.test(type)) return 'document';
  if (/collection|finding/i.test(type)) return 'collection';
  if (/book|object|record|edition|item/i.test(type)) return 'catalog';
  if (/program|service|course|grant|project|opportunity|resource/i.test(type)) return 'service';
  return 'generic';
}

function typeIndex(site, type) {
  const order = Object.keys(ARCH[site.domain] ?? {});
  const index = order.indexOf(type);
  return index >= 0 ? index : seedFor(site.seed ?? 0, site.id ?? '', type, 'inner-type-index') % 4;
}
const siteKey = site => [site.seed ?? 0, site.id ?? site.name ?? '', site.domain ?? ''];
const skinFor = site => seedFor(...siteKey(site), 'inner-skin') % 4;
// Frame per content type: a bijection from the site's types onto the four frames, so types within one site
// never share a structure, while consecutive seeds rotate (and periodically mirror) the assignment so every
// type sees every frame across sites.
function frameIndex(site, type, salt) {
  const seed = Number(site.seed ?? 0) >>> 0;
  const offset = seedFor(site.domain ?? '', salt) % 4;
  const mirror = (Math.floor(seed / 4) + seedFor(site.domain ?? '', salt, 'mirror')) % 2;
  const shift = (seed + offset) % 4;
  const ti = typeIndex(site, type) % 4;
  return mirror ? (shift - ti + 4) % 4 : (shift + ti) % 4;
}
function detailFrame(site, type, arch) {
  const frames = DETAIL_FRAMES[arch] ?? DETAIL_FRAMES.default;
  return frames[frameIndex(site, type, 'inner-detail')];
}
function listingFrame(site, type) {
  return LISTING_FRAMES[frameIndex(site, type, 'inner-listing')];
}
const listingType = page => String(page.pageId ?? '').match(/^listing-(.+)-(\d+)$/)?.[1] ?? 'item';
const listingNumber = page => Number(String(page.pageId ?? '').match(/-(\d+)$/)?.[1] ?? 1) || 1;

// ---------- small deterministic helpers ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}
const longDate = d => `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const shortDate = d => `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const TOWNS = ['Ashford', 'Brookdale', 'Cedarview', 'Elmwood', 'Fairhaven', 'Glenmont', 'Hazelton', 'Kingsbury', 'Lakeside', 'Maplewood', 'Millbrook', 'Northfield', 'Oakridge', 'Pinecrest', 'Riverside', 'Stonebridge', 'Westbury', 'Willowdale'];
const SURNAMES = ['Alvarez', 'Bennett', 'Chen', 'Delgado', 'Ellison', 'Farrow', 'Garcia', 'Hollis', 'Iverson', 'Jordan', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura', 'Okafor', 'Patel', 'Quinn', 'Reyes', 'Sato', 'Thornton', 'Underwood', 'Vasquez', 'Whitaker', 'Yilmaz'];
const FIRST = ['Ada', 'Brian', 'Carmen', 'Daniel', 'Elena', 'Felix', 'Grace', 'Hannah', 'Isaac', 'Julia', 'Kofi', 'Laura', 'Marcus', 'Nadia', 'Omar', 'Priya', 'Rosa', 'Samuel', 'Tara', 'Victor'];
const TOPIC_WORDS = new Set(['the', 'and', 'for', 'of', 'in', 'on', 'to', 'a', 'an', 'at', 'with', 'from', 'by', 'notes', 'guide', 'program', 'workshop', 'branch']);

function context(site, page, parts) {
  const type = page.kind === 'listing' ? listingType(page) : String(page.contentType ?? 'item');
  const arch = archetypeFor(site.domain, type);
  const fields = page.fields ?? {};
  const base = [...siteKey(site), page.pageId ?? page.url ?? ''];
  const r = (...k) => seedFor(...base, ...k);
  const s = (...k) => seedFor(...siteKey(site), ...k);
  const pick = (values, ...k) => values[r(...k) % values.length];
  const sample = (values, count, ...k) => values.map((value, i) => [r(...k, i), value]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(count, values.length)).map(([, value]) => value);
  const esc = typeof parts.esc === 'function' ? parts.esc : ESC;
  const relatedLabel = (page.links ?? []).find(link => link && !/^(previous|next) page$/i.test(String(link.label)))?.label;
  const imageField = page.image?.field;
  const fieldKeys = Object.keys(fields).filter(key => key !== 'title' && key !== imageField && fields[key] !== undefined && fields[key] !== null);
  const label = key => page.fieldLabels?.[key] ?? humanize(key);
  const dateKey = fieldKeys.find(key => parseDate(fields[key]));
  const date = dateKey ? parseDate(fields[dateKey]) : null;
  const title = String(page.title ?? fields.title ?? '');
  const words = title.split(/[^A-Za-z]+/).filter(w => w.length > 3 && !TOPIC_WORDS.has(w.toLowerCase()));
  const person = String(fields.name ?? fields.director ?? fields.manager ?? fields.author ?? relatedLabel ?? '');
  const phone = `(555) 01${s('phone-a') % 10}-${String(1000 + s('phone-b') % 9000)}`;
  const host = slugish(site.name).replace(/-(public|county|regional|free|of|the)-?/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'site';
  return {
    site, page, parts, type, arch, fields, r, s, pick, sample, esc, relatedLabel, fieldKeys, label, date, title, words, person, phone,
    email: prefix => `${prefix}@${host}.example`,
    town: (...k) => pick(TOWNS, 'town', ...k),
    fullName: (...k) => `${pick(FIRST, 'first', ...k)} ${pick(SURNAMES, 'last', ...k)}`,
    domain: site.domain,
    siteName: parts.siteName ?? site.name ?? '',
  };
}

// ---------- markup primitives ----------
const btn = (text, kind = 'secondary', extra = '') => `<button type="button" class="pg-btn pg-btn-${kind}${extra ? ` ${extra}` : ''}">${text}</button>`;
const badge = (text, tone = 'neutral') => `<span class="pg-badge pg-badge-${tone}">${text}</span>`;
const kv = rows => `<ul class="pg-kv">${rows.filter(row => row && row[1] !== undefined && row[1] !== null && row[1] !== '').map(([k, v]) => `<li><span class="pg-k">${k}</span> <span class="pg-v">${v}</span></li>`).join('')}</ul>`;
const chips = (values, cls = '') => `<ul class="pg-chips${cls ? ` ${cls}` : ''}">${values.map(v => `<li>${v}</li>`).join('')}</ul>`;
const bullets = values => `<ul class="pg-bullets">${values.map(v => `<li>${v}</li>`).join('')}</ul>`;
const steps = values => `<ol class="pg-steps">${values.map(([head, text]) => `<li><span class="pg-step-h">${head}</span><span class="pg-step-t">${text}</span></li>`).join('')}</ol>`;
const table = (head, rows, cls = '') => `<div class="pg-table-wrap"><table class="pg-table${cls ? ` ${cls}` : ''}"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const stats = values => `<ul class="pg-stats">${values.map(([n, t]) => `<li><span class="pg-stat-n">${n}</span><span class="pg-stat-t">${t}</span></li>`).join('')}</ul>`;
const initials = name => String(name).split(/\s+/).filter(Boolean).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const money = n => `$${n.toLocaleString('en-US')}`;

function shareBar(c, label = 'Share') {
  const sets = [['Email', 'Print', 'Copy link'], ['Share', 'Print'], ['Facebook', 'Bluesky', 'Email', 'Copy link'], ['Save', 'Share', 'Print']];
  return `<div class="pg-share" role="group" aria-label="${label}">${sets[c.r('share') % sets.length].map(t => btn(t, 'ghost', 'pg-btn-sm')).join('')}</div>`;
}
function updated(c) {
  const base = c.date ?? new Date(Date.UTC(2025, c.r('upd-m') % 12, 1 + c.r('upd-d') % 27));
  return addDays(base, 20 + c.r('upd') % 400);
}
function hoursRows(c) {
  const hours = String(c.fields.openingHours ?? '');
  const match = /^(\w+) to (\w+), (\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(hours);
  const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const fmt = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'a.m.' : 'p.m.'}`; };
  const from = match ? order.indexOf(match[1]) : 0;
  const to = match ? order.indexOf(match[2]) : 4;
  const open = match ? `${fmt(match[3])}–${fmt(match[4])}` : `${9 + c.r('h-o') % 2} a.m. – ${5 + c.r('h-c') % 4} p.m.`;
  const late = c.arch === 'place' && c.domain === 'library' && c.r('late') % 2 ? `${fmt("10:00")}–${fmt("20:00")}` : null;
  return order.map((day, i) => [day, i >= from && i <= to ? (late && i === 2 ? late : open) : (c.domain === 'library' && i === 6 && c.r('sun') % 2 ? '1 p.m. – 5 p.m.' : 'Closed')]);
}
function mapBox(c, address) {
  return `<div class="pg-map" role="img" aria-label="Map showing ${c.esc(address)}"><span class="pg-map-pin" aria-hidden="true"></span><span class="pg-map-label">${c.esc(address)}</span></div>`;
}
function newsletter(c, heading, text, idSuffix = 'nl') {
  const id = `pg-${idSuffix}-email`;
  return { title: heading, cls: 'pg-box-newsletter', body: `<p>${text}</p><form class="pg-inline-form" action="/" method="get"><label for="${id}" class="pg-sr">Email address</label><input id="${id}" type="email" name="email" placeholder="you@example.com" autocomplete="email">${btn('Sign up', 'primary')}</form>` };
}
function feedback(c) {
  return { title: 'Was this page helpful?', cls: 'pg-box-feedback', body: `<div class="pg-feedback">${btn('Yes', 'ghost', 'pg-btn-sm')}${btn('No', 'ghost', 'pg-btn-sm')}</div><p class="pg-note">Page last reviewed ${shortDate(updated(c))}.</p>` };
}
const TAG_POOLS = {
  library: ['Local history', 'Book clubs', 'Community', 'Reading', 'Families', 'Biography'], government: ['Residents', 'Funding', 'Regulations', 'Statewide', 'Public safety', 'Economy'],
  municipality: ['City services', 'Neighborhoods', 'Public notices', 'Streets', 'Parks'], university: ['Research', 'Faculty', 'Graduate study', 'Public engagement', 'Sustainability'],
  healthcare: ['Wellness', 'Prevention', 'Family health', 'Patient care', 'Nutrition'], documentation: ['API', 'SDK', 'Configuration'], museum: ['Collection', 'Design', 'Craft', 'Modern art', 'History'],
  nonprofit: ['Community', 'Volunteering', 'Food access', 'Equity', 'Partnerships'], records: ['Land records', 'Local government', 'Genealogy', 'Maps', 'Minutes'], news: ['Community', 'City Hall', 'Schools', 'Transportation', 'Business', 'Environment'],
};
function subjectTags(c, extra = []) {
  const pool = c.sample(TAG_POOLS[c.domain] ?? ['General'], 2, 'tags');
  return [...new Set([...pool, ...extra])].slice(0, 5).map(w => c.esc(w));
}

// ---------- archetype widgets ----------
// Each returns { meta, badges, action, facts, extras: [box, box], tags, details, mediaFirst }.
// Boxes are { title, body, cls }. "details" is the heading over the field list.
const WIDGETS = {
  catalog(c) {
    const { domain, type, fields: f, r, pick, esc } = c;
    const year = c.date?.getUTCFullYear() ?? 2018 + r('yr') % 7;
    if (domain === 'museum' || type === 'object') {
      const artist = c.relatedLabel ?? 'Unknown maker';
      const onView = r('view') % 3 !== 0;
      const gallery = `Gallery ${100 + r('gal') % 300}`;
      const made = `${pick(['c. ', '', 'about '], 'circa')}${1840 + r('made') % 170}`;
      const h = 12 + r('dim-h') % 80; const w = 8 + r('dim-w') % 60;
      return {
        meta: `${esc(artist)} · ${esc(made)}`,
        badges: [onView ? badge(`On view · ${gallery}`, 'ok') : badge('Not on view', 'neutral'), r('pd') % 2 ? badge('Open access', 'accent') : badge('Rights reserved')],
        action: { title: onView ? 'See it in the museum' : 'Collection access', body: `<p>${onView ? `${gallery}, Level ${1 + r('lvl') % 3}. Included with general admission.` : 'This object is in storage. Study-room appointments are available for researchers.'}</p><div class="pg-actions">${btn(onView ? 'Plan your visit' : 'Request an appointment', 'primary')}${btn('Download image')}</div>` },
        facts: { title: 'Object label', cls: 'pg-tombstone', body: `<p class="pg-tomb-artist">${esc(artist)}</p><p class="pg-tomb-title"><em>${esc(c.title)}</em>, ${esc(made)}</p><p>${esc(f.material ?? 'Mixed media')}</p><p>${h}.${r('h2') % 10} × ${w}.${r('w2') % 10} cm</p><p>${pick(['Gift of the', 'Purchased with funds from the', 'Bequest of the'], 'credit')} ${esc(pick(SURNAMES, 'credit-n'))} Family, ${1950 + r('acq') % 70}</p>${f.accessionNumber ? `<p class="pg-mono">${esc(f.accessionNumber)}</p>` : ''}` },
        extras: [
          { title: 'Provenance', body: bullets([`${esc(c.town('p1'))} workshop, until ${1890 + r('p1') % 60}`, `Private collection, ${esc(c.town('p2'))}`, `Acquired by the museum, ${1950 + r('acq') % 70}`]) },
          { title: 'Exhibition history', body: bullets([`<em>${esc(pick(['Makers and Materials', 'Hand and Machine', 'Objects of Everyday Life', 'Surface and Form'], 'ex1'))}</em>, ${2000 + r('ex1y') % 24}`, `<em>${esc(pick(['New Acquisitions', 'The Collection Revealed', 'Close Looking'], 'ex2'))}</em>, ${1995 + r('ex2y') % 20}`]) },
        ],
        tags: subjectTags(c, [esc(pick(['Ceramics', 'Textiles', 'Prints', 'Design', 'Sculpture', 'Photography'], 'dept'))]),
        details: 'About this object',
        mediaFirst: true,
      };
    }
    if (domain === 'records' || type === 'record') {
      const box = 1 + r('box') % 60; const folder = 1 + r('folder') % 30;
      return {
        meta: `Public record · ${year}`,
        badges: [r('dig') % 3 ? badge('Digitized', 'ok') : badge('Paper original only'), badge('Open to the public', 'accent')],
        action: { title: 'Request a copy', body: `<p>Plain copies are ${money(0)}.${String(25 + r('fee') % 50).padStart(2, '0')} per page; certified copies $${4 + r('cert') % 6}.00.</p><div class="pg-actions">${btn('Request a copy', 'primary')}${btn('Add to research cart')}</div>` },
        facts: { title: 'Location in the archives', body: kv([['Series', esc(c.relatedLabel ?? 'General records')], ['Box', String(box)], ['Folder', String(folder)], ['Format', pick(['Bound volume', 'Loose papers', 'Microfilm reel', 'Oversize map'], 'fmt')], ['Extent', `${2 + r('pg') % 80} pages`]]) },
        extras: [
          { title: 'How to cite this record', body: `<p class="pg-cite">${esc(c.title)}, ${year}. ${esc(f.recordNumber ?? '')} Box ${box}, Folder ${folder}. ${esc(c.siteName)}.</p>${btn('Copy citation', 'ghost', 'pg-btn-sm')}` },
          { title: 'Reproduction and use', body: `<p>Most public records may be copied and reused. Some records contain personal information that is redacted before release.</p>` },
        ],
        tags: subjectTags(c, ['Public records']),
        details: 'Record description',
      };
    }
    if (domain === 'news' || type === 'edition') {
      const pages = 24 + r('pp') % 40;
      return {
        meta: `${pick(['Morning', 'Weekend', 'Sunday'], 'ed')} edition · ${pages} pages`,
        badges: [badge('Print edition', 'accent'), badge('E-edition available', 'ok')],
        action: { title: 'Read this edition', body: `<p>Subscribers can read the full replica edition online.</p><div class="pg-actions">${btn('Open e-edition', 'primary')}${btn(`Buy back issue · $${2 + r('price') % 4}.50`)}</div>` },
        facts: { title: 'Edition details', body: kv([['Sections', String(4 + r('sec') % 5)], ['Pages', String(pages)], ['Format', 'Broadsheet'], ['Price', `$${2 + r('price') % 4}.50`]]) },
        extras: [
          { title: 'In this issue', body: bullets(c.sample(['Council weighs new transit plan', 'High school robotics team heads to state', 'Harbor restoration enters final phase', 'Arts grants announced for spring season', 'Letters: readers on the library levy', 'Obituaries and remembrances', 'Weekend weather and tides', 'Sports: playoff preview'], 4, 'issue').map(esc)) },
          newsletter(c, 'Get the front page by email', 'A morning briefing with the day’s top local stories.', 'ed'),
        ],
        tags: ['News', 'Archive', String(year)],
        details: 'About this edition',
        mediaFirst: true,
      };
    }
    if (domain === 'government' || /publication/.test(type)) return WIDGETS.document(c);
    // library book (default catalog item)
    const surname = String(f.author ?? c.relatedLabel ?? 'Staff').split(/\s+/).pop().replace(/[^A-Za-z-]/g, '');
    const fiction = r('fic') % 2 === 0;
    const call = fiction ? `FIC ${surname.toUpperCase().slice(0, 8)}` : `${100 + r('dew') % 800}.${r('dew2') % 100} ${surname.toUpperCase().slice(0, 3)}`;
    const copies = 2 + r('copies') % 6; const available = r('avail') % (copies + 1); const holds = available ? 0 : 1 + r('holds') % 9;
    const formats = c.sample(['Book', 'eBook', 'Audiobook', 'Large print', 'Book club kit'], 2 + r('fmts') % 2, 'fmt');
    if (!formats.includes('Book')) formats[0] = 'Book';
    const branches = c.sample(['Central Library', ...TOWNS.slice(0, 8).map(t => `${t} Branch`)], 3, 'br');
    const rating = (3.6 + (r('rate') % 14) / 10).toFixed(1);
    c.cover = `<div class="pg-media pg-cover-ph" aria-hidden="true"><span class="pg-cover-title">${esc(c.title)}</span><span class="pg-cover-author">${esc(f.author ?? c.relatedLabel ?? '')}</span></div>`;
    return {
      meta: `${esc(formats[0])} · ${year} · English`,
      badges: [...formats.map(fmt => badge(esc(fmt), fmt === 'Book' ? 'accent' : 'neutral')), ...(year >= 2024 ? [badge('New', 'warn')] : [])],
      action: { title: 'Availability', cls: 'pg-avail', body: `<p class="pg-status ${available ? 'pg-status-ok' : 'pg-status-warn'}">${available ? 'Available' : 'All copies in use'}</p><p>${available ? `${available} of ${copies} copies available` : `${holds} ${holds === 1 ? 'hold' : 'holds'} on ${copies} copies`}</p><p class="pg-mono">${esc(call)}</p><div class="pg-actions">${btn('Place hold', 'primary')}${btn('Add to list')}</div>` },
      facts: { title: 'Item details', body: kv([['Call number', `<span class="pg-mono">${esc(call)}</span>`], ['Format', esc(formats.join(', '))], ['Pages', String(140 + r('pages') % 380)], ['Publisher', esc(pick(['Harbor Lane Press', 'Northlight Books', 'Kestrel House', 'Bramble & Finch', 'Old Mill Editions'], 'pub'))], ['Audience', pick(['Adult', 'Adult', 'Teen', 'All ages'], 'aud')], ['Language', 'English']]) },
      extras: [
        { title: 'Where to find it', body: table(['Location', 'Collection', 'Status'], branches.map((branch, i) => [esc(branch), fiction ? 'Adult Fiction' : 'Adult Nonfiction', i < available ? '<span class="pg-status-ok">Available</span>' : `Due ${shortDate(addDays(c.date ?? new Date(Date.UTC(2025, 3, 1)), 30 + r('due', i) % 300))}`])) },
        { title: 'Community reviews', body: `<p class="pg-rating"><span class="pg-stars" aria-hidden="true">★★★★☆</span> ${rating} out of 5 · ${4 + r('nrev') % 60} ratings</p><blockquote class="pg-quote">“${esc(pick(['A quiet book that stays with you.', 'Our book club talked about it for weeks.', 'Beautifully researched and easy to read.', 'Couldn’t put it down.'], 'quote'))}”<cite>${esc(c.fullName('rev'))}</cite></blockquote>` },
      ],
      tags: subjectTags(c, [fiction ? 'Fiction' : 'Nonfiction', 'Local interest']),
      details: 'Summary and details',
      mediaFirst: true,
    };
  },

  person(c) {
    const { domain, type, r, pick, esc } = c;
    const name = c.person || c.title;
    const avatar = `<div class="pg-avatar" aria-hidden="true">${esc(initials(name))}</div>`;
    const first = name.split(/\s+/)[0] ?? '';
    const last = name.split(/\s+/).slice(-1)[0] ?? '';
    const mail = c.email(`${first[0] ?? 'x'}${last}`.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14) || 'contact');
    if (domain === 'healthcare' || type === 'provider') {
      const accepting = r('acc') % 3 !== 0;
      const locations = c.sample([`${c.town('l1')} Clinic`, `${c.town('l2')} Medical Office`, 'Main Hospital Campus', `${c.town('l3')} Family Care`], 2, 'loc');
      return {
        avatar, meta: esc(c.fields.specialty ?? 'Primary care'),
        badges: [accepting ? badge('Accepting new patients', 'ok') : badge('Not accepting new patients', 'warn'), ...(r('tele') % 2 ? [badge('Video visits available', 'accent')] : [])],
        action: { title: 'Make an appointment', body: `<p>Existing patients can book online. New patients call <strong>${c.phone}</strong>.</p><div class="pg-actions">${btn('Book appointment', 'primary')}${btn('Call the office')}</div>` },
        facts: { title: 'At a glance', body: kv([['Languages', pick(['English', 'English, Spanish', 'English, Mandarin', 'English, French'], 'lang')], ['Gender', pick(['Female', 'Male'], 'gender')], ['Years in practice', String(4 + r('yrs') % 28)], ['Board certified', 'Yes']]) },
        extras: [
          { title: 'Locations', body: locations.map((loc, i) => `<div class="pg-loc"><h3>${esc(loc)}</h3><p>${100 + r('addr', i) % 8900} ${esc(pick(['Main', 'Elm', 'Harbor', 'Park', 'Mill'], 'st', i))} Street, ${esc(c.town('lt', i))}</p><p>${c.phone}</p></div>`).join('') },
          { title: 'Patient ratings', body: `<p class="pg-rating"><span class="pg-stars" aria-hidden="true">★★★★★</span> ${(4.5 + (r('pr') % 5) / 10).toFixed(1)} out of 5</p><p class="pg-note">Based on ${60 + r('npr') % 400} verified patient surveys.</p>` },
        ],
        tags: ['Insurance: most plans accepted', 'Wheelchair accessible'],
        details: 'Profile',
      };
    }
    if (domain === 'university' || type === 'faculty') {
      const dept = pick(['Environmental Systems', 'Urban Design', 'History', 'Public Policy', 'Mathematics', 'Materials Science', 'Computer Science'], 'dept');
      const rank = pick(['Professor', 'Associate Professor', 'Assistant Professor', 'Senior Lecturer', 'Distinguished Professor'], 'rank');
      return {
        avatar, meta: `${esc(rank)}, Department of ${esc(dept)}`,
        badges: [badge(esc(rank), 'accent'), ...(r('lab') % 2 ? [badge('Accepting graduate students', 'ok')] : [])],
        action: { title: 'Contact', body: kv([['Email', `<span class="pg-mono">${esc(mail)}</span>`], ['Phone', c.phone], ['Office', `${pick(['Harlow', 'Whitman', 'Bayer', 'Linden'], 'hall')} Hall ${100 + r('room') % 400}`], ['Office hours', pick(['Tue 2–4 p.m.', 'Mon & Wed 10–11 a.m.', 'Thu 1–3 p.m.', 'By appointment'], 'oh')]]) },
        facts: { title: 'Education', body: bullets([`PhD, ${esc(c.town('phd'))} University, ${1990 + r('phd') % 25}`, `MA, University of ${esc(c.town('ma'))}, ${1985 + r('ma') % 25}`, `BA, ${esc(c.town('ba'))} College`]) },
        extras: [
          { title: 'Research areas', body: chips(subjectTags(c, c.sample(['Climate adaptation', 'Data methods', 'Public history', 'Urban systems', 'Policy design', 'Materials'], 3, 'ra').map(esc)), 'pg-chips-lg') },
          { title: 'Selected publications', body: `<ol class="pg-pubs">${[0, 1, 2].map(i => `<li>${esc(last)}, ${esc(first[0] ?? '')}. (${2016 + r('pubyr', i) % 9}). ${esc(pick(['Measuring change in', 'Rethinking', 'A comparative study of', 'Toward a theory of'], 'pubt', i))} ${esc(pick(['coastal systems', 'civic data', 'urban form', 'regional archives', 'public space'], 'pubs', i))}. <em>${esc(pick(['Journal of Applied Studies', 'Review of Regional Research', 'Annals of Policy'], 'pubj', i))}</em>, ${10 + r('vol', i) % 40}(${1 + r('iss', i) % 4}).</li>`).join('')}</ol>` },
        ],
        tags: [],
        details: 'Biography',
      };
    }
    if (domain === 'news' || type === 'journalist') {
      return {
        avatar, meta: esc(c.fields.beat ?? 'Staff writer'),
        badges: [badge(pick(['Staff writer', 'Senior reporter', 'Columnist', 'Editor'], 'role'), 'accent')],
        action: { title: `Contact ${esc(first)}`, body: kv([['Email', `<span class="pg-mono">${esc(mail)}</span>`], ['Phone', c.phone]]) + `<div class="pg-actions">${btn('Follow', 'primary')}${btn('Send a secure tip')}</div>` },
        facts: { title: 'About', body: kv([['Joined', String(2008 + r('joined') % 16)], ['Based in', esc(c.town('base'))], ['Covers', esc(c.fields.beat ?? 'Local news')]]) },
        extras: [
          newsletter(c, `Get ${esc(first)}’s stories by email`, 'New stories from this writer, delivered when they publish.', 'jr'),
          { title: 'Ethics and corrections', body: `<p>Our reporters follow the newsroom’s ethics policy. To report an error, email <span class="pg-mono">${esc(c.email('corrections'))}</span>.</p>` },
        ],
        tags: [],
        details: 'Biography',
      };
    }
    if (domain === 'museum' || type === 'creator') {
      const born = 1820 + r('born') % 150; const died = born + 40 + r('life') % 50;
      const life = died < 2020 ? `${born}–${died}` : `born ${born}`;
      return {
        avatar, meta: `${esc(pick(['American', 'Canadian', 'British', 'Danish', 'Japanese', 'Mexican'], 'nat'))}, ${life}`,
        badges: [badge(pick(['Artist', 'Designer', 'Photographer', 'Ceramicist', 'Printmaker'], 'role'), 'accent'), badge(`${2 + r('works') % 40} works in the collection`)],
        action: { title: 'In the collection', body: `<p>${2 + r('works') % 40} objects by ${esc(name)} are in the collection, ${r('onview') % 4} currently on view.</p><div class="pg-actions">${btn('Browse works', 'primary')}${btn('Follow artist')}</div>` },
        facts: { title: 'Life dates', body: kv([['Born', `${born}, ${esc(c.town('bp'))}`], ...(died < 2020 ? [['Died', `${died}, ${esc(c.town('dp'))}`]] : []), ['Active', `${born + 20}–${Math.min(died, 2024)}`]]) },
        extras: [
          { title: 'Exhibitions', body: bullets([0, 1, 2].map(i => `<em>${esc(pick(['Material Worlds', 'Line and Light', 'Forms in Space', 'A Modern Eye', 'Working Hands'], 'exh', i))}</em>, ${1990 + r('exy', i) % 34}`)) },
          { title: 'Related movements', body: chips(c.sample(['Modernism', 'Arts and Crafts', 'Studio pottery', 'Bauhaus', 'Documentary photography', 'Abstraction'], 3, 'mv')) },
        ],
        tags: [],
        details: 'Biography',
      };
    }
    // library author (default)
    return {
      avatar, meta: `${esc(c.fields.region ?? c.town('reg'))} author`,
      badges: [r('local') % 3 ? badge('Local author', 'accent') : badge('Visiting author', 'accent'), badge(`${1 + r('titles') % 14} titles in the catalog`)],
      action: { title: 'Bring this author to your group', body: `<p>Book clubs and schools can request an author visit through the library.</p><div class="pg-actions">${btn('Request a visit', 'primary')}${btn('Follow author')}</div>` },
      facts: { title: 'Author facts', body: kv([['Genres', esc(c.sample(['Literary fiction', 'Local history', 'Poetry', 'Memoir', 'Mystery', 'Nature writing'], 2, 'gen').join(', '))], ['Titles in catalog', String(1 + r('titles') % 14)], ['First published', String(1985 + r('first') % 35)]]) },
      extras: [
        { title: 'Awards and honors', body: bullets([`${esc(pick(['Regional Book Award', 'Harbor Prize', 'State Literary Medal', 'Readers’ Choice'], 'aw1'))}, ${2010 + r('aw1y') % 15}`, `${esc(pick(['Library Notable Book', 'Best Local History', 'Booksellers’ Pick'], 'aw2'))}, ${2005 + r('aw2y') % 18}`]) },
        { title: 'Upcoming appearances', body: `<p>${esc(c.town('ap'))} Branch · ${MONTHS[r('apm') % 12]} ${1 + r('apd') % 27} · 7 p.m.</p><p class="pg-note">Free; registration opens two weeks before.</p>` },
      ],
      tags: [],
      details: 'About the author',
    };
  },

  event(c) {
    const { domain, type, fields: f, r, pick, esc } = c;
    const d = c.date;
    const dateBadge = d ? `<div class="pg-datebadge" aria-hidden="true"><span class="pg-db-m">${MONTHS[d.getUTCMonth()].slice(0, 3)}</span><span class="pg-db-d">${d.getUTCDate()}</span><span class="pg-db-w">${DAYS[d.getUTCDay()].slice(0, 3)}</span></div>` : '';
    const where = esc(f.location ?? c.relatedLabel ?? c.siteName);
    if (domain === 'museum' || type === 'exhibition') {
      const end = parseDate(f.endDate);
      const range = d ? `${shortDate(d)}${end ? ` – ${shortDate(end)}` : ''}` : 'Dates to be announced';
      const adult = 18 + r('adm') % 10;
      return {
        dateBadge, meta: range,
        badges: [badge(pick(['Special exhibition', 'Collection display', 'Touring exhibition'], 'kind'), 'accent'), r('free') % 3 ? badge('Members see it free', 'ok') : badge('Timed tickets', 'warn')],
        action: { title: 'Tickets', body: `<ul class="pg-prices"><li><span>Adults</span><span>$${adult}</span></li><li><span>Seniors and students</span><span>$${adult - 6}</span></li><li><span>Members and under 18</span><span>Free</span></li></ul><div class="pg-actions">${btn('Get tickets', 'primary')}${btn('Become a member')}</div>` },
        facts: { title: 'Visit', body: kv([['Dates', range], ['Location', `Galleries ${1 + r('gal') % 8}–${9 + r('gal') % 6}, Level ${1 + r('lv') % 3}`], ['Hours', pick(['Tue–Sun 10 a.m.–5 p.m.', 'Wed–Mon 10 a.m.–6 p.m.', 'Daily 9:30 a.m.–5:30 p.m.'], 'hrs')], ['Audio guide', 'Free on your phone']]) },
        extras: [
          { title: 'Exhibition highlights', body: stats([[String(40 + r('works') % 160), 'works on view'], [String(3 + r('lenders') % 20), 'lenders'], [String(2 + r('rooms') % 6), 'galleries']]) },
          { title: 'Support', body: `<p>This exhibition is organized by ${esc(c.siteName)} with support from the ${esc(pick(SURNAMES, 'sp'))} Foundation and ${esc(c.town('sp2'))} Arts Council.</p>` },
        ],
        tags: subjectTags(c, ['Exhibitions']),
        details: 'About the exhibition',
        mediaFirst: true,
      };
    }
    if (domain === 'municipality' || type === 'meeting') {
      const body = pick(['City Council', 'Planning Commission', 'Parks and Recreation Board', 'Transportation Committee', 'Zoning Board of Appeals'], 'body');
      return {
        dateBadge, meta: `${esc(body)} · ${pick(['Regular meeting', 'Special meeting', 'Work session'], 'mt')}`,
        badges: [badge('Open to the public', 'ok'), r('live') % 2 ? badge('Livestreamed', 'accent') : badge('Hybrid meeting', 'accent')],
        action: { title: 'Participate', body: `<p>Public comment is accepted in person, online, or by email to <span class="pg-mono">${esc(c.email('clerk'))}</span> until noon on the meeting day.</p><div class="pg-actions">${btn('Watch live', 'primary')}${btn('Submit a comment')}${btn('Download agenda (PDF)', 'ghost')}</div>` },
        facts: { title: 'Meeting details', body: kv([['Date', d ? longDate(d) : ''], ['Time', pick(['6:00 p.m.', '6:30 p.m.', '7:00 p.m.', '5:30 p.m.'], 'time')], ['Location', where], ['Room', pick(['Council Chambers', 'Room 201', 'Community Room A'], 'room')], ['Webinar ID', `<span class="pg-mono">${800 + r('w1') % 199} ${1000 + r('w2') % 8999} ${1000 + r('w3') % 8999}</span>`]]) },
        extras: [
          { title: 'Agenda items', body: `<ol class="pg-agenda">${c.sample(['Call to order and roll call', 'Approval of minutes', 'Public comment', 'Consent calendar', 'Public hearing: zoning amendment', 'Budget update from the finance director', 'Report on street resurfacing', 'Adjournment'], 5, 'ag').map(item => `<li>${esc(item)}</li>`).join('')}</ol>` },
          { title: 'Accessibility', body: `<p>Interpretation and assistive listening devices are available. Request accommodations 48 hours in advance by calling ${c.phone}.</p>` },
        ],
        tags: ['Public meetings', esc(body)],
        details: 'Meeting information',
      };
    }
    // library event (default)
    const start = 9 + r('start') % 9; const len = 1 + r('len') % 2; const fmt = h => `${h % 12 || 12}:${pick(['00', '30'], 'min')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
    const seats = 10 + r('seats') % 40; const left = r('left') % seats;
    const audience = pick(['All ages', 'Adults', 'Teens', 'Kids 3–5', 'Families', 'Seniors'], 'aud');
    const reg = r('reg') % 3 !== 0;
    return {
      dateBadge, meta: `${d ? longDate(d) : ''} · ${fmt(start)} – ${fmt(start + len)}`,
      badges: [badge('Free event', 'ok'), badge(esc(audience), 'accent'), ...(reg ? [badge(left ? 'Registration required' : 'Waitlist only', 'warn')] : [badge('Drop-in')])],
      action: { title: reg ? 'Registration' : 'Drop in', cls: 'pg-register', body: reg ? `<p><strong>${left}</strong> of ${seats} spots remaining</p><div class="pg-meter pg-meter-${Math.round(10 * (seats - left) / seats)}" aria-hidden="true"><span></span></div><div class="pg-actions">${btn(left ? 'Register' : 'Join waitlist', 'primary')}${btn('Add to calendar')}</div>` : `<p>No registration needed. Seating is first come, first served.</p><div class="pg-actions">${btn('Add to calendar', 'primary')}</div>` },
      facts: { title: 'When and where', body: kv([['Date', d ? longDate(d) : ''], ['Time', `${fmt(start)} – ${fmt(start + len)}`], ['Location', where], ['Room', pick(['Community Room', 'Story Room', 'Maker Lab', 'Auditorium', 'Teen Space'], 'room')], ['Audience', esc(audience)], ['Cost', 'Free']]) },
      extras: [
        { title: 'Hosted by', body: `<p>${esc(c.relatedLabel ?? `${c.town('host')} Branch`)}</p><p class="pg-note">Questions? Call ${c.phone} or ask at any service desk.</p>` },
        { title: 'Accessibility', body: `<p>This room is wheelchair accessible. ASL interpretation is available with one week’s notice.</p>` },
      ],
      tags: [esc(pick(['Books and reading', 'Learning', 'Crafts', 'Technology', 'Local history', 'Storytime'], 'cat')), esc(audience)],
      details: 'Event details',
    };
  },

  place(c) {
    const { domain, type, fields: f, r, pick, esc } = c;
    const address = String(f.address ?? f.location ?? `${100 + r('addr') % 900} Main Street`);
    const rows = hoursRows(c);
    const hours = `<ul class="pg-hours">${rows.map(([day, time]) => `<li${time === 'Closed' ? ' class="pg-closed"' : ''}><span class="pg-day">${day}</span><span class="pg-time">${time}</span></li>`).join('')}</ul>`;
    const amenitySets = {
      library: ['Free Wi-Fi', 'Public computers', 'Printing and copying', 'Study rooms', 'Children’s area', 'Book drop', 'Free parking', 'Meeting rooms', 'Maker space'],
      healthcare: ['On-site lab', 'Imaging', 'Pharmacy', 'Free parking', 'Wheelchair accessible', 'Interpreter services', 'Telehealth', 'Same-day visits'],
      records: ['Reading room', 'Microfilm readers', 'Scanning station', 'Lockers', 'Wheelchair accessible', 'Research help'],
      default: ['Wheelchair accessible', 'Public parking', 'Bike racks', 'Transit nearby', 'Pay online', 'Interpreter services', 'Notary service'],
    };
    const amenities = c.sample(amenitySets[domain] ?? amenitySets.default, 5, 'am');
    const amenityList = `<ul class="pg-amenities">${amenities.map(a => `<li><span class="pg-icon" aria-hidden="true">${esc(a[0])}</span>${esc(a)}</li>`).join('')}</ul>`;
    const actions = {
      library: [btn('Reserve a room', 'primary'), btn('Get directions')],
      healthcare: [btn('Schedule a visit', 'primary'), btn('Get directions')],
      records: [btn('Book a research appointment', 'primary'), btn('Get directions')],
      government: [btn('Contact the office', 'primary'), btn('Subscribe to updates')],
      municipality: [btn('Make an appointment', 'primary'), btn('Get directions')],
    };
    const manager = f.manager ?? f.director;
    const contactRows = [['Phone', c.phone], ['Email', `<span class="pg-mono">${esc(c.email(slugish(c.title).split('-')[0] || 'info'))}</span>`], ...(manager ? [[domain === 'government' ? 'Director' : 'Manager', esc(manager)]] : []), ['Parking', pick(['Free lot behind the building', 'Street parking and garage on 2nd Ave', 'Accessible spaces at the main entrance'], 'park')], ['Transit', `Bus routes ${1 + r('b1') % 20} and ${21 + r('b2') % 40}`]];
    const today = domain === 'healthcare' ? `<p class="pg-note">Current wait for walk-ins: about ${10 + r('wait') % 50} minutes</p>` : '';
    const extraB = domain === 'library'
      ? { title: 'Coming up at this location', body: bullets([`Storytime · ${DAYS[1 + r('e1') % 5]}s at 10:30 a.m.`, `Tech help drop-in · ${DAYS[1 + r('e2') % 5]}s at 2 p.m.`, `Book club · first ${DAYS[1 + r('e3') % 5]} of the month`]) }
      : domain === 'government'
        ? { title: 'Divisions', body: bullets(c.sample(['Administration', 'Field Operations', 'Grants Management', 'Compliance and Enforcement', 'Policy and Planning', 'Public Information'], 4, 'div')) }
        : domain === 'healthcare'
          ? { title: 'Care at this location', body: chips(c.sample(['Primary care', 'Pediatrics', 'Women’s health', 'Lab services', 'Physical therapy', 'Behavioral health', 'Vaccines'], 5, 'care')) }
          : { title: 'Services offered here', body: bullets(c.sample(['Permits and licenses', 'Payments', 'Records requests', 'Notary', 'Voter registration', 'Copies and certifications'], 4, 'svc')) };
    return {
      meta: esc(address),
      badges: [badge(domain === 'healthcare' ? 'Walk-ins welcome' : domain === 'library' ? pick(['Open 7 days', 'Open late Wednesdays', 'Holds pickup'], 'lb') : 'Public office', 'accent'), ...(r('acc') % 2 ? [badge('Accessible entrance', 'ok')] : [])],
      action: { title: domain === 'government' ? 'Contact us' : 'Visit', body: `${mapBox(c, address)}<div class="pg-actions">${(actions[domain] ?? actions.municipality).join('')}</div>` },
      facts: { title: 'Hours', cls: 'pg-box-hours', body: `${hours}${today}<p class="pg-note">Holiday hours may vary.</p>` },
      extras: [
        { title: domain === 'records' ? 'Research facilities' : domain === 'government' ? 'Contact information' : 'Amenities', body: domain === 'government' ? kv(contactRows) : amenityList },
        domain === 'government' ? extraB : { title: 'Contact and getting here', body: kv(contactRows) },
        ...(domain === 'government' ? [] : [extraB]),
      ],
      tags: [],
      details: domain === 'government' ? 'About the office' : 'Location details',
      mediaFirst: domain !== 'government',
    };
  },

  article(c) {
    const { domain, type, r, pick, esc } = c;
    const d = c.date;
    const author = c.relatedLabel ?? (domain === 'healthcare' ? `${c.fullName('rev')}, MD` : c.fullName('by'));
    const minutes = 3 + r('min') % 12;
    const dateline = esc(c.town('dl')).toUpperCase();
    if (domain === 'university' || type === 'research') {
      const doi = `10.5555/${slugish(c.siteName).slice(0, 6)}.${2018 + r('doi') % 8}.${1000 + r('doi2') % 9000}`;
      return {
        byline: `<p class="pg-byline">By <strong>${esc(author)}</strong>${d ? ` · ${shortDate(d)}` : ''}</p>`,
        meta: `${pick(['Research news', 'Study', 'Discovery'], 'kind')} · ${minutes} min read`,
        badges: [badge(r('oa') % 2 ? 'Open access' : 'Peer reviewed', 'ok'), badge(pick(['School of Engineering', 'Faculty of Arts', 'School of Public Policy', 'College of Science'], 'school'), 'accent')],
        action: { title: 'Read the paper', body: kv([['Journal', `<em>${esc(pick(['Journal of Applied Studies', 'Regional Science Review', 'Annals of Public Research'], 'jn'))}</em>`], ['DOI', `<span class="pg-mono">${esc(doi)}</span>`]]) + `<div class="pg-actions">${btn('Download PDF', 'primary')}${btn('Cite')}</div>` },
        facts: { title: 'Media contact', body: `<p>${esc(c.fullName('mc'))}<br>University Communications<br><span class="pg-mono">${esc(c.email('news'))}</span><br>${c.phone}</p>` },
        extras: [newsletter(c, 'Research news in your inbox', 'A weekly digest of discoveries from across the university.', 'rs'), { title: 'Keywords', body: chips(subjectTags(c, ['Research'])) }],
        tags: subjectTags(c, ['Research']),
        details: 'About the research',
        share: shareBar(c),
      };
    }
    if (domain === 'healthcare') {
      return {
        byline: `<p class="pg-byline">Medically reviewed by <strong>${esc(author)}</strong>${d ? ` · Updated ${shortDate(updated(c))}` : ''}</p>`,
        meta: `Health library · ${minutes} min read`,
        badges: [badge('Health library', 'accent'), badge(esc(c.fields.audience ?? 'For patients and families'))],
        action: { title: 'Talk to someone', body: `<p>Questions about your care? Our nurse line is open 24 hours a day.</p><p class="pg-phone">${c.phone}</p><div class="pg-actions">${btn('Find a doctor', 'primary')}${btn('Request an appointment')}</div>` },
        facts: { title: 'In this article', body: `<ul class="pg-toc">${c.fieldKeys.map(key => `<li><a href="#pg-details">${esc(c.label(key))}</a></li>`).join('')}</ul>` },
        extras: [newsletter(c, 'Healthy living, delivered', 'Tips from our clinicians, once a month.', 'hl'), feedback(c)],
        tags: subjectTags(c, ['Wellness']),
        details: 'Overview',
        share: shareBar(c),
      };
    }
    const section = pick(['Local News', 'Politics', 'Business', 'Education', 'Arts & Culture', 'Environment'], 'sec');
    const feature = type === 'feature';
    return {
      byline: `<p class="pg-byline">By <strong>${esc(author)}</strong></p><p class="pg-dateline">${d ? `Published ${longDate(d)}` : ''}${r('upd') % 2 && d ? ` · Updated ${shortDate(addDays(d, 1))}` : ''}</p>`,
      meta: `${dateline} — ${minutes} min read`,
      badges: [badge(esc(section), 'accent'), ...(feature ? [badge('Long read')] : r('brk') % 5 === 0 ? [badge('Developing', 'warn')] : [])],
      action: { title: 'Support local journalism', cls: 'pg-box-subscribe', body: `<p>Get unlimited access to ${esc(c.siteName)} for ${pick(['$1 for 6 months', '$2 a week', '99¢ for the first month'], 'offer')}.</p><div class="pg-actions">${btn('Subscribe', 'primary')}</div>` },
      facts: { title: 'Most read', body: `<ol class="pg-mostread">${c.sample(['School board approves new start times', 'Ferry service to resume next month', 'Downtown bakery celebrates 50 years', 'What the new zoning rules mean for you', 'Storm cleanup continues along the coast', 'Students win statewide history prize'], 4, 'mr').map(t => `<li>${esc(t)}</li>`).join('')}</ol>` },
      extras: [newsletter(c, 'The Morning Briefing', 'The day’s top local stories, every weekday at 6 a.m.', 'mb'), { title: 'Corrections', body: `<p>Spotted an error? Email <span class="pg-mono">${esc(c.email('corrections'))}</span>.</p>` }],
      tags: subjectTags(c, [section]),
      details: feature ? 'The story' : 'Article',
      share: shareBar(c),
    };
  },

  service(c) {
    const { domain, type, fields: f, r, pick, esc } = c;
    const d = c.date;
    if (domain === 'university' && type === 'course') {
      const days = pick(['Mon/Wed/Fri', 'Tue/Thu', 'Mon/Wed', 'Thursday'], 'days');
      return {
        meta: `${esc(f.courseCode ?? '')} · ${esc(f.credits ?? '3')} credits`,
        badges: [badge(pick(['Fall 2026', 'Spring 2027', 'Fall 2026 · Spring 2027'], 'term'), 'accent'), badge(pick(['Undergraduate', 'Graduate', 'Undergraduate and graduate'], 'lvl')), ...(r('seat') % 3 ? [] : [badge('Waitlist', 'warn')])],
        action: { title: 'Enrollment', body: `<p>Seats available: <strong>${r('seats') % 40}</strong> of ${40 + r('cap') % 80}</p><div class="pg-actions">${btn('Add to planner', 'primary')}${btn('View textbooks')}</div>` },
        facts: { title: 'Course facts', cls: 'pg-box-facts', body: kv([['Course code', `<span class="pg-mono">${esc(f.courseCode ?? '')}</span>`], ['Credits', esc(f.credits ?? '3')], ['Schedule', `${days} ${pick(['9:00–10:15', '10:30–11:45', '1:00–2:15', '3:30–4:45'], 'time')}`], ['Format', pick(['In person', 'Hybrid', 'Online'], 'fmt')], ['Instructor', esc(c.relatedLabel ?? 'Staff')], ['Grading', pick(['Letter grade', 'Letter or pass/fail'], 'grade')]]) },
        extras: [
          { title: 'Prerequisites', body: bullets([`${esc(String(f.courseCode ?? 'XXX 100').replace(/\d+/, n => String(Math.max(100, Number(n) - 100))))} or equivalent`, pick(['Sophomore standing', 'Permission of instructor', 'Completion of the writing requirement'], 'pre')]) },
          { title: 'Fulfills', body: chips(c.sample(['Quantitative reasoning', 'Writing intensive', 'Major elective', 'Core curriculum', 'Sustainability minor'], 2, 'ful')) },
        ],
        tags: [], details: 'Course description',
      };
    }
    if (domain === 'university') {
      return {
        meta: esc(f.qualification ?? 'Degree program'),
        badges: [badge(esc(f.qualification ?? 'Bachelor’s'), 'accent'), badge(pick(['Full time', 'Full or part time'], 'ft')), badge(pick(['On campus', 'Online available'], 'mode'), 'ok')],
        action: { title: 'Ready to apply?', body: `<p>Applications for ${pick(['fall', 'spring'], 'intake')} entry close ${pick(['January 15', 'March 1', 'November 30'], 'close')}.</p><div class="pg-actions">${btn('Apply now', 'primary')}${btn('Request information')}${btn('Visit campus', 'ghost')}</div>` },
        facts: { title: 'Program at a glance', cls: 'pg-box-facts', body: stats([[esc(String(f.duration ?? '4 years').replace(/ full-time| full time/, '')), 'duration'], [`${12 + r('size') % 20}:1`, 'student to faculty'], [`${88 + r('emp') % 11}%`, 'employed or in graduate study']]) },
        extras: [
          { title: 'How to apply', body: steps([['Check requirements', 'Review entry requirements and deadlines for your intake.'], ['Submit your application', 'Apply online and upload transcripts and a statement.'], ['Interview or portfolio', 'Some programs invite applicants to an interview.'], ['Receive your decision', 'Decisions are released within eight weeks.']]) },
          { title: 'Tuition and aid', body: `<p>Estimated tuition ${money(18000 + r('tui') % 30000)} per year. ${60 + r('aid') % 35}% of students receive financial aid.</p>` },
        ],
        tags: [], details: 'Program overview',
      };
    }
    if (domain === 'healthcare') {
      return {
        meta: 'Services and treatments',
        badges: [badge(r('ref') % 2 ? 'No referral needed' : 'Referral required', r('ref') % 2 ? 'ok' : 'warn'), badge('Most insurance accepted', 'accent')],
        action: { title: 'Request an appointment', body: `<p>Call <strong>${c.phone}</strong> or request online. We’ll contact you within one business day.</p><div class="pg-actions">${btn('Request appointment', 'primary')}${btn('Find a location')}</div>` },
        facts: { title: 'Quick facts', body: stats([[String(2 + r('locs') % 9), 'locations'], [String(5 + r('prov') % 40), 'specialists'], [`${1 + r('wait') % 9} days`, 'typical wait']]) },
        extras: [
          { title: 'What to expect', body: steps([['Before your visit', 'Bring your insurance card, a photo ID and a list of medicines.'], ['During your visit', 'Your care team reviews your history and goals with you.'], ['After your visit', 'Results and next steps appear in your patient portal.']]) },
          { title: 'Conditions we treat', body: chips(c.sample(['Chronic pain', 'Diabetes', 'Heart health', 'Sports injuries', 'Sleep problems', 'Allergies', 'Asthma'], 4, 'cond')) },
        ],
        tags: [], details: 'About this service',
      };
    }
    if (domain === 'nonprofit') {
      if (type === 'grant') {
        const amount = String(f.awardAmount ?? money(5000 + r('amt') % 45000));
        return {
          meta: `Funding opportunity${d ? ` · Deadline ${shortDate(d)}` : ''}`,
          badges: [badge(r('open') % 3 ? 'Open for applications' : 'Closing soon', r('open') % 3 ? 'ok' : 'warn'), badge('Grant', 'accent')],
          action: { title: 'Apply for this grant', body: `<p class="pg-big">${esc(amount)}</p><p>${d ? `Applications due ${longDate(d)}` : 'Rolling deadline'}</p><div class="pg-actions">${btn('Start application', 'primary')}${btn('Download guidelines (PDF)')}</div>` },
          facts: { title: 'Grant cycle', body: steps([['Letter of inquiry', 'A one-page summary of your project.'], ['Full proposal', 'Invited applicants submit budgets and outcomes.'], ['Review', 'Community panel review takes six weeks.'], ['Award', 'Funds are released within 30 days.']]) },
          extras: [{ title: 'Questions?', body: `<p>Program officer: ${esc(c.fullName('po'))}<br><span class="pg-mono">${esc(c.email('grants'))}</span><br>${c.phone}</p>` }, { title: 'Past grantees', body: stats([[String(12 + r('gr') % 60), 'organizations funded last year'], [money(200000 + r('tot') % 900000), 'awarded since 2020']]) }],
          tags: [], details: 'Eligibility and details',
        };
      }
      if (type === 'opportunity') {
        return {
          meta: `Volunteer · ${esc(f.location ?? c.town('vol'))}`,
          badges: [badge(pick(['Weekly', 'Flexible schedule', 'One-time'], 'sch'), 'accent'), badge(pick(['Ages 16+', 'Ages 18+', 'Family friendly'], 'age')), badge('Training provided', 'ok')],
          action: { title: 'Sign up to volunteer', body: `<p>${2 + r('slots') % 20} shifts open this month.</p><div class="pg-actions">${btn('Sign up', 'primary')}${btn('Share with a friend')}</div>` },
          facts: { title: 'Shift details', body: kv([['Time commitment', pick(['2–4 hours a week', '3 hours a month', 'One Saturday'], 'tc')], ['Shifts', pick(['Weekday mornings', 'Evenings', 'Weekends'], 'sh')], ['Background check', r('bg') % 2 ? 'Required' : 'Not required']]) },
          extras: [{ title: 'Volunteer impact', body: stats([[String(300 + r('vols') % 900), 'volunteers last year'], [(8000 + r('hrs') % 30000).toLocaleString('en-US'), 'hours given']]) }, { title: 'Volunteer coordinator', body: `<p>${esc(c.fullName('vc'))}<br><span class="pg-mono">${esc(c.email('volunteer'))}</span></p>` }],
          tags: [], details: 'About the role',
        };
      }
      return {
        meta: `Project · ${esc(f.location ?? c.town('proj'))}`,
        badges: [badge(pick(['Active project', 'Expanding', 'Pilot'], 'st'), 'ok'), badge('Community-led', 'accent')],
        action: { title: 'Support this project', cls: 'pg-donate', body: `<div class="pg-amounts" role="group" aria-label="Donation amount">${['$25', '$50', '$100', '$250'].map((a, i) => btn(a, i === 1 ? 'primary' : 'secondary')).join('')}</div><div class="pg-actions">${btn('Donate now', 'primary')}</div><p class="pg-note">Gifts are tax-deductible.</p>` },
        facts: { title: 'Impact so far', cls: 'pg-box-impact', body: stats([[(1000 + r('ppl') % 9000).toLocaleString('en-US'), 'people served'], [String(10 + r('partners') % 40), 'local partners'], [`${70 + r('pct') % 28}%`, 'of funds go to programs']]) },
        extras: [{ title: 'Project timeline', body: steps([[String(2019 + r('t1') % 3), 'Neighborhood listening sessions'], [String(2022 + r('t2') % 2), 'Pilot launched with partners'], [String(2024 + r('t3') % 2), 'Expanded to new sites']]) }, { title: 'Partners', body: chips(c.sample([`${c.town('pa')} Schools`, 'County Health Department', `${c.town('pb')} Food Bank`, 'Public Library', 'Rotary Club', 'Parks Department'], 4, 'pt').map(esc)) }],
        tags: [], details: 'About the project',
      };
    }
    if (domain === 'museum') {
      return {
        meta: esc(f.audience ?? 'Learning resource'),
        badges: [badge(esc(f.audience ?? 'All ages'), 'accent'), badge('Free resource', 'ok')],
        action: { title: 'Bring a group', body: `<p>Guided school visits are free for public schools. Book at least three weeks ahead.</p><div class="pg-actions">${btn('Book a school visit', 'primary')}${btn('Download activity (PDF)')}</div>` },
        facts: { title: 'At a glance', body: kv([['Duration', pick(['45 minutes', '60 minutes', '90 minutes'], 'dur')], ['Group size', `Up to ${20 + r('grp') % 15}`], ['Subjects', pick(['Art, History', 'Science, Design', 'Literacy, Art'], 'sub')], ['Format', pick(['In the galleries', 'In your classroom', 'Online'], 'fmt')]]) },
        extras: [{ title: 'Curriculum connections', body: chips(c.sample(['Visual arts', 'Social studies', 'Language arts', 'STEM', 'Local history'], 3, 'cur')) }, { title: 'Contact the learning team', body: `<p><span class="pg-mono">${esc(c.email('learning'))}</span><br>${c.phone}</p>` }],
        tags: [], details: 'About this resource',
      };
    }
    // government program / municipal service (default)
    const muni = domain === 'municipality';
    return {
      meta: muni ? `Service · ${esc(f.serviceArea ?? 'Citywide')}` : `Program${d ? ` · Apply by ${shortDate(d)}` : ''}`,
      badges: muni ? [badge(pick(['Available online', 'Online or in person', 'In person'], 'ch'), 'ok'), badge(pick(['311 service', 'Permit', 'Request'], 'kind'), 'accent')] : [badge(r('open') % 4 ? 'Accepting applications' : 'Closing soon', r('open') % 4 ? 'ok' : 'warn'), badge(pick(['Grant', 'Rebate', 'Loan', 'Assistance'], 'kind'), 'accent')],
      action: { title: muni ? 'Request this service' : 'How to apply', cls: 'pg-callout', body: `<p>${muni ? `Submit a request online, call 311 or ${c.phone}, or visit ${esc(c.relatedLabel ?? 'City Hall')}.` : `Apply online through the state portal. Paper applications are available from ${esc(c.relatedLabel ?? 'the agency')}.`}</p><div class="pg-actions">${btn(muni ? 'Start a request' : 'Apply now', 'primary')}${btn(muni ? 'Check request status' : 'Check application status')}</div>` },
      facts: { title: 'At a glance', cls: 'pg-box-facts', body: kv(muni ? [['Fee', pick(['Free', '$25', '$45', '$75 plus $10 per inspection'], 'fee')], ['Processing time', pick(['3–5 business days', '5–10 business days', 'Same day'], 'pt')], ['Department', esc(c.relatedLabel ?? 'City Services')], ['Available', pick(['Online, by phone, in person', 'Online only', 'In person'], 'av')]] : [['Funding', `Up to ${money(1000 * (2 + r('fund') % 48))}`], ['Deadline', d ? longDate(d) : 'Rolling'], ['Agency', esc(c.relatedLabel ?? c.siteName)], ['Who can apply', pick(['Residents', 'Small businesses', 'Nonprofits and local governments', 'Homeowners and renters'], 'who')]]) },
      extras: [
        { title: muni ? 'Steps' : 'Eligibility checklist', body: muni ? steps([['Gather your information', 'Have your address and any permit or account number ready.'], ['Submit your request', 'Use the online form or call 311.'], ['Track progress', 'You’ll get a reference number and email updates.']]) : steps([['Check eligibility', 'Review income, residency and project requirements.'], ['Gather documents', 'Proof of identity, address and income.'], ['Submit your application', 'Apply online or by mail before the deadline.'], ['Get a decision', 'Most applicants hear back within 30 days.']]) },
        muni ? feedback(c) : { title: 'Documents you’ll need', body: `<ul class="pg-checklist">${['Photo ID', 'Proof of address', 'Recent tax return or pay stubs', 'Project estimate, if applicable'].map(t => `<li>${t}</li>`).join('')}</ul>` },
      ],
      tags: [], details: muni ? 'Service details' : 'Program details',
    };
  },

  document(c) {
    const { domain, type, fields: f, r, pick, esc } = c;
    const d = c.date;
    const number = f.policyNumber ?? f.documentNumber ?? f.reference ?? `${type.slice(0, 3).toUpperCase()}-${1000 + r('no') % 9000}`;
    const size = `${120 + r('kb') % 2800} KB`;
    const notice = domain === 'municipality';
    const report = domain === 'nonprofit';
    const versions = d ? [[shortDate(d), 'Current version', 'In effect'], [shortDate(addDays(d, -(200 + r('v1') % 400))), 'Revised', 'Superseded'], [shortDate(addDays(d, -(800 + r('v2') % 900))), 'Adopted', 'Superseded']] : [];
    return {
      meta: `${report ? 'Annual report' : notice ? 'Public notice' : type === 'policy' ? 'Policy' : 'Publication'} · <span class="pg-mono">${esc(number)}</span>`,
      badges: [badge(notice ? pick(['Legal notice', 'Public hearing', 'Service change'], 'nt') : report ? 'Report' : type === 'policy' ? 'In effect' : 'Publication', notice ? 'warn' : 'ok'), badge(`PDF · ${size}`), ...(r('acc') % 2 ? [badge('Accessible version', 'accent')] : [])],
      action: { title: report ? 'Read the report' : 'Download', body: `<p>${esc(c.title)} (PDF, ${size}, ${4 + r('pages') % 80} pages)</p><div class="pg-actions">${btn('Download PDF', 'primary')}${btn('Print')}${btn(notice ? 'Get notices by email' : 'Subscribe to updates', 'ghost')}</div>` },
      facts: { title: 'Document information', cls: 'pg-box-facts', body: kv([['Number', `<span class="pg-mono">${esc(number)}</span>`], [notice || report ? 'Published' : type === 'policy' ? 'Effective' : 'Published', d ? longDate(d) : ''], ['Issued by', esc(c.relatedLabel ?? c.siteName)], ['Language', pick(['English', 'English, Spanish', 'English, Spanish, Vietnamese'], 'lang')]]) },
      extras: report
        ? [{ title: 'Key figures', body: stats([[money(100000 + r('raised') % 4000000), 'raised'], [(2000 + r('served') % 40000).toLocaleString('en-US'), 'neighbors reached'], [String(20 + r('grants') % 120), 'grants awarded']]) }, feedback(c)]
        : notice
          ? [{ title: 'Comment period', cls: 'pg-callout', body: `<p>Written comments are accepted for ${pick(['14', '21', '30'], 'days')} days after publication. Send comments to <span class="pg-mono">${esc(c.email('clerk'))}</span> and include the reference number.</p>` }, feedback(c)]
          : [{ title: 'Version history', body: versions.length ? table(['Date', 'Action', 'Status'], versions) : '<p>No earlier versions.</p>' }, feedback(c)],
      tags: subjectTags(c),
      details: report ? 'Summary' : notice ? 'Notice' : 'Overview',
    };
  },

  collection(c) {
    const { type, fields: f, r, pick, esc } = c;
    const boxes = 3 + r('boxes') % 80;
    const range = f.dateRange ?? `${1880 + r('y1') % 60}–${1950 + r('y2') % 60}`;
    const series = c.sample(['Correspondence', 'Minutes and proceedings', 'Financial records', 'Maps and plans', 'Photographs', 'Reports', 'Legal files', 'Clippings'], 3 + r('ns') % 3, 'series');
    const aid = type === 'findingAid';
    return {
      meta: `${aid ? 'Finding aid' : 'Collection'} · ${(boxes / 2).toFixed(1)} linear feet`,
      badges: [badge(r('open') % 4 ? 'Open for research' : 'Partially restricted', r('open') % 4 ? 'ok' : 'warn'), badge(aid ? 'Fully processed' : pick(['Fully processed', 'Partially digitized'], 'proc'), 'accent')],
      action: { title: 'Use this collection', body: `<p>Materials are stored offsite. Request boxes two business days before your reading room visit.</p><div class="pg-actions">${btn('Request materials', 'primary')}${btn('Book a reading room visit')}</div>` },
      facts: { title: 'Collection summary', cls: 'pg-box-summary', body: kv([['Creator', esc(c.relatedLabel ?? f.custodian ?? c.siteName)], ['Dates', esc(range)], ['Extent', `${(boxes / 2).toFixed(1)} linear feet (${boxes} boxes)`], ['Language', pick(['English', 'English and French', 'English and German'], 'lang')], ['Repository', esc(c.siteName)], ['Call number', `<span class="pg-mono">${esc(f.reference ?? `MS ${100 + r('ms') % 900}`)}</span>`]]) },
      extras: [
        { title: 'Series overview', body: `<ol class="pg-series">${series.map((name, i) => `<li><span class="pg-series-h">Series ${['I', 'II', 'III', 'IV', 'V'][i]}: ${esc(name)}</span><span class="pg-series-t">${1890 + r('sy', i) % 50}–${1945 + r('sz', i) % 70} · ${1 + r('sb', i) % 20} boxes</span></li>`).join('')}</ol>` },
        { title: 'Container list', body: table(['Box', 'Folder', 'Contents'], [0, 1, 2, 3].map(i => [String(1 + i), `${1 + i * 4}–${4 + i * 4}`, esc(`${series[i % series.length]}, ${1900 + r('cy', i) % 80}`)])) },
        { title: 'Preferred citation', body: `<p class="pg-cite">[Item], ${esc(c.title)}, ${esc(range)}. ${esc(c.siteName)}.</p>${btn('Copy citation', 'ghost', 'pg-btn-sm')}` },
      ],
      tags: subjectTags(c, ['Local government', 'Archives']),
      details: aid ? 'Collection guide' : 'Scope and content',
    };
  },

  docs(c) {
    const { type, fields: f, r, pick, esc } = c;
    const groups = [['Get started', ['Overview', 'Quickstart', 'Authentication', 'Core concepts']], ['Guides', ['Data synchronization', 'Request validation', 'Webhooks', 'Caching', 'Batch jobs']], ['API reference', ['Clients', 'Events', 'Records', 'Errors']], ['Resources', ['Release notes', 'Tutorials', 'Migration guide', 'Status']]];
    const active = { guide: 1, reference: 2, release: 3, tutorial: 3 }[type] ?? 1;
    const tree = `<nav class="pg-doctree" aria-label="Documentation sections">${groups.map(([group, items], gi) => `<details${gi === active || gi === 0 ? ' open' : ''}><summary>${group}</summary><ul>${(gi === active ? [...items.slice(0, 2), c.title, ...items.slice(2, 3)] : items).map(item => `<li${item === c.title ? ' class="pg-current" aria-current="page"' : ''}>${esc(item)}</li>`).join('')}</ul></details>`).join('')}</nav>`;
    const version = `v${2 + r('maj') % 3}.${r('min') % 10}`;
    const method = pick(['GET', 'POST', 'PATCH', 'DELETE', 'GET'], 'method');
    const ident = String(f.identifier ?? 'records.list');
    const code = type === 'reference'
      ? `curl -X ${method} https://api.${slugish(c.siteName).split('-')[0]}.example/v${2 + r('maj') % 3}/${esc(ident.replace(/\./g, '/'))} \\\n  -H "Authorization: Bearer $API_TOKEN"`
      : type === 'release' ? `npm install @${slugish(c.siteName).split('-')[0]}/sdk@${esc(String(f.version ?? version).replace(/^v/, ''))}`
        : `import { Client } from '@${slugish(c.siteName).split('-')[0]}/sdk';\n\nconst client = new Client({ token: process.env.API_TOKEN });\nawait client.${pick(['sync', 'records', 'events', 'jobs'], 'obj')}.${pick(['start', 'list', 'create', 'validate'], 'fn')}();`;
    const pn = (label, text) => `<div class="pg-pn-item"><span class="pg-pn-label">${label}</span><span class="pg-pn-title">${esc(text)}</span></div>`;
    return {
      tree,
      meta: `Last updated ${shortDate(updated(c))} · ${3 + r('read') % 12} min read`,
      badges: type === 'reference' ? [badge(method, 'accent', 'pg-mono'), badge(r('beta') % 4 ? 'Stable' : 'Beta', r('beta') % 4 ? 'ok' : 'warn')]
        : type === 'release' ? [badge(r('latest') % 3 ? 'Release' : 'Latest', 'ok'), badge(r('brk') % 3 ? 'No breaking changes' : 'Breaking changes', r('brk') % 3 ? 'neutral' : 'warn')]
          : type === 'tutorial' ? [badge(esc(f.difficulty ?? 'Beginner'), 'accent'), badge(`${10 + r('mins') % 40} min`)]
            : [badge('Guide', 'accent')],
      toolbar: `<div class="pg-doctools"><label class="pg-version">Version <select name="version">${[version, `v${1 + r('maj') % 3}.${(r('min') + 3) % 10}`, 'v1.x'].map(v => `<option>${v}</option>`).join('')}</select></label>${btn('Copy page', 'ghost', 'pg-btn-sm')}${btn('Edit this page', 'ghost', 'pg-btn-sm')}</div>`,
      code: `<figure class="pg-code"><figcaption>${type === 'reference' ? 'Request' : type === 'release' ? 'Install' : 'Example'}</figcaption><pre><code>${code}</code></pre></figure>`,
      callout: `<div class="pg-admonition pg-adm-${pick(['note', 'tip', 'warning'], 'adm')}"><p class="pg-adm-title">${pick(['Note', 'Tip', 'Important'], 'admt')}</p><p>${esc(pick(['Requests are rate limited to 600 per minute per token.', 'Use a sandbox token while you test your integration.', 'All timestamps are returned in UTC using ISO 8601.', 'Retries are safe for idempotent requests.'], 'admx'))}</p></div>`,
      prevnext: `<div class="pg-prevnext" aria-label="Pages in this section">${pn('Previous', pick(['Quickstart', 'Core concepts', 'Authentication'], 'prev'))}${pn('Next', pick(['Webhooks', 'Errors', 'Batch jobs', 'Migration guide'], 'next'))}</div>`,
      feedback: feedback(c),
      details: type === 'reference' ? 'Parameters and response' : type === 'release' ? 'What changed' : 'Overview',
    };
  },

  generic(c) {
    return {
      meta: `Updated ${shortDate(updated(c))}`,
      badges: [badge(c.esc(c.parts.typeLabel ?? humanize(c.type)), 'accent')],
      action: { title: 'Contact', body: `<p>${c.esc(c.siteName)}<br>${c.phone}</p><div class="pg-actions">${btn('Print', 'secondary')}${btn('Share')}</div>` },
      facts: { title: 'Page information', body: kv([['Section', c.esc(c.parts.sectionLabel ?? '')], ['Last reviewed', shortDate(updated(c))]]) },
      extras: [feedback(c)],
      tags: [],
      details: 'Details',
    };
  },
};

// ---------- frames ----------
function boxHtml(box, id, level = 'h2') {
  if (!box) return '';
  return `<section class="pg-box${box.cls ? ` ${box.cls}` : ''}"${id ? ` id="${id}"` : ''}><${level} class="pg-box-title">${box.title}</${level}>${box.body}</section>`;
}
function fieldsSection(c, w) {
  return `<section class="pg-fields" id="pg-details"><h2 class="pg-h">${c.esc(w.details)}</h2>${c.parts.fields ?? ''}</section>`;
}
const relatedSection = c => `<div class="pg-related" id="pg-related">${c.parts.related ?? ''}</div>`;
function media(c, cls = '') {
  if (!c.parts.image && c.cover && !c.mediaUsed) { c.mediaUsed = true; return c.cover; }
  if (!c.parts.image || c.mediaUsed) return '';
  c.mediaUsed = true;
  return `<div class="pg-media${cls ? ` ${cls}` : ''}">${c.parts.image}</div>`;
}
const badgeRow = w => (w.badges?.length ? `<div class="pg-badges">${w.badges.join('')}</div>` : '');
const metaLine = w => (w.meta ? `<p class="pg-meta">${w.meta}</p>` : '');
const tagBox = (c, w) => (w.tags?.length ? `<div class="pg-tags"><h2 class="pg-h pg-h-sm">${c.arch === 'article' ? 'Topics' : 'Subjects'}</h2>${chips(w.tags, 'pg-chips-tags')}</div>` : '');
function tocBox(c, w, extras) {
  const items = [...c.fieldKeys.map(key => [c.label(key), '#pg-details']), ...extras.map((box, i) => [box.title, `#pg-x${i}`])];
  if (c.parts.related) items.push(['Related', '#pg-related']);
  return `<nav class="pg-onpage" aria-label="On this page"><h2 class="pg-box-title">On this page</h2><ul class="pg-toc">${items.map(([text, href]) => `<li><a href="${href}">${c.esc(String(text).replace(/<[^>]+>/g, ''))}</a></li>`).join('')}</ul></nav>`;
}
const extrasHtml = (extras, level) => extras.map((box, i) => boxHtml(box, `pg-x${i}`, level)).join('');
function personHead(c, w) {
  if (!w.avatar) return `${metaLine(w)}${badgeRow(w)}`;
  const photo = c.parts.image && !c.mediaUsed ? media(c, 'pg-photo') : c.parts.image ? '' : w.avatar;
  return `<div class="pg-person-head${photo ? '' : ' pg-person-head-plain'}">${photo}<div>${metaLine(w)}${badgeRow(w)}</div></div>`;
}
const leadBlock = (c, w) => `${w.dateBadge ? `<div class="pg-when">${w.dateBadge}<div>${metaLine(w)}${badgeRow(w)}</div></div>` : personHead(c, w)}${w.byline ?? ''}${w.share ?? ''}`;

function pageExtras(c, w) {
  // Per-page variation: some pages drop the second extra box (seeded by page id).
  const extras = [...(w.extras ?? [])];
  if (extras.length > 1 && c.r('drop-extra') % 4 === 0) extras.pop();
  return extras;
}

const FRAMES = {
  rail(c, w) {
    const extras = pageExtras(c, w);
    const railMedia = w.mediaFirst && !w.avatar;
    return `<div class="pg-grid pg-grid-rail"><div class="pg-primary">${leadBlock(c, w)}${railMedia ? '' : media(c)}${fieldsSection(c, w)}${extras[0] ? boxHtml(extras[0], 'pg-x0') : ''}${tagBox(c, w)}</div><aside class="pg-rail" aria-label="${c.esc(c.parts.typeLabel ?? 'Details')} sidebar">${railMedia ? media(c) : ''}${boxHtml(w.action, 'pg-action')}${boxHtml(w.facts, 'pg-facts')}${extras.slice(1).map((box, i) => boxHtml(box, `pg-x${i + 1}`)).join('')}</aside></div>${relatedSection(c)}`;
  },
  hero(c, w) {
    const extras = pageExtras(c, w);
    const tabs = ['Overview', ...extras.map(box => box.title)].slice(0, 4);
    return `<div class="pg-hero">${media(c)}<div class="pg-hero-text">${leadBlock(c, w)}${boxHtml(w.action, 'pg-action', 'h2')}</div></div><div class="pg-tabs" role="group" aria-label="Sections">${tabs.map((t, i) => `<a class="pg-tab${i === 0 ? ' pg-tab-current' : ''}" href="${i === 0 ? '#pg-details' : `#pg-x${i - 1}`}">${String(t).replace(/<[^>]+>/g, '')}</a>`).join('')}</div><div class="pg-grid pg-grid-hero"><div class="pg-primary">${fieldsSection(c, w)}${tagBox(c, w)}</div><aside class="pg-rail">${boxHtml(w.facts, 'pg-facts')}</aside></div><div class="pg-cards">${extrasHtml(extras)}</div>${relatedSection(c)}`;
  },
  left(c, w) {
    const extras = pageExtras(c, w);
    return `<div class="pg-grid pg-grid-left"><aside class="pg-rail pg-rail-left">${media(c)}${tocBox(c, w, extras)}${boxHtml(w.facts, 'pg-facts')}</aside><div class="pg-primary">${leadBlock(c, w)}${boxHtml({ ...w.action, cls: `${w.action?.cls ?? ''} pg-banner`.trim() }, 'pg-action')}${fieldsSection(c, w)}${extrasHtml(extras)}${tagBox(c, w)}${relatedSection(c)}</div></div>`;
  },
  column(c, w) {
    const extras = pageExtras(c, w);
    return `<div class="pg-column"><div class="pg-column-head">${leadBlock(c, w)}</div>${media(c)}${fieldsSection(c, w)}<div class="pg-band">${boxHtml(w.action, 'pg-action')}${boxHtml(w.facts, 'pg-facts')}</div>${extrasHtml(extras)}${tagBox(c, w)}${relatedSection(c)}</div>`;
  },
};

// Documentation pages: always a docs layout, four different arrangements of tree, TOC and tools.
const DOC_FRAMES = {
  three(c, w) {
    return `<div class="pg-docs pg-docs-three"><aside class="pg-docs-nav">${w.tree}</aside><div class="pg-docs-body">${w.toolbar}${metaLine(w)}${badgeRow(w)}${w.callout}${fieldsSection(c, w)}${w.code}${media(c)}${w.prevnext}${boxHtml(w.feedback, 'pg-x0')}${relatedSection(c)}</div><aside class="pg-docs-toc">${tocBox(c, w, [w.feedback])}</aside></div>`;
  },
  left(c, w) {
    return `<div class="pg-docs pg-docs-left"><aside class="pg-docs-nav">${w.tree}${media(c)}</aside><div class="pg-docs-body">${w.toolbar}${badgeRow(w)}${metaLine(w)}${tocBox(c, w, [w.feedback])}${fieldsSection(c, w)}${w.callout}${w.code}${relatedSection(c)}${w.prevnext}${boxHtml(w.feedback, 'pg-x0')}</div></div>`;
  },
  rail(c, w) {
    return `<div class="pg-docs pg-docs-right"><div class="pg-docs-body">${w.toolbar}${badgeRow(w)}${fieldsSection(c, w)}${w.code}${w.callout}${relatedSection(c)}${w.prevnext}</div><aside class="pg-docs-toc">${tocBox(c, w, [w.feedback])}${metaLine(w)}${media(c)}${boxHtml(w.feedback, 'pg-x0')}</aside></div>`;
  },
  column(c, w) {
    return `<div class="pg-docs pg-docs-column"><div class="pg-docs-head">${badgeRow(w)}${metaLine(w)}${w.toolbar}</div><details class="pg-docs-mobile-tree"><summary>Browse this section</summary>${w.tree}</details>${w.code}${fieldsSection(c, w)}${w.callout}${media(c)}${boxHtml(w.feedback, 'pg-x0')}${w.prevnext}${relatedSection(c)}</div>`;
  },
};

export function innerLookClasses(site, page) {
  const skin = skinFor(site);
  if (page.kind === 'listing') {
    const type = listingType(page);
    return `inner-v-${skin} inner-listing inner-l-${listingFrame(site, type)} inner-a-${archetypeFor(site.domain, type)}`;
  }
  if (page.kind !== 'detail') return `inner-v-${skin}`;
  const type = String(page.contentType ?? 'item');
  const arch = archetypeFor(site.domain, type);
  return `inner-v-${skin} inner-detail inner-d-${detailFrame(site, type, arch)} inner-a-${arch}`;
}

export function renderDetailVariant(site, page, parts) {
  const c = context(site, page, parts);
  const frame = detailFrame(site, c.type, c.arch);
  const widgets = WIDGETS[c.arch](c);
  const body = c.arch === 'docs' ? DOC_FRAMES[frame](c, widgets) : FRAMES[frame](c, widgets);
  return `<div class="pg-inner pg-detail pg-skin-${skinFor(site)} pg-frame-${frame} pg-a-${c.arch} pg-t-${slugish(c.type)}">${body}</div>`;
}

// ---------- listing pages ----------
const FACETS = {
  catalog: { library: [['Format', ['Book', 'eBook', 'Audiobook', 'Large print', 'DVD']], ['Availability', ['Available now', 'On order']], ['Audience', ['Adult', 'Teen', 'Children']], ['Language', ['English', 'Spanish', 'French']]], museum: [['Department', ['Ceramics', 'Textiles', 'Prints and drawings', 'Design', 'Photography']], ['On view', ['On view', 'Not on view']], ['Date made', ['Before 1900', '1900–1950', '1950–2000', 'After 2000']], ['Rights', ['Open access', 'Rights reserved']]], records: [['Record type', ['Minutes', 'Maps and surveys', 'Reports', 'Correspondence']], ['Decade', ['1950s', '1970s', '1990s', '2010s']], ['Access', ['Digitized', 'Paper only']]], news: [['Year', ['2025', '2024', '2023', '2022']], ['Edition', ['Daily', 'Weekend', 'Special']]] },
  person: { library: [['Genre', ['Fiction', 'Local history', 'Poetry', 'Children’s', 'Memoir']], ['Region', ['Local', 'State', 'Visiting']]], university: [['Department', ['History', 'Engineering', 'Public Policy', 'Mathematics', 'Design']], ['Rank', ['Professor', 'Associate Professor', 'Assistant Professor', 'Lecturer']]], healthcare: [['Specialty', ['Family medicine', 'Pediatrics', 'Cardiology', 'Orthopedics', 'Dermatology']], ['Availability', ['Accepting new patients', 'Video visits']], ['Language', ['English', 'Spanish', 'Mandarin']]], museum: [['Role', ['Artist', 'Designer', 'Photographer', 'Maker']], ['Century', ['19th century', '20th century', '21st century']]], news: [['Desk', ['Metro', 'Politics', 'Business', 'Arts', 'Sports']]] },
  event: { library: [['Date', ['Today', 'This week', 'This month']], ['Event type', ['Storytime', 'Book club', 'Workshop', 'Author talk', 'Technology']], ['Age group', ['Kids', 'Teens', 'Adults', 'Families']], ['Location', ['Central Library', 'Branches', 'Online']]], municipality: [['Body', ['City Council', 'Planning Commission', 'Parks Board', 'Committees']], ['Type', ['Regular', 'Special', 'Work session']], ['Documents', ['Has agenda', 'Has minutes', 'Has video']]], museum: [['Status', ['On view', 'Upcoming', 'Past']], ['Type', ['Special exhibition', 'Collection display', 'Touring']]] },
  place: { library: [['Amenities', ['Study rooms', 'Maker space', 'Free parking', 'Open Sundays']], ['Area', ['North', 'South', 'East', 'West']]], healthcare: [['Location type', ['Clinic', 'Hospital', 'Urgent care', 'Lab']], ['Open', ['Evenings', 'Weekends', 'Walk-ins welcome']]], default: [['Service type', ['Permits', 'Payments', 'Records', 'Customer service']], ['Accessibility', ['Accessible entrance', 'Parking']]] },
  article: { news: [['Section', ['Local News', 'Politics', 'Business', 'Education', 'Arts']], ['Published', ['Past 24 hours', 'Past week', 'Past month', 'Past year']], ['Type', ['News', 'Analysis', 'Opinion']]], healthcare: [['Topic', ['Heart health', 'Nutrition', 'Children’s health', 'Mental health', 'Aging']], ['Audience', ['Patients', 'Caregivers', 'Parents']]], university: [['School', ['Engineering', 'Arts and Humanities', 'Public Policy', 'Science']], ['Type', ['Journal article', 'Report', 'Working paper']], ['Access', ['Open access', 'Subscription']]] },
  service: { government: [['Category', ['Housing', 'Energy', 'Business', 'Transportation', 'Workforce']], ['Status', ['Open', 'Closing soon', 'Closed']], ['Who can apply', ['Residents', 'Businesses', 'Nonprofits']]], municipality: [['Topic', ['Streets', 'Trash and recycling', 'Permits', 'Parks', 'Housing']], ['How to request', ['Online', 'By phone', 'In person']]], university: [['Level', ['Undergraduate', 'Graduate', 'Certificate']], ['Format', ['In person', 'Online', 'Hybrid']], ['Term', ['Fall 2026', 'Spring 2027', 'Summer 2027']]], healthcare: [['Specialty area', ['Primary care', 'Surgery', 'Women’s health', 'Behavioral health']], ['Referral', ['No referral needed', 'Referral required']]], nonprofit: [['Focus area', ['Food access', 'Education', 'Arts', 'Housing', 'Environment']], ['Status', ['Open', 'Upcoming', 'Closed']]], museum: [['Audience', ['Schools', 'Families', 'Adults', 'Teachers']], ['Format', ['In the galleries', 'Online', 'Classroom']]] },
  document: { default: [['Document type', ['Policy', 'Report', 'Fact sheet', 'Notice', 'Guidance']], ['Year', ['2025', '2024', '2023', '2022', 'Earlier']], ['Format', ['PDF', 'Web page']]] },
  collection: { default: [['Subject', ['Local government', 'Land and property', 'Transportation', 'Families', 'Business']], ['Date range', ['Before 1900', '1900–1949', '1950–1999', '2000–present']], ['Access', ['Open', 'Restricted', 'Digitized']]] },
  docs: { default: [['Product area', ['Core API', 'SDKs', 'Webhooks', 'Data sync']], ['Language', ['JavaScript', 'Python', 'Go', 'cURL']], ['Level', ['Beginner', 'Intermediate', 'Advanced']]] },
  generic: { default: [['Category', ['General', 'Featured', 'Archive']]] },
};
const SORTS = { catalog: ['Relevance', 'Title A–Z', 'Newest first', 'Date added'], person: ['Last name A–Z', 'Last name Z–A', 'Recently added'], event: ['Date: soonest first', 'Date: latest first', 'Title A–Z'], place: ['Name A–Z', 'Nearest first'], article: ['Newest first', 'Oldest first', 'Most read'], service: ['Most relevant', 'Title A–Z', 'Deadline'], document: ['Newest first', 'Oldest first', 'Title A–Z'], collection: ['Title A–Z', 'Date range', 'Recently processed'], docs: ['Recently updated', 'Title A–Z'], generic: ['Title A–Z', 'Newest first'] };
const INTRO = {
  catalog: 'Search and browse the catalog. Place holds on anything you find and pick it up at any location.', person: 'Browse profiles by name, area or role.', event: 'Free programs for every age. Most events are free and open to everyone.', place: 'Find hours, addresses and services for every location.', article: 'The latest stories, updated throughout the day.', service: 'Find the service or program you need, check eligibility and apply online.', document: 'Browse current documents. Older versions are kept in the archive.', collection: 'Browse collection guides and finding aids for materials held in our reading room.', docs: 'Guides, references and examples for building with the platform.', generic: 'Browse everything in this section.',
};

function facetGroups(c) {
  const sets = FACETS[c.arch] ?? FACETS.generic;
  return sets[c.domain] ?? sets.default ?? Object.values(sets)[0];
}
function resultInfo(c) {
  const page = c.page;
  const n = listingNumber(page);
  const items = page.repeatedItems?.length ?? (page.links ?? []).filter(link => link && !/^(previous|next) page$/i.test(String(link.label))).length;
  const size = Number(c.site.pageSize) || items || 1;
  const start = items ? (n - 1) * size + 1 : 0;
  const end = items ? start + items - 1 : 0;
  const hasNext = (page.links ?? []).some(link => /^next page$/i.test(String(link?.label)));
  return { n, items, start, end, hasNext, text: !items ? 'No results' : hasNext ? `Showing ${start}–${end} · Page ${n}` : `Showing ${start}–${end} of ${end} results` };
}
function facetForm(c, mode) {
  const groups = facetGroups(c);
  const info = resultInfo(c);
  const max = Math.max(3, info.items);
  const group = ([name, options], gi) => {
    const shown = options.map((option, oi) => {
      const id = `pg-f-${gi}-${oi}`;
      const count = 1 + c.r('facet', gi, oi) % max;
      const checked = mode === 'chips' ? false : c.r('checked', gi, oi) % 11 === 0;
      return `<li><input type="checkbox" id="${id}" name="${slugish(name)}" value="${slugish(option)}"${checked ? ' checked' : ''}><label for="${id}">${c.esc(option)} <span class="pg-count">(${count})</span></label></li>`;
    }).join('');
    return mode === 'accordion'
      ? `<details class="pg-facet"${gi < 2 ? ' open' : ''}><summary>${c.esc(name)}</summary><ul>${shown}</ul></details>`
      : `<fieldset class="pg-facet"><legend>${c.esc(name)}</legend><ul>${shown}</ul></fieldset>`;
  };
  return `<form class="pg-facets-form" action="/" method="get" aria-label="Filter results"><h2 class="pg-box-title">${mode === 'accordion' ? 'Filter' : 'Refine results'}</h2>${groups.map(group).join('')}<div class="pg-actions">${btn('Apply filters', 'primary', 'pg-btn-sm')}${btn('Clear all', 'ghost', 'pg-btn-sm')}</div></form>`;
}
function toolbar(c, { view = true } = {}) {
  const info = resultInfo(c);
  const sorts = SORTS[c.arch] ?? SORTS.generic;
  const selected = c.s('sort', c.type) % sorts.length;
  return `<div class="pg-toolbar"><p class="pg-result-count" role="status">${info.text}</p><form class="pg-sort" action="/" method="get"><label for="pg-sort">Sort by</label><select id="pg-sort" name="sort">${sorts.map((s, i) => `<option${i === selected ? ' selected' : ''}>${s}</option>`).join('')}</select></form>${view ? `<div class="pg-viewtoggle" role="group" aria-label="View">${btn('Grid', c.view === 'grid' ? 'primary' : 'ghost', 'pg-btn-sm')}${btn('List', c.view === 'grid' ? 'ghost' : 'primary', 'pg-btn-sm')}</div>` : ''}</div>`;
}
function pagerSummary(c) {
  const info = resultInfo(c);
  return `<p class="pg-pageinfo">Page ${info.n}${info.hasNext ? '' : ' (last page)'} · ${info.items} ${info.items === 1 ? 'item' : 'items'} on this page</p>`;
}
function helpBox(c) {
  const titles = { catalog: 'Can’t find it?', person: 'Looking for someone?', event: 'Host an event', place: 'Need help?', article: 'Got a news tip?', service: 'Need help applying?', document: 'Need an older version?', collection: 'Ask an archivist', docs: 'Need help?', generic: 'Questions?' };
  const bodies = { catalog: 'Suggest a purchase or borrow it from another library through interlibrary loan.', person: 'Call our main line and we’ll connect you.', event: 'Community groups can book meeting rooms for free.', place: 'Call any location during open hours.', article: `Email ${c.esc(c.email('tips'))} or call the newsroom.`, service: 'Our staff can help by phone or in person.', document: 'Submit a public records request for documents not listed here.', collection: 'Reference staff answer questions by email within three business days.', docs: 'Ask in the community forum or open a support ticket.', generic: 'Get in touch with our team.' };
  const byDomain = { museum: ['Ask a curator', 'Collections staff answer object enquiries and image requests by email.'], records: ['Ask an archivist', 'Reference staff can search unindexed records for you.'], news: ['Looking for a back issue?', 'Order printed back issues or reprints from our circulation desk.'], government: ['Need a printed copy?', 'Request alternative formats or printed copies from our publications office.'] };
  const [title, body] = (c.arch === 'catalog' || c.arch === 'document') && byDomain[c.domain] ? byDomain[c.domain] : [titles[c.arch] ?? titles.generic, bodies[c.arch] ?? bodies.generic];
  return `<section class="pg-box pg-box-help"><h2 class="pg-box-title">${title}</h2><p>${body}</p><p class="pg-phone">${c.arch === 'docs' ? '<span class="pg-mono">support@docs.example</span>' : c.phone}</p></section>`;
}
function keywordBar(c) {
  const groups = facetGroups(c);
  const selects = groups.slice(0, 2).map(([name, options], gi) => `<label class="pg-field"><span>${c.esc(name)}</span><select name="${slugish(name)}"><option>Any</option>${options.map(o => `<option>${c.esc(o)}</option>`).join('')}</select></label>`).join('');
  return `<form class="pg-filterbar" action="/" method="get" aria-label="Search this section"><label class="pg-field pg-field-grow"><span>Keyword</span><input type="search" name="q" placeholder="Search ${c.esc(c.parts.sectionLabel ?? 'this section')}"></label>${selects}${btn('Search', 'primary')}</form>`;
}
function activeChips(c) {
  const groups = facetGroups(c);
  const picks = groups.slice(0, 3).map(([, options], gi) => options[c.r('chip', gi) % options.length]).slice(0, 1 + c.r('nchips') % 2);
  return `<div class="pg-active" aria-label="Active filters"><span class="pg-active-label">Filtered by:</span>${picks.map(p => btn(`${c.esc(p)} <span aria-hidden="true">×</span>`, 'chip', 'pg-btn-sm')).join('')}${btn('Clear all', 'ghost', 'pg-btn-sm')}</div>`;
}
function alphaBar(c) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return `<div class="pg-alpha" role="group" aria-label="Jump to letter">${letters.map(l => `<button type="button" class="pg-alpha-l">${l}</button>`).join('')}</div>`;
}
function categoryPills(c) {
  const groups = facetGroups(c);
  return `<div class="pg-pills" role="group" aria-label="Browse by category">${btn('All', 'primary', 'pg-btn-sm')}${(groups[0]?.[1] ?? []).map(o => btn(c.esc(o), 'chip', 'pg-btn-sm')).join('')}</div>`;
}
function promo(c) {
  const copy = { catalog: ['Staff picks', c.domain === 'museum' ? 'Chosen by our curators this month.' : c.domain === 'library' ? 'Hand-picked by our librarians this month.' : 'Selected by our staff this month.'], person: ['Featured profile', 'Meet one of the people behind our work.'], event: ['Featured this month', 'Highlights from the calendar.'], place: ['Plan your visit', 'Accessible entrances, parking and transit at every location.'], article: ['Editor\u2019s pick', 'Our best reporting, chosen by the editors.'], service: ['Featured', 'Popular with residents this month.'], document: ['Featured document', 'The most requested document this month.'], collection: ['From the collections', 'Recently processed and newly available.'], docs: ['What\u2019s new', 'Latest changes across the platform.'], generic: ['Featured', 'Highlights from this section.'] };
  const [title, text] = copy[c.arch] ?? copy.generic;
  return `<section class="pg-box pg-promo">${media(c)}<h2 class="pg-box-title">${title}</h2><p>${text}</p></section>`;
}
const listingMeta = c => (c.parts.fields ? `<div class="pg-listing-meta">${c.parts.fields}</div>` : '');

const LISTING = {
  facets(c) {
    return `<div class="pg-lgrid pg-lgrid-left"><aside class="pg-facets">${facetForm(c, 'fieldset')}${promo(c)}</aside><div class="pg-results">${toolbar(c)}${c.parts.related ?? ''}${pagerSummary(c)}${listingMeta(c)}</div></div>`;
  },
  filterbar(c) {
    return `${keywordBar(c)}${activeChips(c)}<div class="pg-lgrid pg-lgrid-right"><div class="pg-results">${toolbar(c)}${c.parts.related ?? ''}${pagerSummary(c)}</div><aside class="pg-rail">${helpBox(c)}${promo(c)}${listingMeta(c)}</aside></div>`;
  },
  intro(c) {
    const alpha = c.arch === 'person' || c.arch === 'collection' || c.arch === 'place' || c.arch === 'service';
    const intros = { museum: 'Explore objects from the collection. Filter by department, date or whether the object is on view.', records: 'Search digitized and paper records. Request copies online or in the reading room.', news: 'Browse past editions of the paper by date.' };
    return `<section class="pg-intro"><p>${(c.arch === 'catalog' && intros[c.domain]) || (INTRO[c.arch] ?? INTRO.generic)}</p>${categoryPills(c)}</section>${alpha ? alphaBar(c) : ''}${toolbar(c, { view: false })}<div class="pg-results">${c.parts.related ?? ''}</div>${pagerSummary(c)}<div class="pg-band">${promo(c)}${helpBox(c)}${listingMeta(c)}</div>`;
  },
  accordion(c) {
    return `<div class="pg-lgrid pg-lgrid-right pg-lgrid-wide"><div class="pg-results"><div class="pg-results-head">${toolbar(c, { view: false })}</div>${c.parts.related ?? ''}${pagerSummary(c)}${listingMeta(c)}</div><aside class="pg-facets pg-facets-acc">${facetForm(c, 'accordion')}${helpBox(c)}${promo(c)}</aside></div>`;
  },
};

export function renderListingVariant(site, page, parts) {
  const c = context(site, page, parts);
  const frame = listingFrame(site, c.type);
  const views = { catalog: ['grid', 'grid', 'list'], person: ['grid', 'list'], event: ['list', 'list', 'grid'], article: ['list', 'list', 'grid'], docs: ['grid', 'list'] };
  c.view = (views[c.arch] ?? ['list', 'grid'])[c.s('view', c.type) % (views[c.arch]?.length ?? 2)];
  if (String(parts.related ?? '').includes('directory-table')) c.view = 'list'; // tables only read as lists
  return `<div class="pg-inner pg-listing pg-skin-${skinFor(site)} pg-lframe-${frame} pg-a-${c.arch} pg-lt-${slugish(c.type)} pg-view-${c.view}">${LISTING[frame](c)}</div>`;
}

export function innerCss() {
  return INNER_CSS;
}

const INNER_CSS = `/* Inner page designs: detail and listing layouts chosen per site (src/inner-layouts.mjs). */
.pg-inner { --pg-radius: var(--card-radius, 6px); --pg-gap: 32px; min-width: 0; color: var(--ink); }
.pg-inner *, .pg-inner *::before, .pg-inner *::after { box-sizing: border-box; }
.pg-inner p, .pg-inner li, .pg-inner td, .pg-inner th, .pg-inner span, .pg-inner label, .pg-inner legend, .pg-inner summary, .pg-inner h2, .pg-inner h3 { overflow-wrap: anywhere; }
.pg-inner .pg-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); }
.pg-inner .pg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.pg-inner .pg-note { color: var(--muted); font-size: 0.85rem; }
.pg-inner .pg-h { margin: 0 0 14px; font-family: var(--heading-font, Georgia, "Times New Roman", serif); font-size: 1.35rem; line-height: 1.25; }
.pg-inner .pg-h-sm { font-size: 0.95rem; }
.pg-grid, .pg-lgrid { display: grid; gap: var(--pg-gap); align-items: start; }
.pg-primary, .pg-rail, .pg-results, .pg-facets { min-width: 0; }
.pg-grid-rail { grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); }
.pg-grid-left { grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); }
.pg-grid-hero { grid-template-columns: minmax(0, 1fr) minmax(230px, 300px); margin-top: 28px; }
.pg-rail { display: grid; gap: 20px; }
.pg-column { max-width: 780px; margin-inline: auto; display: grid; gap: 26px; }
.pg-band { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 20px; }
.pg-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 20px; margin-top: 28px; }
.pg-fields { min-width: 0; margin: 4px 0 24px; }
.pg-related { min-width: 0; }
.pg-related:empty { display: none; }
.pg-media { min-width: 0; }
.pg-media .visual { margin: 0; }
.pg-cover-ph { display: flex; flex-direction: column; justify-content: space-between; gap: 12px; aspect-ratio: 2 / 3; max-width: 260px; padding: 22px 18px 18px 26px; border-radius: 4px; background: linear-gradient(90deg, rgb(0 0 0 / 22%) 0 8px, transparent 8px), linear-gradient(160deg, var(--accent) 0%, var(--accent-strong) 75%); color: #fff; box-shadow: 0 6px 16px rgb(0 0 0 / 22%); }
.pg-cover-title { font-family: var(--heading-font, Georgia, serif); font-size: 1.35rem; font-weight: 800; line-height: 1.2; }
.pg-cover-author { font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; }
.pg-media .visual img { width: 100%; height: auto; }

/* boxes */
.pg-box { min-width: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--pg-radius); background: var(--paper); }
.pg-box > p, .pg-box > ul, .pg-box > ol { margin: 0 0 10px; }
.pg-box > :last-child { margin-bottom: 0; }
.pg-box-title { margin: 0 0 12px; font-family: var(--heading-font, inherit); font-size: 1.05rem; line-height: 1.3; color: var(--ink); }
.pg-box h3 { margin: 0 0 4px; font-size: 0.98rem; }
.pg-skin-0 .pg-box { border-top: 4px solid var(--accent); }
.pg-skin-1 .pg-box { border-color: transparent; background: var(--wash); }
.pg-skin-2 .pg-box { padding: 14px 0 0; border: 0; border-top: 2px solid var(--ink); border-radius: 0; background: transparent; }
.pg-skin-2 .pg-box-title { font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; }
.pg-skin-3 .pg-box { border-color: var(--line); border-radius: calc(var(--pg-radius) + 4px); box-shadow: 0 2px 10px rgb(0 0 0 / 7%); }
.pg-box.pg-banner { display: grid; grid-template-columns: minmax(0, 1fr); border-left: 6px solid var(--accent); }
.pg-skin-2 .pg-box.pg-banner { padding: 14px 16px; border: 0; border-left: 6px solid var(--accent); background: var(--wash); }
.pg-callout { border-left: 6px solid var(--accent-strong); background: var(--wash); }
.pg-skin-2 .pg-callout { padding: 14px 16px; border-left: 6px solid var(--accent-strong); background: var(--wash); }

/* key/value lists and tables */
.pg-kv { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.pg-kv li { display: grid; grid-template-columns: minmax(90px, 40%) minmax(0, 1fr); gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
.pg-kv li:last-child { border-bottom: 0; }
.pg-k { color: var(--muted); font-weight: 700; font-size: 0.82rem; }
.pg-table-wrap { max-width: 100%; overflow-x: auto; }
.pg-hours { list-style: none; margin: 0 0 8px; padding: 0; font-size: 0.9rem; }
.pg-hours li { display: grid; grid-template-columns: minmax(84px, 40%) minmax(0, 1fr); gap: 8px; padding: 7px 8px; border-bottom: 1px solid var(--line); }
.pg-hours li:nth-child(odd) { background: var(--wash); }
.pg-skin-1 .pg-hours li:nth-child(odd) { background: var(--paper); }
.pg-day { font-weight: 700; }
.pg-closed .pg-time { color: var(--muted); }
.pg-table, .pg-summary { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.pg-table th, .pg-table td, .pg-hours th, .pg-hours td, .pg-summary th, .pg-summary td { padding: 8px 6px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.pg-table thead th { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 2px solid var(--line); }
.pg-hours th, .pg-summary th { width: 42%; font-weight: 700; color: var(--ink); }
.pg-summary th { color: var(--muted); font-size: 0.84rem; }
.pg-hours tr:nth-child(odd) td, .pg-hours tr:nth-child(odd) th { background: var(--wash); }
.pg-bullets, .pg-pubs, .pg-agenda, .pg-mostread { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; font-size: 0.94rem; }
.pg-mostread { padding-left: 0; list-style: none; counter-reset: mr; }
.pg-mostread li { counter-increment: mr; display: grid; grid-template-columns: 2em minmax(0, 1fr); gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--line); font-weight: 700; font-family: var(--heading-font, Georgia, serif); }
.pg-mostread li::before { content: counter(mr); color: var(--accent-strong); font-size: 1.4rem; line-height: 1; }
.pg-steps { list-style: none; margin: 0; padding: 0; counter-reset: st; display: grid; gap: 12px; }
.pg-steps li { counter-increment: st; position: relative; display: grid; gap: 2px; padding-left: 46px; min-height: 34px; }
.pg-steps li::before { content: counter(st); position: absolute; left: 0; top: 0; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-strong); color: #fff; font-weight: 800; }
.pg-step-h { font-weight: 800; }
.pg-step-t { color: var(--muted); font-size: 0.92rem; }
.pg-checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pg-checklist li { position: relative; padding-left: 28px; }
.pg-checklist li::before { content: ""; position: absolute; left: 0; top: 3px; width: 18px; height: 18px; border: 2px solid var(--accent-strong); border-radius: 3px; }
.pg-series { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.pg-series li { display: grid; gap: 2px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.pg-series-h { font-weight: 800; }
.pg-series-t { color: var(--muted); font-size: 0.88rem; }
.pg-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 110px), 1fr)); gap: 14px; }
.pg-stats li { display: grid; gap: 2px; }
.pg-stat-n { font-family: var(--heading-font, Georgia, serif); font-size: 1.7rem; font-weight: 800; line-height: 1.1; color: var(--accent-strong); overflow-wrap: anywhere; }
.pg-stat-t { color: var(--muted); font-size: 0.85rem; }
.pg-prices { list-style: none; margin: 0 0 12px; padding: 0; }
.pg-prices li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.pg-prices li span:last-child { font-weight: 800; }

/* badges, chips, buttons */
.pg-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
.pg-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); font-size: 0.78rem; font-weight: 700; line-height: 1.4; }
.pg-badge-accent { border-color: var(--accent-strong); background: var(--accent-strong); color: #fff; }
.pg-badge-ok { border-color: #b7dfc1; background: #e6f4ea; color: #14532d; }
.pg-badge-warn { border-color: #f0d79a; background: #fdf3d6; color: #6b3d00; }
.pg-skin-2 .pg-badge, .pg-skin-0 .pg-badge { border-radius: 3px; }
.pg-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.pg-chips li { padding: 4px 12px; border-radius: 999px; background: var(--wash); border: 1px solid var(--line); font-size: 0.86rem; }
.pg-chips-lg li { padding: 6px 14px; font-size: 0.92rem; }
.pg-tags { margin-top: 22px; }
.pg-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.pg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 8px 16px; border: 2px solid var(--accent-strong); border-radius: var(--radius, 4px); background: var(--paper); color: var(--accent-strong); font: inherit; font-size: 0.92rem; font-weight: 750; line-height: 1.2; text-align: center; cursor: pointer; }
.pg-btn-primary { background: var(--accent-strong); color: #fff; }
.pg-btn-ghost { border-color: var(--line); color: var(--ink); }
.pg-btn-chip { border-width: 1px; border-color: var(--line); background: var(--wash); color: var(--ink); }
.pg-btn-sm { min-height: 32px; padding: 4px 12px; font-size: 0.82rem; }
.pg-btn:hover { filter: brightness(1.08); }
.pg-btn:focus-visible, .pg-inner a:focus-visible, .pg-inner select:focus-visible, .pg-inner input:focus-visible, .pg-inner summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.pg-avail .pg-actions .pg-btn, .pg-register .pg-actions .pg-btn-primary, .pg-donate > .pg-actions .pg-btn { flex: 1 1 140px; }
.pg-skin-3 .pg-btn { border-radius: 999px; }
.pg-skin-2 .pg-btn { border-radius: 0; }

/* lead blocks */
.pg-meta { margin: 0 0 10px; color: var(--muted); font-size: 0.95rem; font-weight: 600; }
.pg-byline { margin: 0 0 2px; font-size: 0.95rem; }
.pg-dateline { margin: 0 0 12px; color: var(--muted); font-size: 0.86rem; }
.pg-share { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0; margin: 6px 0 18px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.pg-person-head, .pg-when { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center; margin-bottom: 18px; }
.pg-person-head-plain { grid-template-columns: minmax(0, 1fr); }
.pg-person-head .pg-photo { width: 150px; }
.pg-person-head .pg-photo .visual img { aspect-ratio: 1 / 1; object-fit: cover; }
.pg-skin-3 .pg-person-head .pg-photo .visual, .pg-skin-1 .pg-person-head .pg-photo .visual { border-radius: 50%; }
.pg-avatar { width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-strong); color: #fff; font-family: var(--heading-font, Georgia, serif); font-size: 2.1rem; font-weight: 800; letter-spacing: 0.02em; }
.pg-skin-2 .pg-avatar, .pg-skin-0 .pg-avatar { border-radius: var(--pg-radius); }
.pg-datebadge { width: 84px; display: grid; text-align: center; border: 2px solid var(--accent-strong); border-radius: var(--pg-radius); overflow: hidden; background: var(--paper); }
.pg-db-m { padding: 3px 0; background: var(--accent-strong); color: #fff; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.pg-db-d { font-size: 2.1rem; font-weight: 800; line-height: 1.15; color: var(--ink); }
.pg-db-w { padding-bottom: 4px; color: var(--muted); font-size: 0.76rem; font-weight: 700; text-transform: uppercase; }
.pg-status { margin: 0 0 4px; font-size: 1.15rem; font-weight: 800; }
.pg-status-ok { color: #14632f; }
.pg-status-warn { color: #8a4b00; }
.pg-status-ok::before { content: "\\2713  "; }
.pg-rating { margin: 0 0 8px; font-weight: 700; }
.pg-stars { color: #8a5a00; letter-spacing: 0.06em; }
.pg-quote { margin: 0; padding: 10px 14px; border-left: 4px solid var(--accent); background: var(--wash); font-style: italic; }
.pg-quote cite { display: block; margin-top: 4px; color: var(--muted); font-size: 0.85rem; font-style: normal; }
.pg-cite { padding: 10px 12px; background: var(--wash); border: 1px dashed var(--line); font-size: 0.88rem; }
.pg-big { margin: 0 0 4px; font-family: var(--heading-font, Georgia, serif); font-size: 2rem; font-weight: 800; color: var(--accent-strong); overflow-wrap: anywhere; }
.pg-phone { font-size: 1.2rem; font-weight: 800; color: var(--accent-strong); }
.pg-meter { height: 8px; margin: 4px 0 6px; border-radius: 99px; background: var(--wash); border: 1px solid var(--line); overflow: hidden; }
.pg-meter span { display: block; height: 100%; width: 0; background: var(--accent); }
${Array.from({ length: 11 }, (_, i) => `.pg-meter-${i} span { width: ${i * 10}%; }`).join('\n')}
.pg-amounts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pg-tombstone p { margin: 0 0 4px; font-size: 0.92rem; }
.pg-tomb-artist { font-weight: 800; font-size: 1.05rem !important; }
.pg-tombstone .pg-mono { margin-top: 8px; color: var(--muted); }
.pg-loc { padding: 10px 0; border-bottom: 1px solid var(--line); }
.pg-loc:last-child { border-bottom: 0; }
.pg-loc p { margin: 0; font-size: 0.9rem; }
.pg-amenities { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr)); gap: 10px; }
.pg-amenities li { display: flex; align-items: center; gap: 10px; font-size: 0.92rem; }
.pg-icon { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--wash); border: 2px solid var(--accent); color: var(--accent-strong); font-weight: 800; }
.pg-map { position: relative; min-height: 170px; margin: 0 0 4px; border-radius: var(--pg-radius); border: 1px solid var(--line); overflow: hidden; background-color: var(--wash); background-image: linear-gradient(90deg, rgb(255 255 255 / 70%) 2px, transparent 2px), linear-gradient(rgb(255 255 255 / 70%) 2px, transparent 2px), linear-gradient(35deg, transparent 46%, rgb(255 255 255 / 90%) 46%, rgb(255 255 255 / 90%) 52%, transparent 52%); background-size: 38px 38px, 38px 38px, 100% 100%; }
.pg-map-pin { position: absolute; left: 50%; top: 38%; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50% 50% 50% 0; background: var(--accent-strong); transform: rotate(-45deg); box-shadow: 0 2px 6px rgb(0 0 0 / 30%); }
.pg-map-pin::after { content: ""; position: absolute; left: 8px; top: 8px; width: 10px; height: 10px; border-radius: 50%; background: #fff; }
.pg-map-label { position: absolute; left: 10px; right: 10px; bottom: 10px; padding: 6px 10px; background: var(--paper); color: var(--ink); border-radius: 4px; font-size: 0.85rem; font-weight: 700; }
.pg-feedback { display: flex; gap: 8px; margin-bottom: 8px; }
.pg-inline-form { display: flex; flex-wrap: wrap; gap: 8px; }
.pg-inline-form input { flex: 1 1 160px; min-width: 0; min-height: 40px; padding: 8px 10px; border: 1px solid var(--muted); border-radius: var(--radius, 4px); font: inherit; background: #fff; color: #1b1b1b; }
.pg-box-newsletter { background: var(--wash); }
.pg-toc { list-style: none; margin: 0; padding: 0 0 0 2px; display: grid; gap: 2px; border-left: 2px solid var(--line); }
.pg-toc a { display: block; padding: 4px 10px; margin-left: -2px; border-left: 2px solid transparent; color: var(--ink); font-size: 0.9rem; text-decoration: none; }
.pg-toc li:first-child a { border-left-color: var(--accent-strong); color: var(--accent-strong); font-weight: 700; }
.pg-toc a:hover { text-decoration: underline; }
.pg-onpage { min-width: 0; }

/* hero frame */
.pg-hero { display: grid; grid-template-columns: minmax(200px, 360px) minmax(0, 1fr); gap: 32px; align-items: start; padding: 24px; border-radius: var(--pg-radius); background: var(--wash); }
.pg-hero:not(:has(.pg-media)) { grid-template-columns: minmax(0, 1fr); }
.pg-hero .pg-box { background: var(--paper); }
.pg-tabs { display: flex; flex-wrap: wrap; gap: 0 6px; margin-top: 24px; border-bottom: 2px solid var(--line); }
.pg-tab { padding: 10px 16px; margin-bottom: -2px; border-bottom: 3px solid transparent; color: var(--ink); font-weight: 700; text-decoration: none; }
.pg-tab-current { border-bottom-color: var(--accent-strong); color: var(--accent-strong); }
.pg-a-person .pg-hero { grid-template-columns: minmax(0, 1fr) minmax(180px, 280px); }
.pg-a-person .pg-hero > .pg-media { order: 2; }
.pg-a-article .pg-hero { grid-template-columns: minmax(0, 1fr); padding: 0; background: none; }
.pg-a-article .pg-hero .pg-media .visual img { aspect-ratio: 16 / 9; object-fit: cover; }

/* rail frame: image in the sidebar for catalog-like items */
.pg-grid-rail .pg-rail .pg-media .visual img { aspect-ratio: 3 / 4; object-fit: cover; }
.pg-grid-rail .pg-primary > .pg-media { float: right; width: min(42%, 260px); margin: 0 0 16px 24px; }
.pg-a-article .pg-grid-rail .pg-primary > .pg-media { float: none; width: 100%; margin: 0 0 20px; }
.pg-a-article .pg-grid-rail .pg-primary > .pg-media .visual img { aspect-ratio: 16 / 9; object-fit: cover; }
.pg-grid-rail .pg-fields { clear: none; }
.pg-grid-rail .pg-primary::after { content: ""; display: block; clear: both; }

/* left frame */
.pg-rail-left .pg-media { max-width: 280px; }
.pg-grid-left .pg-primary { display: grid; gap: 22px; align-content: start; }
.pg-grid-left .pg-primary > * { min-width: 0; }

/* column frame */
.pg-column-head { padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.pg-column > .pg-media .visual img { aspect-ratio: 16 / 9; object-fit: cover; }
.pg-a-catalog .pg-column > .pg-media, .pg-a-person .pg-column > .pg-media { max-width: 320px; }
.pg-a-catalog .pg-column > .pg-media .visual img, .pg-a-person .pg-column > .pg-media .visual img { aspect-ratio: 3 / 4; }

/* documentation frames */
.pg-docs { display: grid; gap: 36px; align-items: start; }
.pg-docs-three { grid-template-columns: minmax(190px, 230px) minmax(0, 1fr) minmax(170px, 210px); }
.pg-docs-left { grid-template-columns: minmax(200px, 250px) minmax(0, 1fr); }
.pg-docs-right { grid-template-columns: minmax(0, 1fr) minmax(180px, 230px); }
.pg-docs-column { max-width: 820px; }
.pg-docs-body, .pg-docs-nav, .pg-docs-toc { min-width: 0; display: grid; gap: 20px; align-content: start; }
.pg-docs-nav { padding-right: 16px; border-right: 1px solid var(--line); }
.pg-doctree details { margin-bottom: 10px; }
.pg-doctree summary { cursor: pointer; padding: 4px 0; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.pg-doctree ul { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 1px; }
.pg-doctree li { padding: 5px 10px; border-radius: var(--radius, 4px); font-size: 0.9rem; color: var(--ink); }
.pg-doctree li.pg-current { background: var(--wash); color: var(--accent-strong); font-weight: 750; box-shadow: inset 3px 0 var(--accent-strong); }
.pg-doctools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pg-version { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-size: 0.85rem; font-weight: 700; color: var(--muted); }
.pg-inner select { min-height: 34px; max-width: 100%; padding: 4px 8px; border: 1px solid var(--muted); border-radius: var(--radius, 4px); background: #fff; color: #1b1b1b; font: inherit; font-size: 0.88rem; }
.pg-code { margin: 0; border-radius: 8px; overflow: hidden; background: #0f172a; color: #e2e8f0; }
.pg-code figcaption { padding: 6px 14px; background: #1e293b; color: #cbd5e1; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; }
.pg-code pre { margin: 0; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86rem; line-height: 1.55; }
.pg-admonition { padding: 12px 16px; border-left: 4px solid var(--accent); border-radius: 0 6px 6px 0; background: var(--wash); }
.pg-admonition p { margin: 0; }
.pg-adm-title { font-weight: 800; margin-bottom: 4px !important; }
.pg-adm-warning { border-left-color: #b45309; background: #fff7e6; color: #3d2a00; }
.pg-prevnext { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.pg-pn-item { display: grid; gap: 2px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 8px; }
.pg-pn-item:last-child { text-align: right; }
.pg-pn-label { color: var(--muted); font-size: 0.78rem; }
.pg-pn-title { color: var(--accent-strong); font-weight: 750; }
.pg-docs .pg-media { max-width: 440px; }
.pg-docs-nav .pg-media, .pg-docs-toc .pg-media { max-width: 100%; }
.pg-docs-mobile-tree { padding: 10px 14px; border: 1px solid var(--line); border-radius: 8px; }
.pg-docs-mobile-tree > summary { font-weight: 750; cursor: pointer; }
.pg-docs-head { display: grid; gap: 8px; padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--line); }
.pg-docs-column > * + * { margin-top: 22px; }
.pg-docs-toc .pg-onpage .pg-box-title { font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }

/* ---- listing pages ---- */
.pg-lgrid-left { grid-template-columns: minmax(210px, 260px) minmax(0, 1fr); }
.pg-lgrid-right { grid-template-columns: minmax(0, 1fr) minmax(220px, 280px); }
.pg-lgrid-wide { grid-template-columns: minmax(0, 1fr) minmax(220px, 260px); }
.pg-facets-form { display: grid; gap: 14px; }
.pg-facet { margin: 0; padding: 0 0 12px; border: 0; border-bottom: 1px solid var(--line); min-width: 0; }
.pg-facet legend, .pg-facet summary { padding: 0; margin-bottom: 6px; font-weight: 800; font-size: 0.92rem; color: var(--ink); }
.pg-facet summary { cursor: pointer; }
.pg-facet ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.pg-facet li { display: flex; align-items: flex-start; gap: 8px; font-size: 0.9rem; }
.pg-facet input { flex: 0 0 auto; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent-strong); }
.pg-count { color: var(--muted); font-size: 0.82rem; }
.pg-facets { padding: 18px; border-radius: var(--pg-radius); background: var(--wash); }
.pg-skin-2 .pg-facets { padding: 14px 0 0; background: none; border-top: 2px solid var(--ink); border-radius: 0; }
.pg-skin-3 .pg-facets { background: var(--paper); border: 1px solid var(--line); box-shadow: 0 2px 10px rgb(0 0 0 / 7%); }
.pg-facets-acc { display: grid; gap: 20px; }
.pg-facets-acc .pg-box-help { background: var(--paper); }
.pg-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 10px 0 14px; margin-bottom: 18px; border-bottom: 1px solid var(--line); }
.pg-result-count { margin: 0 auto 0 0; font-weight: 750; }
.pg-sort { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.88rem; }
.pg-sort label { color: var(--muted); font-weight: 700; }
.pg-viewtoggle { display: flex; gap: 4px; }
.pg-pageinfo { margin: 18px 0 0; color: var(--muted); font-size: 0.86rem; }
.pg-listing-meta { margin-top: 18px; }
.pg-listing-meta .empty-note { padding: 10px 12px; font-size: 0.86rem; }
.pg-filterbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 16px 18px; margin-bottom: 14px; border-radius: var(--pg-radius); background: var(--wash); border: 1px solid var(--line); }
.pg-field { display: grid; gap: 4px; flex: 1 1 150px; min-width: 0; font-size: 0.82rem; font-weight: 750; color: var(--ink); }
.pg-field-grow { flex: 3 1 220px; }
.pg-field input { min-height: 40px; min-width: 0; width: 100%; padding: 8px 10px; border: 1px solid var(--muted); border-radius: var(--radius, 4px); background: #fff; color: #1b1b1b; font: inherit; }
.pg-field select { min-height: 40px; width: 100%; }
.pg-active { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 20px; }
.pg-active-label { color: var(--muted); font-size: 0.86rem; font-weight: 700; }
.pg-intro { display: grid; gap: 14px; padding: 20px 22px; margin-bottom: 18px; border-radius: var(--pg-radius); background: var(--wash); }
.pg-intro p { margin: 0; max-width: 70ch; font-size: 1.05rem; }
.pg-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.pg-alpha { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
.pg-alpha-l { min-width: 32px; min-height: 32px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--accent-strong); font: inherit; font-weight: 800; font-size: 0.86rem; cursor: pointer; }
.pg-listing .pg-band { margin-top: 26px; }
.pg-promo .pg-media { max-width: 320px; margin: -2px 0 12px; }
.pg-promo .pg-media .visual img { aspect-ratio: 4 / 3; object-fit: cover; }
.pg-facets .pg-promo { margin-top: 20px; }
.pg-skin-2 .pg-facets .pg-promo, .pg-facets .pg-promo { padding: 0; border: 0; box-shadow: none; background: none; }

/* result list styles (restyling the related markup passed in) */
.pg-listing .pg-results .section-heading { margin-top: 0; }
.pg-view-grid .record-cards { grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 16px; }
.pg-view-list .record-cards { grid-template-columns: minmax(0, 1fr); gap: 0; }
.pg-view-list .record-cards li { border-width: 0 0 1px; border-radius: 0; padding: 16px 0; background: none; }
.pg-view-grid .link-list { grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
.pg-view-list .link-list { grid-template-columns: minmax(0, 1fr); gap: 0; }
.pg-view-list .link-list li { border-width: 0 0 1px; border-radius: 0; }
.pg-listing .record-cards li, .pg-listing .link-list li, .pg-listing .directory-table td { position: relative; }
.pg-listing.pg-a-catalog .record-cards li:nth-child(3n+2)::before, .pg-listing.pg-a-catalog .link-list li:nth-child(3n+2)::before, .pg-listing.pg-a-catalog .directory-table tr:nth-child(3n+2) td::before { background: linear-gradient(160deg, var(--muted), var(--ink)); }
.pg-listing.pg-a-catalog .record-cards li:nth-child(3n)::before, .pg-listing.pg-a-catalog .link-list li:nth-child(3n)::before, .pg-listing.pg-a-catalog .directory-table tr:nth-child(3n) td::before { background: linear-gradient(90deg, rgb(0 0 0 / 22%) 0 10%, transparent 10%), var(--accent-strong); }
.pg-listing.pg-a-catalog.pg-view-grid .record-cards li::before, .pg-listing.pg-a-catalog.pg-view-grid .link-list li::before { content: ""; display: block; aspect-ratio: 3 / 4; max-height: 220px; margin: 0 auto 12px; width: 70%; border-radius: 3px; background: linear-gradient(160deg, var(--accent) 0%, var(--accent-strong) 70%); box-shadow: inset 6px 0 rgb(0 0 0 / 18%), 0 3px 8px rgb(0 0 0 / 18%); }
.pg-listing.pg-a-catalog.pg-view-list .record-cards li, .pg-listing.pg-a-catalog.pg-view-list .link-list li, .pg-listing.pg-a-person .record-cards li, .pg-listing.pg-a-person .link-list li, .pg-listing.pg-a-event .record-cards li, .pg-listing.pg-a-event .link-list li, .pg-listing.pg-a-article.pg-view-list .record-cards li, .pg-listing.pg-a-catalog.pg-view-list .directory-table td, .pg-listing.pg-a-person .directory-table td, .pg-listing.pg-a-event .directory-table td, .pg-listing.pg-a-article.pg-view-list .directory-table td { padding-left: 84px; min-height: 92px; }
.pg-listing.pg-a-catalog.pg-view-list .record-cards li::before, .pg-listing.pg-a-catalog.pg-view-list .link-list li::before, .pg-listing.pg-a-catalog.pg-view-list .directory-table td::before { content: ""; position: absolute; left: 10px; top: 14px; width: 56px; height: 76px; border-radius: 3px; background: linear-gradient(160deg, var(--accent), var(--accent-strong)); }
.pg-listing.pg-a-person .record-cards li::before, .pg-listing.pg-a-person .link-list li::before, .pg-listing.pg-a-person .directory-table td::before { content: ""; position: absolute; left: 12px; top: 14px; width: 58px; height: 58px; border-radius: 50%; background: radial-gradient(circle at 50% 38%, var(--paper) 0 22%, transparent 23%), radial-gradient(ellipse at 50% 100%, var(--paper) 0 42%, transparent 43%), var(--accent-strong); }
.pg-listing.pg-a-event .record-cards li::before, .pg-listing.pg-a-event .link-list li::before, .pg-listing.pg-a-event .directory-table td::before { content: ""; position: absolute; left: 12px; top: 14px; width: 56px; height: 60px; border: 2px solid var(--accent-strong); border-top-width: 16px; border-radius: 6px; background: var(--paper); }
.pg-listing.pg-a-article.pg-view-list .record-cards li::before, .pg-listing.pg-a-article.pg-view-list .directory-table td::before { content: ""; position: absolute; left: 0; top: 16px; width: 70px; height: 56px; border-radius: 4px; background: linear-gradient(135deg, var(--wash), var(--line)); }
.pg-listing.pg-a-article.pg-view-list .record-cards a, .pg-listing.pg-a-article .link-list a { font-family: var(--heading-font, Georgia, serif); font-size: 1.12rem; }
.pg-listing.pg-view-grid.pg-a-article .record-cards li::before, .pg-listing.pg-view-grid.pg-a-place .record-cards li::before, .pg-listing.pg-view-grid.pg-a-service .record-cards li::before { content: ""; display: block; height: 110px; margin: -16px -16px 12px; background: linear-gradient(135deg, var(--wash) 0 40%, var(--line)); }
.pg-listing.pg-a-docs .record-cards li, .pg-listing.pg-a-docs .link-list li, .pg-listing.pg-a-docs .directory-table td { border-radius: 8px; }
.pg-listing.pg-a-docs .record-cards a::after, .pg-listing.pg-a-docs .link-list a::after { content: " \\2192"; }
.pg-listing.pg-a-document .record-cards li, .pg-listing.pg-a-collection .record-cards li, .pg-listing.pg-a-document .directory-table td, .pg-listing.pg-a-collection .directory-table td { border-left: 4px solid var(--accent); }
.pg-listing.pg-view-list.pg-a-catalog .link-list a, .pg-listing.pg-a-person .link-list a, .pg-listing.pg-a-event .link-list a { min-height: 90px; }

/* heading tweaks on <main> per design */
main.inner-d-column .page-heading { max-width: 780px; margin-inline: auto; }
main.inner-d-column.inner-a-article .page-heading { text-align: center; }
main.inner-a-article.inner-d-hero h1 { max-width: 22ch; }
main.inner-a-docs .page-heading { max-width: none; }
main.inner-a-docs.inner-d-column .page-heading { max-width: 820px; margin-inline: 0; }
main.inner-v-2 .page-heading { border-bottom-width: 1px; }
main.inner-v-3.inner-detail .page-heading { padding-bottom: 18px; }

@media (max-width: 960px) {
  .pg-docs-three { grid-template-columns: minmax(180px, 220px) minmax(0, 1fr); }
  .pg-docs-three .pg-docs-toc { display: none; }
}
@media (max-width: 720px) {
  .pg-inner { --pg-gap: 24px; }
  .pg-grid-rail, .pg-grid-left, .pg-grid-hero, .pg-hero, .pg-a-person .pg-hero, .pg-lgrid-left, .pg-lgrid-right, .pg-lgrid-wide, .pg-docs-three, .pg-docs-left, .pg-docs-right { grid-template-columns: minmax(0, 1fr); }
  .pg-hero { padding: 16px; gap: 18px; }
  .pg-a-person .pg-hero > .pg-media { order: 0; }
  .pg-a-article .pg-grid-left .pg-rail-left { order: 2; }
  .pg-media { max-width: 300px; }
  .pg-a-article .pg-media, .pg-a-docs .pg-media { max-width: none; }
  .pg-grid-rail .pg-primary > .pg-media { float: none; width: 100%; max-width: 300px; margin: 0 0 18px; }
  .pg-a-article .pg-grid-rail .pg-primary > .pg-media { max-width: none; }
  .pg-docs-nav { padding-right: 0; border-right: 0; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .pg-docs-three .pg-docs-toc { display: grid; }
  .pg-prevnext { grid-template-columns: minmax(0, 1fr); }
  .pg-pn-item:last-child { text-align: left; }
  .pg-person-head .pg-photo { width: 96px; }
  .pg-avatar { width: 72px; height: 72px; font-size: 1.6rem; }
  .pg-datebadge { width: 70px; }
  .pg-kv li { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .pg-toolbar { align-items: stretch; }
  .pg-result-count { width: 100%; }
  .pg-facets-form .pg-facet:nth-of-type(n+3) { display: none; }
  .pg-tab { padding: 8px 10px; font-size: 0.9rem; }
}
`;
