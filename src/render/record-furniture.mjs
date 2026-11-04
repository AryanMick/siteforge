// Page furniture around detail and listing records: the prose, tools, asides, "more like this" cards and
// footers that real collection, catalog, course, service and docs pages put around the core record.
// Modeled on si.edu object/exhibition pages, boston.gov department pages ("Page sections", Contact box,
// "Provide your feedback"), NYPL catalog records, Stanford course/profile pages, usa.gov/nih.gov program
// pages, archives.gov catalog records, MDN reference pages ("In this article", "last modified") and
// redcross.org program pages. Everything is decoration: no dl/dt/dd, no data-field, no field-list or
// repeated-records classes, no h1, and the only links are the page's own model links (passed in).
import { seedFor } from '../site/util.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TOWNS = ['Ashford', 'Brookdale', 'Cedarview', 'Elmwood', 'Fairhaven', 'Glenmont', 'Hazelton', 'Kingsbury', 'Lakeside', 'Maplewood', 'Millbrook', 'Northfield'];
const initials = text => String(text).split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '#';
const lower = text => String(text ?? '').toLowerCase();

// Per-domain recipe: tool buttons, contents label, prose sections, aside box, card heading, tag label,
// citation and footer style. Each paragraph is a function of the page context t.
const RECIPES = {
  museum: {
    tools: ['Share', 'Print', 'Cite this object', 'Download image'], toc: 'On this page', cards: 'More objects like this', tagLabel: 'Topics', cite: 'Cite this object', footer: 'record',
    sections: [
      ['Description', [t => `${t.title} is part of the ${t.site} collection. ${t.lead ? `Catalogued with ${t.leadLabel} “${t.lead}”, it` : 'It'} shows how makers, owners and curators have handled pieces like it over time.`,
        t => `Curators examined the ${lower(t.type)} for this record, noting construction, condition and marks of earlier use. Comparable objects in storage help date it and place it among related work.`]],
      ['Context', [t => `Objects like this were made for daily use before entering private collections. The museum's research files trace how ${t.title} moved between owners${t.rel ? ` and how it relates to ${t.rel}` : ''}.`]],
      ['Rights and usage', [() => 'Images of this object may be downloaded for personal and educational use. For commercial use, contact Rights and Reproductions. Some objects remain under copyright.']],
    ],
    aside: t => ['Plan your visit', `<p class="rf-big">Free admission</p><p>Open daily 10 a.m. to 5:30 p.m. except December 25.</p><p>${t.town} Avenue entrance; accessible entrances on both sides of the building.</p>`, ['Get directions', 'Visit accessibility']],
  },
  library: {
    tools: ['Place hold', 'Add to list', 'Share', 'Print'], toc: 'Jump to', cards: 'Readers also borrowed', tagLabel: 'Subjects', cite: 'Cite this item', footer: 'record',
    sections: [
      ['Summary', [t => `${t.title} is available to borrow from ${t.site}. ${t.lead ? `The catalog lists ${t.leadLabel} as “${t.lead}”.` : ''} Library staff added notes for readers, book clubs and teachers.`,
        t => `Patrons who borrowed this ${lower(t.type)} often go on to related titles on the same subject. Ask at any branch for a reading list or a book club kit.`]],
      ['Notes from library staff', [t => `This record was reviewed by the ${t.town} Branch collection team. Large-print and audio editions may be listed separately in the catalog.`]],
    ],
    aside: t => ['Find it at the library', `<p>Pick up holds at any branch. Most holds are ready within 3 to 5 days.</p><p class="rf-hours"><span>Mon–Thu</span> 10 a.m.–8 p.m.<br><span>Fri–Sat</span> 10 a.m.–6 p.m.<br><span>Sun</span> 1–5 p.m.</p><p>Ask a librarian: ${t.phone}</p>`, ['Check availability', 'Ask a librarian']],
  },
  university: {
    tools: ['Share', 'Print', 'Email this page'], toc: 'On this page', cards: 'You may also be interested in', tagLabel: 'Areas of study', cite: null, footer: 'updated',
    sections: [
      ['Overview', [t => `${t.title} is offered through ${t.site}. ${t.lead ? `Its ${t.leadLabel} is “${t.lead}”.` : ''} Students work closely with faculty and take part in seminars, labs and fieldwork in this area.`,
        t => `The ${lower(t.type)} draws on research across the university${t.rel ? `, including work by ${t.rel}` : ''}. Undergraduate and graduate students are welcome to ask about getting involved.`]],
      ['What you will learn', [() => 'Participants build skills in research design, evidence and writing, and present their work at the end of the term.']],
      ['How to get involved', [t => `Contact the department office or visit during office hours. Application deadlines and enrollment limits are posted each term on the ${t.site} website.`]],
    ],
    aside: t => ['Contact the department', `<p>${t.town} Hall, Room ${100 + t.n % 300}</p><p>${t.phone}</p><p>Office hours: Monday to Friday, 9 a.m. to 4 p.m.</p>`, ['Email the department', 'Request information']],
  },
  municipality: {
    tools: ['Print', 'Share', 'Translate'], toc: 'Page sections', cards: 'Related city services', tagLabel: 'Topics', cite: null, footer: 'feedback',
    sections: [
      ['Get started', [t => `${t.title} is handled by ${t.site}. ${t.lead ? `The listed ${t.leadLabel} is “${t.lead}”.` : ''} Residents can apply online, by phone, or in person at City Hall.`,
        () => 'Before you start, have your address, a photo ID, and any permit or case numbers ready. Most requests are reviewed within ten business days.']],
      ['What you need to know', [t => `Fees, schedules and eligibility can change. Check this page before you visit, or call 311 for help in your language.`]],
      ['311 service requests', [() => 'Report a problem or ask a question any time through 311. You can track your request with the case number we send you.']],
    ],
    aside: t => ['Contact', `<p>${t.phone}</p><p>1 City Hall Square, Room ${200 + t.n % 600}</p><p class="rf-hours"><span>Office hours</span> Monday through Friday, 9 a.m. – 5 p.m.</p>`, ['Send an email', 'View upcoming hearings']],
  },
  government: {
    tools: ['Share this page', 'Print', 'Subscribe to updates'], toc: 'On this page', cards: 'Related programs and resources', tagLabel: 'Topics', cite: null, footer: 'helpful',
    sections: [
      ['Who is eligible', [t => `${t.title} is administered by ${t.site}. ${t.lead ? `Its ${t.leadLabel} is “${t.lead}”.` : ''} Eligibility depends on where you live, your income, and the type of help you need.`]],
      ['How to apply', [() => 'Most people apply online. You can also apply by mail or at a local office. Have your Social Security number and proof of address ready.',
        () => 'After you apply, you will get a confirmation number. Keep it to check your status or to make changes.']],
      ['Get help', [t => `Call ${t.phone}, Monday through Friday, 8 a.m. to 8 p.m. Eastern time. Help is available in English and Spanish.`]],
    ],
    aside: t => ['Have a question?', `<p>Ask a real person about this program.</p><p class="rf-big">${t.phone}</p><p>Monday to Friday, 8 a.m. to 8 p.m.</p>`, ['Chat with us', 'Find a local office']],
  },
  healthcare: {
    tools: ['Print', 'Share', 'Email'], toc: 'On this page', cards: 'Related care and resources', tagLabel: 'Health topics', cite: null, footer: 'reviewed',
    sections: [
      ['Overview', [t => `${t.title} is offered by ${t.site}. ${t.lead ? `The care team lists ${t.leadLabel} as “${t.lead}”.` : ''} Our clinicians work with you and your family to plan care that fits your needs.`]],
      ['What to expect', [() => 'Your first visit usually takes about an hour. Bring your insurance card, a list of medicines, and any recent test results.',
        t => `After your visit, you can read notes and test results in the patient portal and send questions to your care team.`]],
      ['Questions to ask', [() => 'Write down your questions before your appointment. Ask about treatment options, side effects, and when to call if symptoms change.']],
    ],
    aside: t => ['Make an appointment', `<p class="rf-big">${t.phone}</p><p>Monday to Friday, 7 a.m. to 7 p.m. Interpreter services are free.</p>`, ['Request an appointment', 'Find a location']],
  },
  records: {
    tools: ['Print', 'Cite this record', 'Request copies', 'Share'], toc: 'Contents', cards: 'Related records', tagLabel: 'Subjects', cite: 'Cite this record', footer: 'record',
    sections: [
      ['Scope and content', [t => `This ${lower(t.type)} documents ${t.title}. ${t.lead ? `Archivists recorded its ${t.leadLabel} as “${t.lead}”.` : ''} The material reflects the work of the creating office and the people it served.`,
        t => `Records were transferred to ${t.site} in their original order. Researchers often use them alongside other records from the same office.`]],
      ['Access and use', [() => 'The records are open for research. Some files are restricted for privacy; staff review them before copies are made.']],
    ],
    aside: t => ['Visit the research room', `<p>Tuesday to Friday, 9 a.m. to 4:30 p.m. Appointments recommended.</p><p>${t.phone}</p><p>Bring a photo ID. Pencils only in the research room.</p>`, ['Book an appointment', 'Order reproductions']],
  },
  news: {
    tools: ['Share', 'Save', 'Gift this article', 'Print'], toc: 'In this story', cards: 'More from the newsroom', tagLabel: 'Topics', cite: null, footer: 'corrections',
    sections: [
      ['', [t => `${t.town.toUpperCase()} — ${t.title} drew attention across the region this week. ${t.lead ? `Records list the ${t.leadLabel} as “${t.lead}”.` : ''}`,
        t => `Residents interviewed by ${t.site} described how the news affected their neighborhoods, schools and businesses.`,
        () => 'Officials said more information would be released in the coming weeks, and that public comment remains open.']],
      ['What happens next', [t => `${t.site} will continue to follow the story. Readers with information can contact the newsroom through the tip line.`]],
    ],
    aside: () => ['Get the morning briefing', '<p>The day’s top local stories in your inbox, every weekday at 6 a.m.</p>', ['Sign up', 'See all newsletters']],
  },
  documentation: {
    tools: ['Copy link', 'View source', 'Report a problem'], toc: 'In this article', cards: 'See also', tagLabel: 'Keywords', cite: null, footer: 'modified',
    sections: [
      ['Overview', [t => `${t.title} is documented here for developers using ${t.site}. ${t.lead ? `Its ${t.leadLabel} is “${t.lead}”.` : ''} This page explains when to use it and what to check before upgrading.`]],
      ['Example', [() => 'The following example shows a minimal configuration. Copy it into your project and adjust the values for your environment.'], 'code'],
      ['Notes', [t => `Behavior can differ between versions. Check the release notes for changes to this feature before deploying to production.`]],
    ],
    aside: () => ['Help improve these docs', '<p>Found a problem with this page? Edit it or open an issue. Contributions are reviewed by maintainers.</p>', ['Edit this page', 'Open an issue']],
  },
  nonprofit: {
    tools: ['Share', 'Donate', 'Print'], toc: 'On this page', cards: 'More ways to help', tagLabel: 'Focus areas', cite: null, footer: 'updated',
    sections: [
      ['About this work', [t => `${t.title} is part of how ${t.site} supports neighbors in need. ${t.lead ? `Program staff list its ${t.leadLabel} as “${t.lead}”.` : ''} Volunteers and partners make the work possible.`]],
      ['Our impact', [t => `Last year, donors and volunteers helped thousands of families through programs like this one. Every gift goes to local services first.`]],
      ['How you can help', [() => 'Give once or monthly, volunteer your time, or host a drive with your school, congregation or workplace.']],
    ],
    aside: () => ['Make a difference today', '<p class="rf-big">Your gift helps families right now.</p><p>Gifts are tax-deductible to the extent allowed by law.</p>', ['Donate now', 'Volunteer']],
  },
};
const FALLBACK = RECIPES.government;

function context(site, page, esc, typeLabel) {
  const fields = page.fields ?? {};
  const keys = Object.keys(fields).filter(k => k !== 'title' && k !== page.image?.field && typeof fields[k] === 'string' && fields[k].length > 0 && fields[k].length < 60);
  const leadKey = keys[0];
  const n = seedFor(site.seed ?? 0, site.id ?? '', page.pageId ?? page.url ?? '', 'furniture');
  const words = String(page.title ?? '').split(/[^A-Za-z]+/).filter(w => w.length > 4);
  const relLabel = (page.links ?? []).find(l => l && !/^(previous|next) page$/i.test(String(l.label)))?.label;
  return {
    n, esc,
    title: esc(page.title ?? ''), site: esc(site.name ?? ''),
    type: esc(typeLabel || 'record'),
    lead: leadKey ? esc(fields[leadKey]) : '', leadLabel: leadKey ? esc(lower(page.fieldLabels?.[leadKey] ?? leadKey.replace(/([a-z])([A-Z])/g, '$1 $2'))) : '',
    topic: esc(lower(words[n % Math.max(words.length, 1)] ?? 'local history')),
    rel: relLabel ? esc(relLabel) : '',
    town: TOWNS[n % TOWNS.length],
    phone: `(555) 01${n % 10}-${String(1000 + (n >>> 4) % 9000)}`,
    date: `${MONTHS[(n >>> 3) % 12]} ${1 + (n >>> 7) % 28}, ${2024 + (n >>> 11) % 2}`,
  };
}

const btn = text => `<button type="button" class="rf-btn">${text}</button>`;

function sectionsHtml(recipe, t, slug) {
  return recipe.sections.map(([heading, paras, extra], i) => {
    const id = `rf-${slug}-${i + 1}`;
    const code = extra === 'code' ? `<pre class="rf-code"><code>${t.esc(`{\n  "name": "${String(t.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}",\n  "enabled": true,\n  "retries": 3\n}`)}</code></pre>` : '';
    return `<section class="rf-section" id="${id}">${heading ? `<h2>${heading}</h2>` : ''}${paras.map(p => `<p>${p(t).trim()}</p>`).join('')}${code}</section>`;
  }).join('');
}

// Detail-page furniture: { top, body, aside, bottom } strings.
export function detailFurniture(site, page, { esc, typeLabel }) {
  const recipe = RECIPES[site.domain] ?? FALLBACK;
  const t = context(site, page, esc, typeLabel);
  const slug = 'sec';
  const named = recipe.sections.filter(([heading]) => heading);
  const toc = `<nav class="rf-toc" aria-label="${recipe.toc}"><h2>${recipe.toc}</h2><ol>${recipe.sections.map(([heading], i) => heading ? `<li><a href="#rf-${slug}-${i + 1}">${heading}</a></li>` : '').join('')}</ol></nav>`;
  const tools = `<div class="rf-tools" role="group" aria-label="Page tools">${recipe.tools.map(btn).join('')}</div>`;
  const [asideTitle, asideBody, asideButtons] = recipe.aside(t);
  const aside = `<aside class="rf-aside rf-aside-${site.domain ?? 'site'}"><h2>${asideTitle}</h2>${asideBody}<div class="rf-actions">${asideButtons.map(btn).join('')}</div></aside>`;
  const tagPool = (TAGS[site.domain] ?? TAGS.government);
  const tags = [tagPool[t.n % tagPool.length], tagPool[(t.n >>> 5) % tagPool.length], t.type].filter((v, i, a) => a.indexOf(v) === i);
  const tagHtml = `<div class="rf-tags"><h2>${recipe.tagLabel}</h2><ul>${tags.map(tag => `<li>${tag}</li>`).join('')}</ul></div>`;
  const cite = recipe.cite ? `<div class="rf-cite"><h2>${recipe.cite}</h2><p>“${t.title}.” ${t.site}. Accessed ${t.date}.</p>${btn('Copy citation')}</div>` : '';
  const footers = {
    record: `<p class="rf-updated">Record last updated ${t.date}. Report an error or share more information with our staff.</p>`,
    updated: `<p class="rf-updated">Last updated ${t.date}</p>`,
    feedback: `<div class="rf-feedback"><p>Was this information helpful? Tell us how we can improve this page.</p>${btn('Provide your feedback')}${btn('Back to top')}</div>`,
    helpful: `<div class="rf-feedback"><p>Was this page helpful?</p>${btn('Yes')}${btn('No')}<p class="rf-updated">Last updated: ${t.date}</p></div>`,
    reviewed: `<p class="rf-updated">Medically reviewed ${t.date}. This information does not replace advice from your doctor.</p>`,
    corrections: `<p class="rf-updated">Published ${t.date}. To report a correction, contact the standards editor.</p>`,
    modified: `<div class="rf-feedback"><p>Was this page helpful to you?</p>${btn('Yes')}${btn('No')}<p class="rf-updated">This page was last modified on ${t.date}.</p></div>`,
  };
  return {
    top: `${tools}${named.length > 1 ? toc : ''}`,
    body: `<div class="rf-body">${sectionsHtml(recipe, t, slug)}</div>`,
    aside,
    bottom: `${tagHtml}${cite}${footers[recipe.footer] ?? footers.updated}`,
    cardsHeading: recipe.cards,
  };
}

const TAGS = {
  museum: ['American history', 'Design', 'Decorative arts', 'Craft', 'Industry'], library: ['Local history', 'Biography', 'Book clubs', 'Families', 'Reading'],
  university: ['Research', 'Graduate study', 'Public engagement', 'Sustainability', 'Data science'], municipality: ['City services', 'Neighborhoods', 'Permits', 'Streets', 'Parks'],
  government: ['Benefits', 'Housing', 'Health', 'Small business', 'Public safety'], healthcare: ['Prevention', 'Family health', 'Nutrition', 'Heart health', 'Wellness'],
  records: ['Land records', 'Genealogy', 'Maps', 'Local government', 'Court records'], news: ['City Hall', 'Schools', 'Transportation', 'Business', 'Environment'],
  documentation: ['Configuration', 'API', 'Deployment', 'Security', 'CLI'], nonprofit: ['Disaster relief', 'Volunteering', 'Food access', 'Blood drives', 'Youth'],
};

// "More like this" cards over the page's own model links only.
export function relatedCards(site, page, links, { esc, href, thumb, heading }) {
  const cards = links.map((link, i) => {
    const media = thumb(link) ?? `<span class="rf-tile rf-tile-${seedFor(site.seed ?? 0, link.href, 'tile') % 5}" aria-hidden="true">${esc(initials(link.label))}</span>`;
    return `<li class="rf-card">${media}<a href="${href(link.href)}">${esc(link.label)}</a><span class="rf-card-meta">${esc(link.type ? link.type.replace(/([a-z])([A-Z])/g, '$1 $2') : (i === 0 ? 'Related' : 'See also'))}</span></li>`;
  }).join('');
  return `<section aria-labelledby="related-heading" class="rf-related"><h2 class="section-heading" id="related-heading">${esc(heading)}</h2><ul class="link-list rf-cards">${cards}</ul></section>`;
}

const LISTING_COPY = {
  museum: ['Browse the collection by object, maker and exhibition. Every record includes images and curatorial notes where available.', 'Refine by', ['On view', 'Has image', 'Open access']],
  library: ['Search the catalog and browse what is new at every branch. Place holds online and pick them up at the location you choose.', 'Narrow your results', ['Available now', 'New this month', 'eBook']],
  university: ['Explore courses, programs, people and research across the university.', 'Filter', ['Undergraduate', 'Graduate', 'Open to the public']],
  municipality: ['Find city services, offices, meetings and notices. Most services can be started online.', 'Filter by topic', ['Online services', 'Permits', 'Public notices']],
  government: ['Browse programs, departments, policies and publications.', 'Filter', ['Residents', 'Businesses', 'Publications']],
  healthcare: ['Find care, clinics, providers and health information.', 'Filter results', ['Accepting new patients', 'Video visits', 'Walk-ins']],
  records: ['Browse record series, collections and finding aids. Use the research room for original materials.', 'Refine', ['Digitized', 'Open to the public', 'Finding aids']],
  news: ['The latest reporting from our newsroom.', 'Sections', ['Local', 'Politics', 'Business']],
  documentation: ['Guides, references, tutorials and release notes.', 'Filter', ['Getting started', 'API reference', 'Release notes']],
  nonprofit: ['Programs, grants, reports and ways to volunteer.', 'Filter', ['Volunteer', 'Programs', 'Reports']],
};

export function listingFurniture(site, page, { esc, count }) {
  const [intro, refine, chipsList] = LISTING_COPY[site.domain] ?? LISTING_COPY.government;
  const sorts = ['Relevance', 'Title A–Z', 'Newest first'];
  return {
    top: `<p class="rf-intro">${intro}</p><div class="rf-resultbar"><p>Showing ${count} ${count === 1 ? 'result' : 'results'}</p><label class="rf-sort">Sort by <select name="sort">${sorts.map(s => `<option>${s}</option>`).join('')}</select></label></div>`,
    aside: `<aside class="rf-aside rf-refine"><h2>${refine}</h2><ul class="rf-checks">${chipsList.map((c, i) => `<li><label><input type="checkbox" name="f${i}"> ${c}</label></li>`).join('')}</ul><h2>Need help?</h2><p>Contact ${esc(site.name ?? '')} staff for help finding what you need.</p></aside>`,
  };
}

export const listingThumb = (site, url, esc, label) => `<span class="rf-tile rf-tile-${seedFor(site.seed ?? 0, url, 'tile') % 5}" aria-hidden="true">${esc(initials(label))}</span>`;
