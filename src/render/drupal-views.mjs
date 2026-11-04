// Drupal Views listings for sites generated with the Drupal markup profile (cmsProfile 'drupal').
//
// Real Drupal sites list content with a View: a page display with a result summary header, exposed sorts, Facets
// blocks with counts, primary tabs for other displays and the core pager (see README "Drupal Views listings").
// This module renders that structure from the site's own records and writes every filtered, sorted and paged
// variant as a real static file, so each facet, sort, tab and pager link opens a page with the right records on any
// static host (the SiteForge preview server, or a WordPress/Drupal install of the generated site, which serves files
// by path and does not route query strings).
//
// Variant pages are not answer-key content pages. They declare the unfiltered listing as canonical and are listed in
// private/drupal-views.json (written by the generator), the same way crawler-trap URL variants are described.
import { escapeHtml as esc, hash, seedFor, slug } from '../site/util.mjs';

export const DRUPAL_VIEWS_VERSION = 1;
const MAX_FACETS = 2;
const FACET_HARD_LIMIT = 10;
const PAGER_QUANTITY = 9;
const RESERVED = new Set(['page', 'sort', 'current', 'upcoming', 'past']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const contexts = new WeakMap();

const humanize = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const machine = value => slug(value).replaceAll('-', '_') || 'content';
const longDate = iso => ISO_DATE.test(iso ?? '') ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}` : String(iso ?? '');
const valuesOf = page => page.canonicalValues ?? page.fields ?? {};
const listingMatch = page => /^listing-(.+)-(\d+)$/.exec(page?.pageId ?? '');

function facetValueSlugs(values) {
  const used = new Map();
  return values.map(value => {
    const base = slug(value);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

// One View per content type: its records, facets, sorts and tabs, computed from the source records.
function buildView(site, type, listings, records, byUrl) {
  const base = listings[0].url;
  const label = String(listings[0].title ?? humanize(type));
  const id = machine(base.replace(/^\/|\/$/g, ''));
  const fieldNames = [...new Set(records.flatMap(record => Object.keys(valuesOf(record))))].filter(name => name !== 'title');
  const dateFields = fieldNames.filter(name => records.some(record => ISO_DATE.test(valuesOf(record)[name] ?? ''))
    && records.every(record => valuesOf(record)[name] === undefined || ISO_DATE.test(valuesOf(record)[name])));
  const facets = [];
  const used = new Set(RESERVED);
  const addFacet = (alias, label, field, valueOf) => {
    if (facets.length >= MAX_FACETS || used.has(alias)) return;
    const counts = new Map();
    for (const record of records) { const value = valueOf(record); if (value) counts.set(value, (counts.get(value) ?? 0) + 1); }
    if (counts.size < 2 || counts.size >= records.length) return;
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, FACET_HARD_LIMIT);
    const slugs = facetValueSlugs(top.map(([value]) => value));
    used.add(alias);
    facets.push({ alias, label, field, valueOf, values: top.map(([value, count], i) => ({ value, slug: slugs[i], count })) });
  };
  const relation = records.find(record => record.relationships?.[0]?.targetUrl && byUrl.get(record.relationships[0].targetUrl));
  if (relation) {
    const targetType = byUrl.get(relation.relationships[0].targetUrl).contentType;
    addFacet(slug(targetType), humanize(targetType), `relationship:${targetType}`, record => valuesOf(byUrl.get(record.relationships?.[0]?.targetUrl) ?? {}).title);
  }
  for (const name of fieldNames) {
    if (dateFields.includes(name)) continue;
    const values = records.map(record => valuesOf(record)[name]).filter(value => typeof value === 'string');
    const distinct = new Set(values);
    if (values.length && values.every(value => value.length <= 48 && !value.includes('\n')) && distinct.size <= Math.min(15, Math.ceil(records.length * 0.7))) {
      addFacet(slug(humanize(name)), humanize(name), name, record => valuesOf(record)[name]);
    }
  }
  if (dateFields.length) addFacet('year', 'Year', `year:${dateFields[0]}`, record => valuesOf(record)[dateFields[0]]?.slice(0, 4));
  const sorts = [{ key: '', label: 'Featured', by: 'nid', order: 'ASC' },
    { key: 'title-asc', label: 'Title (A-Z)', by: 'title', order: 'ASC' }, { key: 'title-desc', label: 'Title (Z-A)', by: 'title', order: 'DESC' }];
  if (dateFields.length) sorts.push({ key: `${slug(humanize(dateFields[0]))}-desc`, label: `${humanize(dateFields[0])} (newest first)`, by: dateFields[0], order: 'DESC' });
  // Tabs (other page displays of the View) for dated events: Current/Upcoming/Past as on si.edu/exhibitions.
  const start = dateFields.find(name => /^(start|meeting|event)/i.test(name));
  const end = start && dateFields.find(name => /^end/i.test(name));
  let tabs = [];
  let referenceDate = null;
  if (start) {
    const starts = records.map(record => valuesOf(record)[start]).filter(Boolean).sort();
    referenceDate = starts[Math.floor(starts.length / 2)];
    const s = record => valuesOf(record)[start];
    const e = record => valuesOf(record)[end] ?? s(record);
    tabs = [...(end ? [{ id: 'current', label: `Current ${label}`, test: r => s(r) && s(r) <= referenceDate && e(r) >= referenceDate }] : []),
      { id: 'upcoming', label: `Upcoming ${label}`, test: r => s(r) && s(r) > referenceDate },
      { id: 'past', label: `Past ${label}`, test: r => s(r) && e(r) < referenceDate }];
  }
  return { type, id, label, base, listings, records, facets, sorts, tabs, referenceDate, dateFields,
    itemFields: listings.some(page => page.repeatedItems) ? [...new Set(listings.flatMap(page => (page.repeatedItems ?? []).flatMap(item => Object.keys(item.fields))))].filter(name => name !== 'title').sort() : null,
    table: listings[0].template === 'listing-0' || site.shell === 'archive' };
}

export function bindDrupalViews(site, pages) {
  if (site?.cmsProfile !== 'drupal') return null;
  const byUrl = new Map(pages.map(page => [page.url, page]));
  const listings = new Map();
  for (const page of pages) {
    const match = page.kind === 'listing' && listingMatch(page);
    if (!match) continue;
    if (!listings.has(match[1])) listings.set(match[1], []);
    listings.get(match[1])[Number(match[2]) - 1] = page;
  }
  const views = new Map();
  for (const [type, list] of listings) {
    const records = pages.filter(page => page.kind === 'detail' && page.contentType === type);
    if (list[0] && records.length) views.set(type, buildView(site, type, list.filter(Boolean), records, byUrl));
  }
  const context = { views, byUrl };
  contexts.set(site, context);
  return context;
}

// ---- states, filtering and URLs ---------------------------------------------------------------------------------
const sortOf = (view, key) => view.sorts.find(sort => sort.key === key) ?? view.sorts[0];
function stateRecords(view, state) {
  let list = view.records;
  if (state.filter?.kind === 'tab') list = list.filter(view.tabs.find(tab => tab.id === state.filter.id).test);
  if (state.filter?.kind === 'facet') {
    const facet = view.facets.find(item => item.alias === state.filter.alias);
    const value = facet.values.find(item => item.slug === state.filter.slug).value;
    list = list.filter(record => facet.valueOf(record) === value);
  }
  const sort = sortOf(view, state.sort);
  if (sort.by === 'nid') return list;
  const key = record => sort.by === 'title' ? String(valuesOf(record).title ?? '') : String(valuesOf(record)[sort.by] ?? '');
  return [...list].sort((a, b) => {
    const left = key(a), right = key(b);
    if (!left !== !right) return left ? -1 : 1; // records without the sort value go last, as with NULLS LAST
    const order = left.localeCompare(right, 'en', { sensitivity: 'base' }) || view.records.indexOf(a) - view.records.indexOf(b);
    return sort.order === 'DESC' ? -order : order;
  });
}
const isDefault = state => !state.filter && !state.sort;
export function viewPath(view, state, pageNumber = 1) {
  if (isDefault(state)) return pageNumber === 1 ? view.base : `${view.base}page/${pageNumber}/`;
  const parts = [state.filter?.kind === 'tab' ? state.filter.id : state.filter?.kind === 'facet' ? `${state.filter.alias}/${state.filter.slug}` : '',
    state.sort ? `sort/${state.sort}` : '', pageNumber > 1 ? `page/${pageNumber}` : ''].filter(Boolean);
  return `${view.base}${parts.join('/')}.html`;
}
function allStates(view) {
  const filters = [null, ...view.tabs.map(tab => ({ kind: 'tab', id: tab.id })),
    ...view.facets.flatMap(facet => facet.values.map(value => ({ kind: 'facet', alias: facet.alias, slug: value.slug })))];
  return filters.flatMap(filter => view.sorts.map(sort => ({ filter, sort: sort.key })));
}

// ---- markup -----------------------------------------------------------------------------------------------------
function domId(site, view, path) { return hash(['drupal-view-dom-id', site.seed, view.id, path]).slice(0, 64); }
const nodeIdFor = (site, record) => 1 + seedFor(site.seed, record.pageId, 'drupal-node-id') % 20000;

function tabsMarkup(view, state, h) {
  if (!view.tabs.length) return '';
  const active = state.filter?.kind === 'tab' ? state.filter.id : '';
  const items = [{ id: '', label: `All ${view.label}` }, ...view.tabs].map(tab => {
    const on = tab.id === active;
    const href = viewPath(view, { filter: tab.id ? { kind: 'tab', id: tab.id } : null, sort: state.sort });
    return `<li class="tabs__tab${on ? ' is-active' : ''}"><a href="${h.href(href)}" class="tabs__link${on ? ' is-active' : ''}"${on ? ' aria-current="page"' : ''}>${esc(tab.label)}${on ? '<span class="visually-hidden">(active tab)</span>' : ''}</a></li>`;
  }).join('');
  return `<div id="block-${h.theme}-primary-local-tasks" class="block block-core block-local-tasks-block"><nav class="tabs" role="navigation" aria-label="Tabs"><h2 class="visually-hidden">Primary tabs</h2><ul class="tabs primary">${items}</ul></nav></div>`;
}

function facetBlocks(view, state, h) {
  if (state.filter?.kind === 'tab' || !view.facets.length) return '';
  const active = state.filter?.kind === 'facet' ? state.filter : null;
  const blocks = view.facets.map(facet => {
    const items = facet.values.map(value => {
      const on = active?.alias === facet.alias && active.slug === value.slug;
      const href = viewPath(view, { filter: on ? null : { kind: 'facet', alias: facet.alias, slug: value.slug }, sort: state.sort });
      return `<li class="facet-item"><a href="${h.href(href)}" rel="nofollow"${on ? ' class="is-active"' : ''} data-drupal-facet-item-id="${esc(facet.alias)}-${esc(value.slug)}" data-drupal-facet-item-value="${esc(value.value)}" data-drupal-facet-item-count="${value.count}">${on ? '<span class="facet-item__status js-facet-deactivate">(-)</span>\n' : ''}<span class="facet-item__value">${esc(value.value)}</span>\n<span class="facet-item__count">(${value.count})</span></a></li>`;
    }).join('');
    const isActive = active?.alias === facet.alias;
    return `<div class="${isActive ? 'facet-active' : 'facet-inactive'} block-facet--links block block-facets block-facet-block${esc(facet.alias.replaceAll('-', ''))}" id="block-${h.theme}-${esc(facet.alias)}"><h2 class="block-title">${esc(facet.label)}</h2><div class="facets-widget-links"><ul data-drupal-facet-id="${esc(facet.alias.replaceAll('-', '_'))}" data-drupal-facet-alias="${esc(facet.alias)}" class="${isActive ? 'facet-active' : 'facet-inactive'} js-facets-links item-list__links">${items}</ul></div></div>`;
  }).join('');
  const summary = active ? (() => {
    const facet = view.facets.find(item => item.alias === active.alias);
    const value = facet.values.find(item => item.slug === active.slug);
    return `<div class="block-facets-summary block block-facets-summary-blocksummary" id="block-${h.theme}-facets-summary"><div data-drupal-facets-summary-id="summary"><ul class="facet-summary-items"><li class="facet-summary-item--clear"><a href="${h.href(viewPath(view, { filter: null, sort: state.sort }))}">Clear filters</a></li><li class="facet-summary-item--facet"><a href="${h.href(viewPath(view, { filter: null, sort: state.sort }))}" rel="nofollow"><span class="facet-item__status js-facet-deactivate">(-)</span> <span class="facet-item__value">${esc(facet.label)}: ${esc(value.value)}</span></a></li></ul></div></div>`;
  })() : '';
  return `<aside class="layout-sidebar-first" role="complementary"><div class="region region-sidebar-first">${summary}${blocks}</div></aside>`;
}

function exposedForm(view, state, h) {
  const formId = `views-exposed-form-${view.id.replaceAll('_', '-')}-page-1`;
  const links = view.sorts.map(sort => {
    const on = sort.key === (state.sort ?? '');
    const combine = `${sort.by}_${sort.order}`;
    return `<li><a href="${h.href(viewPath(view, { filter: state.filter, sort: sort.key }))}"${on ? ' class="bef-link--selected" aria-current="true"' : ''} name="sort_bef_combine[${esc(combine)}]" data-sort-by="${esc(sort.by)}" data-sort-order="${sort.order}">${esc(sort.label)}</a></li>`;
  }).join('');
  return `<form class="views-exposed-form bef-exposed-form" data-drupal-selector="${formId}" action="${h.href(view.base)}" method="get" id="${formId}" accept-charset="UTF-8"><div class="form--inline clearfix"><div class="js-form-item form-item js-form-type-select form-type-select js-form-item-sort-bef-combine form-item-sort-bef-combine"><span class="form-item__label">Sort by</span><div class="bef-links" id="edit-sort-bef-combine"><ul>${links}</ul></div></div></div></form>`;
}

function pagerMarkup(view, state, current, total, h) {
  if (total <= 1) return '';
  const href = n => h.href(viewPath(view, state, n));
  const headingId = `pagination-heading--${hash([view.id, state, current]).slice(0, 11)}`;
  const half = Math.floor(PAGER_QUANTITY / 2);
  let first = Math.max(1, current - half);
  const last = Math.min(total, first + PAGER_QUANTITY - 1);
  first = Math.max(1, last - PAGER_QUANTITY + 1);
  const item = (cls, n, title, hidden, text, rel = '') => `<li class="pager__item pager__item--${cls}"><a href="${href(n)}" title="${title}"${rel ? ` rel="${rel}"` : ''}><span class="visually-hidden">${hidden}</span><span aria-hidden="true">${text}</span></a></li>`;
  const pages = [];
  for (let n = first; n <= last; n++) {
    pages.push(`<li class="pager__item${n === current ? ' is-active' : ''}"><a href="${href(n)}" title="${n === current ? 'Current page' : `Go to page ${n}`}"${n === current ? ' aria-current="page"' : ''}><span class="visually-hidden">Page</span>${n}</a></li>`);
  }
  return `<nav class="pager" role="navigation" aria-labelledby="${headingId}"><h4 id="${headingId}" class="visually-hidden">Pagination</h4><ul class="pager__items js-pager__items">${current > 1 ? item('first', 1, 'Go to first page', 'First page', '« First') + item('previous', current - 1, 'Go to previous page', 'Previous page', '‹ Previous', 'prev') : ''}${first > 1 ? '<li class="pager__item pager__item--ellipsis" role="presentation">&hellip;</li>' : ''}${pages.join('')}${last < total ? '<li class="pager__item pager__item--ellipsis" role="presentation">&hellip;</li>' : ''}${current < total ? item('next', current + 1, 'Go to next page', 'Next page', 'Next ›', 'next') + item('last', total, 'Go to last page', 'Last page', 'Last »') : ''}</ul></nav>`;
}

function flagMarkup(site, record) {
  if (site.domain !== 'museum' || !record?.pageId) return '';
  const nid = nodeIdFor(site, record);
  return `<div class="flag flag-my-visit js-flag-my-visit-${nid} action-flag"><button type="button" class="flag-my-visit__toggle" aria-pressed="false" data-flag-id="my_visit" data-entity-id="${nid}"><span class="flag-my-visit__icon" aria-hidden="true">&#9825;</span> <span class="flag-my-visit__label">Add to My Visit</span></button></div>`;
}

function dateText(view, record) {
  const values = valuesOf(record);
  const [startField, endField] = [view.dateFields.find(name => /^(start|meeting|event)/i.test(name)) ?? view.dateFields[0], view.dateFields.find(name => /^end/i.test(name))];
  if (!startField || !values[startField]) return '';
  const time = iso => `<time datetime="${esc(iso)}">${esc(longDate(iso))}</time>`;
  return `${time(values[startField])}${endField && values[endField] && endField !== startField ? ` – ${time(values[endField])}` : ''}`;
}

// A row in the shape the answer key's repeated-item locations expect (<a> then <p><strong>Label</strong> value</p>).
function repeatedRow(site, view, item, record, h) {
  const fields = Object.entries(item.fields).filter(([key]) => key !== 'title');
  const content = `<a href="${h.href(item.url)}" hreflang="en">${esc(item.fields.title)}</a>${fields.map(([key, value]) => `<p class="views-field views-field-${esc(slug(key))}"><strong class="views-label views-label-${esc(slug(key))}">${esc(humanize(key))}</strong> <span class="field-content">${esc(value)}</span></p>`).join('')}${flagMarkup(site, record)}`;
  return view.table ? `<tr class="views-row"><td class="views-field views-field-title">${content}</td></tr>` : `<li class="views-row">${content}</li>`;
}

function cardRow(site, view, record, link, h) {
  const url = record?.url ?? link.href;
  const values = record ? valuesOf(record) : { title: link.label };
  const image = record?.image?.src ? `<div class="views-field views-field-field-image"><div class="field-content"><a href="${h.href(url)}" hreflang="en"><img loading="lazy" src="${h.href(record.image.src)}" width="480" height="640" alt="${esc(record.image.alt ?? '')}"></a></div></div>` : '';
  const dates = record ? dateText(view, record) : '';
  const facetText = record ? view.facets.filter(facet => !facet.field.startsWith('year:')).map(facet => [facet.alias, facet.valueOf(record)]).filter(([, text]) => text) : [];
  const teaserField = record && Object.keys(values).find(key => key !== 'title' && typeof values[key] === 'string' && values[key].length > 60 && !view.dateFields.includes(key));
  const teaser = teaserField ? values[teaserField].split('\n')[0] : '';
  const short = teaser.length > 180 ? `${teaser.slice(0, 180).replace(/\s+\S*$/, '')}…` : teaser;
  return `<div class="views-row">${image}<div class="views-field views-field-title"><span class="field-content"><a href="${h.href(url)}" hreflang="en">${esc(values.title ?? link?.label)}</a></span></div>${short ? `<div class="views-field views-field-body"><div class="field-content">${esc(short)}</div></div>` : ''}${dates ? `<div class="views-field views-field-field-dates"><div class="field-content">${dates}</div></div>` : ''}${facetText.map(([alias, text]) => `<div class="views-field views-field-field-${esc(alias)}"><div class="field-content">${esc(text)}</div></div>`).join('')}${flagMarkup(site, record)}</div>`;
}

function rowsMarkup(site, view, rows, h) {
  if (!rows.length) return `<div class="view-empty"><p>No ${esc(view.label.toLowerCase())} match this selection.</p></div>`;
  if (view.itemFields) {
    const items = rows.map(({ item, record }) => repeatedRow(site, view, item, record, h)).join('');
    return view.table ? `<div class="view-content"><table class="views-table views-view-table cols-1 repeated-records"><tbody>${items}</tbody></table></div>`
      : `<div class="view-content"><div class="item-list"><ul class="repeated-records">${items}</ul></div></div>`;
  }
  return `<div class="view-content">${rows.map(({ record, link }) => cardRow(site, view, record, link, h)).join('')}</div>`;
}

function itemFor(view, record) {
  const values = valuesOf(record);
  return { pageId: record.pageId, url: record.url, fields: Object.fromEntries(['title', ...view.itemFields].filter(name => Object.hasOwn(values, name)).map(name => [name, values[name]])) };
}

// The View for one page. Answer-key listing pages (the unfiltered display) take their rows from the page itself
// (links or repeatedItems), so the answer key's links and repeated-item locations stay exactly as before.
export function renderDrupalListing(site, page, h) {
  const context = contexts.get(site);
  const variant = page.drupalView;
  const match = listingMatch(page);
  const view = context?.views.get(variant?.type ?? match?.[1]);
  const state = variant?.state ?? { filter: null, sort: '' };
  const current = variant?.pageNumber ?? Number(match?.[2] ?? 1);
  const size = site.pageSize || 24;
  const viewInfo = view ?? { id: machine(page.url.replace(/^\/|\/$/g, '') || 'content'), label: String(page.title ?? '').replace(/ - Page \d+$/, ''), base: page.url, facets: [], sorts: [], tabs: [], dateFields: [], itemFields: page.repeatedItems ? Object.keys(page.repeatedItems[0]?.fields ?? {}).filter(key => key !== 'title') : null, table: page.template === 'listing-0' || site.shell === 'archive' };
  let rows, total, pageCount;
  if (!variant) {
    const recordLinks = (page.links ?? []).filter(link => !/^(previous|next) page$/i.test(link.label));
    const byUrl = context?.byUrl;
    rows = page.repeatedItems ? page.repeatedItems.map(item => ({ item, record: byUrl?.get(item.url) }))
      : recordLinks.map(link => ({ link, record: byUrl?.get(link.href) }));
    total = view ? view.records.length : rows.length;
    pageCount = view ? Math.max(1, Math.ceil(total / size)) : current + ((page.links ?? []).some(link => /^next page$/i.test(link.label)) ? 1 : 0);
  } else {
    const list = stateRecords(view, state);
    total = list.length;
    pageCount = Math.max(1, Math.ceil(total / size));
    rows = list.slice((current - 1) * size, current * size).map(record => ({ record, item: view.itemFields ? itemFor(view, record) : null }));
  }
  const start = total ? (current - 1) * size + 1 : 0;
  const end = Math.min(total, start + rows.length - (total ? 1 : 0));
  const displayId = state.filter?.kind === 'tab' ? `page_${2 + view.tabs.findIndex(tab => tab.id === state.filter.id)}` : 'page_1';
  const tab = state.filter?.kind === 'tab' ? view.tabs.find(item => item.id === state.filter.id) : null;
  const asOf = tab && view.referenceDate ? ` Dates as of ${longDate(view.referenceDate)}.` : '';
  const header = `<div class="view-header"><p class="views-result-summary">Displaying ${start} - ${end} of ${total} ${esc(viewInfo.label.toLowerCase())}.${asOf}</p></div>`;
  const path = variant?.path ?? page.url;
  const viewHtml = `<div class="view view-${esc(viewInfo.id.replaceAll('_', '-'))} view-id-${esc(viewInfo.id)} view-display-id-${displayId} js-view-dom-id-${domId(site, viewInfo, path)}">${header}${view ? `<div class="view-filters">${exposedForm(view, state, h)}</div>` : ''}${rowsMarkup(site, { ...viewInfo, table: variant ? viewInfo.table : page.template === 'listing-0' || site.shell === 'archive' }, rows, h)}${pagerMarkup(view ?? viewInfo, state, current, pageCount, h)}</div>`;
  const facets = view ? facetBlocks(view, state, h) : '';
  const main = `<div id="block-${h.theme}-content" class="block block-system block-system-main-block"><div class="views-element-container">${viewHtml}</div></div>`;
  return `<div class="drupal-views-layout${facets ? ' has-sidebar' : ''}">${view ? tabsMarkup(view, state, h) : ''}<div class="drupal-views-columns">${facets}<div class="layout-content">${main}</div></div></div>`;
}

// ---- variant pages ----------------------------------------------------------------------------------------------
function stateTitle(view, state, pageNumber) {
  const tab = state.filter?.kind === 'tab' ? view.tabs.find(item => item.id === state.filter.id) : null;
  return `${tab ? tab.label : view.label}${pageNumber > 1 ? ` - Page ${pageNumber}` : ''}`;
}
const describeState = (view, state) => ({ display: state.filter?.kind === 'tab' ? state.filter.id : 'all',
  facet: state.filter?.kind === 'facet' ? { alias: state.filter.alias, value: view.facets.find(f => f.alias === state.filter.alias).values.find(v => v.slug === state.filter.slug).value } : null,
  sort: sortOf(view, state.sort).key || 'default' });

// Every non-default state of every View, page by page: { path, page } where page is a synthetic listing page to
// render. Its url is the folder the file lives in, so relative links resolve as a browser resolves them.
export function drupalViewVariants(site) {
  const context = contexts.get(site);
  if (!context) return [];
  const out = [];
  for (const view of context.views.values()) {
    const template = view.listings[0];
    for (const state of allStates(view)) {
      if (isDefault(state)) continue;
      const list = stateRecords(view, state);
      const pageCount = Math.max(1, Math.ceil(list.length / (site.pageSize || 24)));
      for (let n = 1; n <= pageCount; n++) {
        const path = viewPath(view, state, n);
        const id = 1e9 + seedFor(site.seed, path, 'drupal-view-variant') % 1e9;
        out.push({ path, view, state, pageNumber: n, pageCount, total: list.length,
          records: list.slice((n - 1) * (site.pageSize || 24), n * (site.pageSize || 24)).map(record => record.pageId),
          page: { ...template, pageId: `listing-${view.type}-${id}`, url: path.slice(0, path.lastIndexOf('/') + 1), title: stateTitle(view, state, n),
            fields: { title: stateTitle(view, state, n) }, canonicalValues: { title: stateTitle(view, state, n) }, links: [], relationships: [], repeatedItems: undefined, repeatedItemLocations: undefined,
            noiseEvents: [], drupalView: { type: view.type, state, pageNumber: n, path } } });
      }
    }
  }
  return out;
}

// Files to add to public/ and the private description of them. `render(page)` returns the page HTML.
export function drupalViewsArtifacts(site, render) {
  const variants = drupalViewVariants(site);
  const files = variants.map(variant => {
    const canonical = new URL(variant.view.base, site.baseUrl).href;
    // The synthetic page's url is its folder (for relative links); og:url and hreflang must name the real file.
    const self = esc(new URL(variant.path, site.baseUrl).href);
    const folder = esc(new URL(variant.page.url, site.baseUrl).href);
    const html = render(variant.page).replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(canonical)}">`)
      .replaceAll(`<meta property="og:url" content="${folder}">`, `<meta property="og:url" content="${self}">`)
      .replaceAll(`<link rel="alternate" hreflang="en" href="${folder}">`, `<link rel="alternate" hreflang="en" href="${self}">`);
    return { path: variant.path, body: html };
  });
  const context = contexts.get(site);
  const manifest = {
    version: DRUPAL_VIEWS_VERSION,
    note: 'Filtered, sorted and paged Drupal Views variants. They are not answer-key content pages: each declares the unfiltered listing as canonical and lists only records that are answer-key detail pages. Treat them like crawler-trap URL variants (expected duplicates of the listing at "canonical").',
    views: [...(context?.views.values() ?? [])].map(view => ({ type: view.type, viewId: view.id, base: view.base, label: view.label, referenceDate: view.referenceDate,
      facets: view.facets.map(facet => ({ alias: facet.alias, label: facet.label, source: facet.field, values: facet.values.map(({ value, slug: s, count }) => ({ value, slug: s, count })) })),
      sorts: view.sorts.map(({ key, label, by, order }) => ({ key: key || 'default', label, by, order })), tabs: view.tabs.map(({ id, label }) => ({ id, label })) })),
    variants: variants.map(variant => ({ url: variant.path, canonical: variant.view.base, contentPage: false, type: variant.view.type, ...describeState(variant.view, variant.state),
      page: variant.pageNumber, pageCount: variant.pageCount, total: variant.total, recordPageIds: variant.records })),
  };
  return { files, manifest };
}

// ---- assets -----------------------------------------------------------------------------------------------------
export function drupalViewsCss() {
  return `.drupal-views-columns{display:grid;gap:32px;align-items:start}.has-sidebar .drupal-views-columns{grid-template-columns:minmax(200px,260px) minmax(0,1fr)}@media (max-width:760px){.has-sidebar .drupal-views-columns{grid-template-columns:minmax(0,1fr)}}
.tabs.primary{display:flex;flex-wrap:wrap;gap:4px;list-style:none;margin:0 0 20px;padding:0;border-bottom:2px solid currentColor}.tabs__link{display:block;padding:8px 14px;text-decoration:none}.tabs__link.is-active{font-weight:700;background:rgba(0,0,0,.07)}
.region-sidebar-first .block{margin:0 0 24px}.region-sidebar-first .block-title{font-size:1rem;margin:0 0 8px}.facets-widget-links ul,.facet-summary-items{list-style:none;margin:0;padding:0}.facet-item a,.facet-summary-items a{display:flex;justify-content:space-between;gap:8px;padding:4px 0;text-decoration:none}.facet-item a.is-active{font-weight:700}.facet-item__count{opacity:.75}
.view-filters{margin:12px 0 20px}.bef-links ul{display:flex;flex-wrap:wrap;gap:6px 14px;list-style:none;margin:4px 0 0;padding:0}.bef-link--selected{font-weight:700;text-decoration:none}.form-item__label{font-weight:700}
.view-content .views-row{display:grid;gap:6px;padding:16px 0;border-bottom:1px solid rgba(0,0,0,.12)}.view-content .views-row img{max-width:160px;height:auto}.views-field-title{font-weight:700;font-size:1.05rem}.view-content ul.repeated-records{list-style:none;margin:0;padding:0}.view-empty{padding:16px 0}
.flag-my-visit__toggle{cursor:pointer;border:1px solid currentColor;background:none;border-radius:999px;padding:4px 12px;font:inherit}.flag-my-visit__toggle[aria-pressed="true"]{background:rgba(200,30,60,.12)}
.pager__items{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:24px 0 0;padding:0}.pager__item a{display:block;padding:4px 10px}.pager__item.is-active a{font-weight:700;text-decoration:none}
`;
}

// Drupal behaviour for the "My Visit" flag toggles (si.edu exhibition cards); saved in this browser only.
export function drupalViewsJs() {
  return `(function(){var KEY="drupal.flag.my_visit";function load(){try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){return[]}}function save(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}function paint(b,on){if(b.getAttribute("aria-pressed")===(on?"true":"false")&&b.hasAttribute("data-painted"))return;b.setAttribute("data-painted","");b.setAttribute("aria-pressed",on?"true":"false");var l=b.querySelector(".flag-my-visit__label");if(l)l.textContent=on?"Added to My Visit":"Add to My Visit";var i=b.querySelector(".flag-my-visit__icon");if(i)i.innerHTML=on?"&#9829;":"&#9825;"}function init(){var saved=load();document.querySelectorAll(".flag-my-visit__toggle").forEach(function(b){paint(b,saved.indexOf(b.getAttribute("data-entity-id"))>=0)})}document.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest(".flag-my-visit__toggle");if(!b)return;var id=b.getAttribute("data-entity-id"),saved=load(),at=saved.indexOf(id);if(at>=0)saved.splice(at,1);else saved.push(id);save(saved);paint(b,at<0)});if(document.readyState!=="loading")init();else document.addEventListener("DOMContentLoaded",init);new MutationObserver(function(){init()}).observe(document.documentElement,{childList:true,subtree:true})})();
`;
}
