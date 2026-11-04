// (no util imports: clutter uses its own fast hash)
import { annualReportPdf, realScript, realStyle } from './site-runtime.mjs';

// "Realistic" page-source clutter modeled on production WordPress, Drupal and custom sites
// (studied from real sources such as theankler.com, nasa.gov, whitehouse.gov, rollingstone.com,
// dmpl.org, lexpublib.org, sfpl.org, boston.gov, cam.ac.uk and npr.org). Only the structure is
// reproduced: names, handles, IDs and versions are seeded fictional values. Nothing here loads
// an external resource, makes a network request or adds a link to a page that does not exist.

const PLUGIN_POOL = {
  wordpress: [
    ['contact-form-7', 'Contact Form 7', '6.1.2', ['includes/css/styles.css'], ['includes/js/index.js']],
    ['jetpack', 'Jetpack', '15.1', ['modules/related-posts/related-posts.css', 'modules/carousel/jetpack-carousel.css'], ['_inc/build/carousel/jetpack-carousel.min.js']],
    ['gravityforms', 'Gravity Forms', '2.9.18', ['assets/css/dist/theme.min.css'], ['js/jquery.json.min.js', 'js/gravityforms.min.js']],
    ['the-events-calendar', 'The Events Calendar', '6.15.6', ['src/resources/css/tribe-events-single-skeleton.min.css'], ['common/src/resources/js/tribe-common.min.js']],
    ['wordpress-seo', 'Yoast SEO', '26.2', [], []],
    ['complianz-gdpr', 'Complianz', '7.4.2', ['cookiebanner/css/defaults/banner.min.css'], ['cookiebanner/js/complianz.min.js']],
    ['wp-rocket', 'WP Rocket', '3.19.4', [], []],
    ['popup-maker', 'Popup Maker', '1.21.2', ['assets/css/pum-site.min.css'], ['assets/js/site.min.js']],
    ['accessibility-checker', 'Accessibility Checker', '1.31.0', [], ['build/frontendFixes.bundle.js']],
    ['advanced-ads', 'Advanced Ads', '2.0.12', [], ['public/assets/js/advanced.min.js']],
    ['wp-parsely', 'Parse.ly', '3.20.4', [], ['build/loader.js']],
    ['simple-calendar', 'Simple Calendar', '3.4.2', ['assets/generated/default-calendar-grid.min.css'], []],
    ['give', 'GiveWP', '4.10.1', ['build/assets/dist/css/give.css'], ['build/giveDonationFormEmbed.js']],
    ['wpforms-lite', 'WPForms', '1.9.8.1', ['assets/css/frontend/modern/wpforms-full.min.css'], []],
    ['stream', 'Stream', '4.1.1', [], []],
  ],
  drupal: [
    ['google_tag', 'Google Tag', '2.0.8', [], ['js/gtag.js']],
    ['metatag', 'Metatag', '2.1.1', [], []],
    ['webform', 'Webform', '6.2.9', ['css/webform.form.css', 'css/webform.element.details.toggle.css'], ['js/webform.behaviors.js']],
    ['simple_sitemap', 'Simple XML Sitemap', '4.2.2', [], []],
    ['extlink', 'External Links', '2.0.4', ['css/extlink.css'], ['js/extlink.js']],
    ['paragraphs', 'Paragraphs', '1.19.0', ['css/paragraphs.unpublished.css'], []],
    ['ckeditor5_plugin_pack', 'CKEditor 5 Plugin Pack', '1.3.1', [], []],
    ['eu_cookie_compliance', 'EU Cookie Compliance', '1.24.0', ['css/eu_cookie_compliance.css'], ['js/eu_cookie_compliance.min.js']],
    ['search_api_autocomplete', 'Search API Autocomplete', '1.10.0', ['css/search_api_autocomplete.css'], ['js/search_api_autocomplete.js']],
    ['smart_date', 'Smart Date', '4.2.3', ['css/smart_date.css'], []],
    ['better_exposed_filters', 'Better Exposed Filters', '7.0.6', ['css/better_exposed_filters.css'], ['js/better_exposed_filters.js']],
    ['slick', 'Slick Carousel', '3.0.1', ['css/layout/slick.module.css'], ['js/slick.load.min.js']],
    ['library_calendar', 'Library Calendar', '3.2.0', ['lc_calendar_theme/css/components/event-card.css', 'lc_calendar_theme/css/components/calendar-upcoming.css'], []],
  ],
};
const DRUPAL_CORE_CSS = ['core/misc/components/progress.module.css', 'core/misc/components/ajax-progress.module.css', 'core/modules/system/css/components/align.module.css', 'core/modules/system/css/components/fieldgroup.module.css', 'core/modules/system/css/components/container-inline.module.css', 'core/modules/system/css/components/clearfix.module.css', 'core/modules/system/css/components/details.module.css', 'core/modules/system/css/components/hidden.module.css', 'core/modules/system/css/components/item-list.module.css', 'core/modules/system/css/components/js.module.css', 'core/modules/system/css/components/nowrap.module.css', 'core/modules/system/css/components/position-container.module.css', 'core/modules/system/css/components/reset-appearance.module.css', 'core/modules/system/css/components/resize.module.css', 'core/modules/system/css/components/system-status-counter.css', 'core/modules/system/css/components/system-status-report-counters.css', 'core/modules/system/css/components/system-status-report-general-info.css', 'core/modules/system/css/components/tablesort.module.css', 'core/modules/views/css/views.module.css', 'core/modules/filter/css/filter.caption.css', 'core/modules/media/css/filter.caption.css', 'core/modules/layout_discovery/layouts/onecol/onecol.css'];
const DRUPAL_CORE_JS = ['core/assets/vendor/jquery/jquery.min.js', 'core/assets/vendor/once/once.min.js', 'core/misc/drupalSettingsLoader.js', 'core/misc/drupal.js', 'core/misc/drupal.init.js', 'core/misc/debounce.js', 'core/misc/displace.js', 'core/assets/vendor/tabbable/index.umd.min.js', 'core/misc/progress.js', 'core/misc/ajax.js'];
const WP_CORE_JS = ['wp-includes/js/dist/hooks.min.js', 'wp-includes/js/dist/i18n.min.js', 'wp-includes/js/dist/dom-ready.min.js', 'wp-includes/js/dist/a11y.min.js', 'wp-includes/js/dist/url.min.js', 'wp-includes/js/comment-reply.min.js', 'wp-includes/js/dist/vendor/wp-polyfill.min.js'];
const STATIC_BUNDLES = ['static/js/runtime', 'static/js/vendor', 'static/js/app', 'static/js/analytics', 'static/js/search'];

const ICONS = ['search', 'menu', 'close', 'chevron-down', 'chevron-right', 'arrow-right', 'calendar', 'clock', 'location', 'phone', 'mail', 'user', 'facebook', 'instagram', 'youtube', 'linkedin', 'rss', 'print', 'share', 'download', 'external', 'info', 'alert', 'check', 'star', 'heart', 'book', 'map', 'globe', 'accessibility', 'translate', 'chat'];

const DOMAIN_WORDS = {
  library: { cta: ['Get a card', 'My account', 'Renew items', 'Place a hold'], newsletter: 'Get the library newsletter', chat: 'Ask a librarian', widgets: ['catalog-search', 'hours', 'event-calendar', 'new-arrivals'], promos: ['Borrow e-books and audiobooks with the free app.', 'Museum passes are back — reserve yours online.', 'Book a study room up to two weeks ahead.'] },
  government: { cta: ['Apply online', 'Find a service', 'Contact us', 'Report fraud'], newsletter: 'Sign up for agency updates', chat: 'Need help? Chat with us', widgets: ['translate', 'feedback-survey', 'service-finder', 'official-banner'], promos: ['Applications for the winter assistance program close soon.', 'New guidance for small businesses is available.', 'Find a regional office near you.'] },
  municipality: { cta: ['Pay a bill', 'Report an issue', 'Get a permit', 'Contact 311'], newsletter: 'Get city news by email', chat: '311 virtual assistant', widgets: ['311-request', 'alerts', 'translate', 'trash-day-lookup'], promos: ['Look up your trash and recycling day.', 'Sign up for emergency alerts by text.', 'Council meetings are streamed live.'] },
  university: { cta: ['Apply', 'Visit', 'Give', 'Request information'], newsletter: 'Subscribe to campus news', chat: 'Chat with admissions', widgets: ['audience-menu', 'program-finder', 'events-feed', 'news-feed'], promos: ['Open house registration is now open.', 'Explore more than 200 degree programs.', 'Meet our newest faculty members.'] },
  healthcare: { cta: ['Find a doctor', 'Book an appointment', 'Patient portal', 'Pay my bill'], newsletter: 'Get healthy living tips', chat: 'Chat with a care advisor', widgets: ['find-a-doctor', 'wait-times', 'portal-login', 'symptom-checker'], promos: ['Same-day appointments are available in primary care.', 'Flu shots are available at all locations.', 'Download the patient app.'] },
  documentation: { cta: ['Get started', 'Sign in', 'Get an API key', 'Contact sales'], newsletter: 'Developer newsletter', chat: 'Ask the docs assistant', widgets: ['version-switcher', 'search-index', 'copy-buttons', 'feedback-widget'], promos: ['Version 4 is now generally available.', 'Try the new interactive API explorer.', 'Join the developer community forum.'] },
  museum: { cta: ['Buy tickets', 'Become a member', 'Plan your visit', 'Shop'], newsletter: 'Sign up for museum news', chat: 'Visitor services', widgets: ['ticketing', 'hours', 'exhibition-carousel', 'membership'], promos: ['Members enjoy free admission all year.', 'Late openings every Thursday.', 'Book a guided tour for your group.'] },
  nonprofit: { cta: ['Donate', 'Volunteer', 'Fundraise', 'Join us'], newsletter: 'Join our mailing list', chat: 'Questions? Chat with our team', widgets: ['donate-modal', 'campaign-progress', 'volunteer-signup', 'impact-counter'], promos: ['Your gift is matched this month.', 'Volunteer orientation every Saturday.', 'Read our latest impact report.'] },
  records: { cta: ['Request a record', 'Book a visit', 'Ask an archivist', 'Order copies'], newsletter: 'Archives news and events', chat: 'Ask an archivist', widgets: ['finding-aid-search', 'reading-room-hours', 'request-form', 'digital-collections'], promos: ['Digitized council minutes are now searchable.', 'Reading room appointments are required.', 'Copy requests take 5–10 business days.'] },
  news: { cta: ['Subscribe', 'Sign in', 'Get the newsletter', 'E-edition'], newsletter: 'Get the morning briefing', chat: 'Send us a tip', widgets: ['paywall-meter', 'ad-slots', 'most-read', 'newsletter-gate'], promos: ['Subscribe for unlimited access.', 'Get breaking news alerts on your phone.', 'Read today’s e-edition.'] },
};

// Per-site memo: pieces that are identical on every page of a site are built once (output is byte-identical).
const memoBySite = new WeakMap();
function memo(site, key, build) {
  let cache = memoBySite.get(site);
  if (!cache) memoBySite.set(site, cache = new Map());
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
// Internal links are page-independent unless the site uses page-relative link modes.
const pageKey = (site, page) => ['relative', 'mixed'].includes(site.linkMode) ? `@${page.url}` : '';
// Clutter only needs well-spread deterministic choices, so it uses FNV-1a with a murmur finalizer
// instead of SHA-256 (the answer key and page truth keep using util.seedFor).
function fastHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
const r = (site, ...parts) => fastHash(`${site.seed}|${site.id ?? ''}|clutter|${parts.join('|')}`);
const pick = (site, list, ...salt) => list[r(site, ...salt) % list.length];
const hex = (site, length, ...salt) => {
  let out = '';
  for (let i = 0; out.length < length; i++) out += r(site, ...salt, i).toString(16).padStart(8, '0');
  return out.slice(0, length);
};
const b64 = (site, length, ...salt) => Buffer.from(hex(site, length * 2, ...salt), 'hex').toString('base64url').slice(0, length);
const handle = site => String(site.name ?? site.id ?? 'site').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 15) || 'site';
const pretty = value => JSON.stringify(value, null, 2);
const scriptJson = value => pretty(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
const cms = site => site.cmsProfile === 'wordpress' ? 'wordpress' : site.cmsProfile === 'drupal' ? 'drupal' : 'none';
const words = site => DOMAIN_WORDS[site.domain] ?? DOMAIN_WORDS.library;

function selectedPlugins(site) { return memo(site, 'selectedPlugins', () => selectedPluginsBuild(site)); }
function selectedPluginsBuild(site) {
  const pool = PLUGIN_POOL[cms(site)] ?? [];
  const chosen = pool.filter((plugin, index) => r(site, 'plugin', plugin[0]) % 100 < (index < 3 ? 80 : 45));
  if (site.domain === 'library' || site.domain === 'museum') {
    const events = pool.find(plugin => /events|calendar/.test(plugin[0]));
    if (events && !chosen.includes(events)) chosen.push(events);
  }
  return chosen;
}

// URL shapes the six platform profiles (src/render/platforms.mjs) use for vendor assets, uploaded documents, component CSS
// and the staff sign-in page; null for WordPress, Drupal and plain sites.
function platformPaths(site) {
  const slug = String(site.name ?? site.id ?? 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';
  const pascal = String(site.name ?? 'Site').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0].toUpperCase() + word.slice(1)).join('') || 'Site';
  switch (site.cmsProfile) {
    case 'joomla': return { plugin: name => `/media/plg_system_${name.replace(/[^a-z0-9]+/g, '')}/`, theme: '/media/templates/site/cassiopeia/', pdf: '/images/documents/annual-report-2025.pdf', css: '/media/templates/site/cassiopeia/css/user.css', login: '/administrator/' };
    case 'squarespace': return { plugin: name => `/universal/scripts-compressed/${name}/`, theme: '/universal/', pdf: '/s/annual-report-2025.pdf', css: `/universal/styles-compressed/components-${hex(site, 12, 'sqs-components')}-min.en-US.css`, login: '/config/' };
    case 'webflow': return { plugin: name => `/js/vendor/${name}/`, theme: '/', pdf: '/documents/annual-report-2025.pdf', css: `/css/components.${hex(site, 9, 'wf-components')}.css`, login: '/admin/' };
    case 'hubspot': return { plugin: name => `/hs/hsstatic/${name}/static-1.${r(site, 'hs-static', name) % 400}/`, theme: '/hubfs/hub_generated/', pdf: '/hubfs/annual-report-2025.pdf', css: '/hubfs/hub_generated/module_assets/components.min.css', login: '/_hcms/mem/login' };
    case 'aem': return { plugin: name => `/etc.clientlibs/${slug}/clientlibs/vendor/${name}/`, theme: `/etc.clientlibs/${slug}/`, pdf: `/content/dam/${slug}/documents/annual-report-2025.pdf`, css: `/etc.clientlibs/${slug}/clientlibs/clientlib-components.min.css`, login: '/libs/granite/core/content/login.html' };
    case 'sitecore': return { plugin: name => `/-/media/Base-Themes/${name}/`, theme: `/-/media/Themes/${pascal}/`, pdf: `/-/media/Project/${pascal}/Documents/annual-report-2025.pdf`, css: `/-/media/Themes/${pascal}/components/styles/optimized-min.css`, login: '/sitecore/login' };
    case 'wix': return { plugin: name => `/_partials/${name}/`, theme: '/_partials/', pdf: `/_files/ugd/${hex(site, 6, 'wix-ugd')}_annual-report-2025.pdf`, css: `/_partials/wix-thunderbolt/components.${hex(site, 8, 'wix-components')}.min.css`, login: '/account/login' };
    case 'shopify': return { plugin: () => '/cdn/shop/t/3/assets/', theme: '/cdn/shop/t/3/assets/', pdf: `/cdn/shop/files/annual-report-2025.pdf`, css: '/cdn/shop/t/3/assets/component-list-menu.css', login: '/account/login' };
    case 'ghost': return { plugin: name => `/public/${name}/`, theme: '/assets/', pdf: '/content/files/2026/05/annual-report-2025.pdf', css: '/assets/built/components.css', login: '/ghost/' };
    default: return null;
  }
}

function assetBase(site) {
  const platform = platformPaths(site);
  if (platform) return { plugin: platform.plugin, theme: platform.theme };
  const kind = cms(site);
  const theme = themeDir(site);
  if (kind === 'wordpress') return { plugin: name => `/wp-content/plugins/${name}/`, theme: `/wp-content/themes/${theme}/` };
  if (kind === 'drupal') return { plugin: name => `/modules/contrib/${name}/`, theme: `/themes/custom/${theme.replaceAll('-', '_')}/` };
  return { plugin: name => `/static/vendor/${name}/`, theme: '/static/' };
}

function themeDir(site) {
  const words = String(site.name ?? 'site').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(word => !['the', 'of', 'city', 'town', 'village', 'state', 'county', 'university', 'college', 'museum'].includes(word));
  return (words.slice(0, 2).join('-') || 'site').slice(0, 30);
}

const cacheToken = site => b64(site, 6, 'cache-token').toLowerCase().replace(/[^a-z0-9]/g, 'x');

function localScripts(site) { return memo(site, 'localScripts', () => localScriptsBuild(site)); }
function localScriptsBuild(site) {
  const kind = cms(site);
  const base = assetBase(site);
  const list = [];
  if (kind === 'wordpress') {
    for (const path of WP_CORE_JS) if (r(site, 'core-js', path) % 3 !== 0) list.push([`wp-${path.split('/').pop().replace(/\.min\.js$|\.js$/, '')}-js`, `/${path}`, `ver=${hex(site, 20, 'ver', path)}`]);
    for (const plugin of selectedPlugins(site)) for (const file of plugin[4]) list.push([`${plugin[0]}-${file.split('/').pop().replace(/\..*$/, '')}-js`, `${base.plugin(plugin[0])}${file}`, `ver=${plugin[2]}`]);
    list.push([`${themeDir(site)}-navigation-js`, `${base.theme}assets/js/navigation.js`, 'ver=1.4.2'], [`${themeDir(site)}-scripts-js`, `${base.theme}assets/js/theme.min.js`, `ver=${hex(site, 8, 'theme-js')}`]);
  } else if (kind === 'drupal') {
    const token = cacheToken(site);
    for (const path of DRUPAL_CORE_JS) list.push([null, `/${path}`, `v=${['10.4.8', '11.2.5', '11.2.6'][r(site, 'drupal-core') % 3]}`]);
    for (const plugin of selectedPlugins(site)) for (const file of plugin[4]) list.push([null, `${base.plugin(plugin[0])}${file}`, token]);
    list.push([null, `${base.theme}dist/js/global.js`, token], [null, `${base.theme}dist/js/navigation.js`, token]);
  } else {
    // Platform profiles put the same bundles under their own vendor paths (Wix /_partials/, Shopify /cdn/shop/..., etc.).
    const platform = platformPaths(site);
    for (const bundle of STATIC_BUNDLES) if (bundle.endsWith('app') || r(site, 'bundle', bundle) % 3 !== 0) {
      const name = bundle.split('/').pop();
      list.push([null, platform ? `${platform.plugin(name)}${name}.${hex(site, 8, bundle)}.js` : `/${bundle}.${hex(site, 8, bundle)}.js`, '']);
    }
  }
  return list;
}

function localStyles(site) { return memo(site, 'localStyles', () => localStylesBuild(site)); }
function localStylesBuild(site) {
  const kind = cms(site);
  const base = assetBase(site);
  const list = [];
  if (kind === 'wordpress') {
    for (const block of ['navigation', 'image', 'cover', 'group', 'columns', 'social-links', 'search', 'buttons', 'heading', 'paragraph'])
      if (r(site, 'block-css', block) % 2 === 0) list.push([`wp-block-${block}-css`, `/wp-includes/blocks/${block}/style.min.css`, 'ver=7.1.3']);
    for (const plugin of selectedPlugins(site)) for (const file of plugin[3]) list.push([`${plugin[0]}-${file.split('/').pop().replace(/\..*$/, '')}-css`, `${base.plugin(plugin[0])}${file}`, `ver=${plugin[2]}`]);
    list.push([`${themeDir(site)}-print-css`, `${base.theme}assets/css/print.css`, 'ver=1.4.2', 'print']);
  } else if (kind === 'drupal') {
    if (r(site, 'drupal-aggregate') % 2 === 0) {
      const token = cacheToken(site);
      for (const path of DRUPAL_CORE_CSS) if (r(site, 'drupal-css', path) % 4 !== 0) list.push([null, `/${path}`, token]);
      for (const plugin of selectedPlugins(site)) for (const file of plugin[3]) list.push([null, `${base.plugin(plugin[0])}${file}`, token]);
      list.push([null, `${base.theme}dist/css/global.css`, token], [null, `${base.theme}dist/css/print.css`, token, 'print']);
    }
  } else if (platformPaths(site)) {
    const platform = platformPaths(site);
    list.push([null, `${platform.theme}main.${hex(site, 8, 'main-css')}.css`, ''], [null, `${platform.plugin('vendor')}vendor.${hex(site, 8, 'vendor-css')}.css`, '']);
  } else {
    list.push([null, `/static/css/main.${hex(site, 8, 'main-css')}.css`, ''], [null, `/static/css/vendor.${hex(site, 8, 'vendor-css')}.css`, '']);
  }
  return list;
}

const LAYOUT_PROPS = ['flex-wrap: nowrap', 'gap: var(--wp--preset--spacing--40)', 'justify-content: space-between', 'align-items: center', 'flex-direction: column', 'max-width: 1200px', 'margin-left: auto !important', 'margin-right: auto !important', 'grid-template-columns: repeat(3, minmax(0, 1fr))', 'padding-top: var(--wp--preset--spacing--50)', 'padding-bottom: var(--wp--preset--spacing--50)'];

function inlineStyles(site, page) {
  const kind = cms(site);
  const blocks = [];
  const colors = ['base', 'contrast', 'primary', 'secondary', 'tertiary', 'accent', 'neutral', 'border', 'surface', 'highlight'];
  if (kind === 'wordpress') {
    const presets = [];
    for (const [i, name] of colors.entries()) presets.push(`--wp--preset--color--${name}: #${hex(site, 6, 'color', i)};`);
    for (const [i, name] of ['vivid-cyan-blue-to-vivid-purple', 'light-green-cyan-to-vivid-green-cyan', 'luminous-vivid-amber-to-luminous-vivid-orange', 'cool-to-warm-spectrum', 'blush-light-purple', 'midnight'].entries()) presets.push(`--wp--preset--gradient--${name}: linear-gradient(135deg, #${hex(site, 6, 'g1', i)} 0%, #${hex(site, 6, 'g2', i)} 100%);`);
    for (const [i, name] of ['small', 'medium', 'large', 'x-large', 'xx-large'].entries()) presets.push(`--wp--preset--font-size--${name}: ${[13, 20, 36, 42, 56][i]}px;`);
    for (const [i, step] of [20, 30, 40, 50, 60, 70, 80].entries()) presets.push(`--wp--preset--spacing--${step}: ${(0.44 * (i + 1)).toFixed(2)}rem;`);
    for (const [i, name] of ['natural', 'deep', 'sharp', 'outlined', 'crisp'].entries()) presets.push(`--wp--preset--shadow--${name}: ${i + 2}px ${i + 2}px ${i * 3 + 3}px rgba(0, 0, 0, 0.${2 + i});`);
    const hasClasses = colors.flatMap(name => [`.has-${name}-color {\n\tcolor: var(--wp--preset--color--${name}) !important;\n}`, `.has-${name}-background-color {\n\tbackground-color: var(--wp--preset--color--${name}) !important;\n}`, `.has-${name}-border-color {\n\tborder-color: var(--wp--preset--color--${name}) !important;\n}`]);
    blocks.push(['global-styles-inline-css', `:root {\n\t${presets.join('\n\t')}\n}\n:where(body) {\n\tmargin: 0;\n}\n.wp-site-blocks > .alignleft {\n\tfloat: left;\n\tmargin-right: 2em;\n}\n.wp-site-blocks > .alignright {\n\tfloat: right;\n\tmargin-left: 2em;\n}\n.wp-site-blocks > .aligncenter {\n\tjustify-content: center;\n\tmargin-left: auto;\n\tmargin-right: auto;\n}\n:where(.is-layout-flex) {\n\tgap: 0.5em;\n}\n:where(.is-layout-grid) {\n\tgap: 0.5em;\n}\n${hasClasses.join('\n')}`]);
    const containers = [];
    const count = page.kind === 'home' ? 150 + r(site, page.pageId, 'containers') % 110 : 60 + r(site, page.pageId, 'containers') % 70;
    for (let i = 0; i < count; i++) {
      const props = LAYOUT_PROPS.filter((_, j) => r(site, page.pageId, 'container', i, j) % 3 === 0);
      containers.push(`.wp-container-core-${pick(site, ['group', 'columns', 'buttons', 'navigation', 'social-links'], page.pageId, 'kind', i)}-is-layout-${hex(site, 8, page.pageId, 'cid', i)} {\n\t${(props.length ? props : ['flex-wrap: nowrap']).join(';\n\t')};\n}`);
    }
    blocks.push(['core-block-supports-inline-css', containers.join('\n')]);
    blocks.push(['wp-img-auto-sizes-contain-inline-css', 'img:is([sizes=auto i],[sizes^="auto," i]) {\n\tcontain-intrinsic-size: 3000px 1500px;\n}']);
    blocks.push(['wp-emoji-styles-inline-css', 'img.wp-smiley, img.emoji {\n\tdisplay: inline !important;\n\tborder: none !important;\n\tbox-shadow: none !important;\n\theight: 1em !important;\n\twidth: 1em !important;\n\tmargin: 0 0.07em !important;\n\tvertical-align: -0.1em !important;\n\tbackground: none !important;\n\tpadding: 0 !important;\n}']);
  } else {
    const rules = [];
    const count = page.kind === 'home' ? 230 + r(site, page.pageId, 'critical') % 150 : 110 + r(site, page.pageId, 'critical') % 90;
    const selectors = ['.c-header', '.c-nav__item', '.c-card', '.c-card__title', '.c-button', '.c-button--primary', '.o-container', '.o-grid', '.u-visually-hidden', '.c-footer', '.c-alert', '.c-hero', '.c-hero__media', '.c-teaser', '.c-teaser__meta', '.c-pager', '.c-breadcrumbs', '.c-search', '.c-search__input', '.c-menu', '.c-menu__link', '.c-tag'];
    const props = ['display: flex', 'display: grid', 'align-items: center', 'gap: 1rem', 'padding: 0.75rem 1rem', 'margin: 0 auto', 'max-width: 75rem', 'font-weight: 700', 'line-height: 1.4', 'border-radius: 0.25rem', 'color: inherit', 'text-decoration: none', 'position: relative', 'z-index: 2', 'transition: color 0.2s ease'];
    for (let i = 0; i < count; i++) {
      const sel = `${pick(site, selectors, page.pageId, 'sel', i)}${i % 4 === 0 ? `--${pick(site, ['lg', 'sm', 'dark', 'light', 'active'], 'mod', i)}` : ''}`;
      const chosen = props.filter((_, j) => r(site, page.pageId, 'p', i, j) % 4 === 0);
      rules.push(`${sel} {\n  ${(chosen.length ? chosen : ['display: block']).join(';\n  ')};\n}`);
      if (i % 15 === 14) rules.push(`@media (min-width: ${[600, 768, 1024, 1280][i % 4]}px) {\n  ${sel} {\n    padding: 1rem 1.5rem;\n  }\n}`);
    }
    blocks.push([kind === 'drupal' ? 'critical-css' : 'critical-styles', rules.join('\n')]);
  }
  return blocks;
}

function svgSprite(site) { return memo(site, 'svgSprite', () => svgSpriteBuild(site)); }
function svgSpriteBuild(site) {
  const count = 14 + r(site, 'icons') % (ICONS.length - 13);
  const symbols = ICONS.slice(0, count).map(name => `    <symbol id="icon-${name}" viewBox="0 0 24 24">\n      <title>${name.replace(/-/g, ' ')}</title>\n      <path d="${ICON_PATHS[name]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>\n    </symbol>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display: none;" aria-hidden="true" focusable="false">\n  <defs>\n${symbols.join('\n')}\n  </defs>\n</svg>`;
}

// Outline icons drawn on a 24x24 grid (each path depicts what its name says).
const ICON_PATHS = {
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM16 16l5 5',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M5 5l14 14M19 5L5 19',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-right': 'M4 12h16M14 6l6 6-6 6',
  calendar: 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
  location: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  facebook: 'M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h2z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17.5 6.5h.01',
  youtube: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9l5 3-5 3z',
  linkedin: 'M4 9h4v11H4zM6 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 9h4v2a4 4 0 0 1 6 3.5V20h-4v-5a2 2 0 0 0-4 0v5h-2z',
  rss: 'M5 19h.01M5 11a8 8 0 0 1 8 8M5 4a15 15 0 0 1 15 15',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z',
  share: 'M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  external: 'M14 3h7v7M21 3l-9 9M19 14v7H3V5h7',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7h.01',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  check: 'M4 12l5 5L20 6',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  heart: 'M12 20s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.1-8 11-8 11z',
  book: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  accessibility: 'M12 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 8l7 1 7-1M12 9v5l-3 7M12 14l3 7',
  translate: 'M4 5h8M8 3v2M6 5c0 4 3 7 6 8M10 5c0 4-3 7-6 8M13 21l4-10 4 10M14.5 17h5',
  chat: 'M4 4h16v12H8l-4 4z',
};

// Link text that says what the query does (site-actions.js applies sort, view and keyword filters on listing pages).
function facetLabel(query, section) {
  const [key, value = ''] = query.replace(/^\?/, '').split('=');
  if (key === 'sort') return { newest: `Newest ${section.toLowerCase()} first`, oldest: `Oldest ${section.toLowerCase()} first`, title: `${section} A to Z`, popular: `Featured ${section.toLowerCase()}` }[value] ?? `All ${section}`;
  if (key === 'page') return `${section}, page ${value}`;
  if (key === 'view') return `${section} as a ${value}`;
  if (key === 'year') return `${section} from ${value}`;
  if (['audience', 'format', 'topic'].includes(key)) return `${section}: ${value.replace(/-/g, ' ')}`;
  return `All ${section}`;
}

const icon = name => `<svg class="icon icon-${name}" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;

function megaMenu(site, page, ctx) { return memo(site, `megaMenu${pageKey(site, page)}`, () => megaMenuBuild(site, page, ctx)); }
function megaMenuBuild(site, page, ctx) {
  const nav = site.navigation ?? [];
  const kind = cms(site);
  const filters = ['?sort=newest', '?sort=popular', '?view=grid', '?view=list', '?audience=adults', '?audience=kids', '?format=online', '?ref=megamenu', '?page=2', ''];
  const panels = nav.map((item, index) => {
    const id = `megamenu-panel-${index + 1}`;
    const columns = Array.from({ length: 2 + r(site, 'mm-cols', index) % 2 }, (_, column) => {
      const links = Array.from({ length: 3 + r(site, 'mm-links', index, column) % 4 }, (_, n) => {
        const query = filters[(r(site, 'mm-q', index, column, n)) % filters.length];
        const label = facetLabel(query, item.label);
        return `              <li class="megamenu__item"><a class="megamenu__link" href="${ctx.href(item.href)}${query.replaceAll('&', '&amp;')}" data-analytics="megamenu-${index + 1}-${column + 1}-${n + 1}">${ctx.esc(label)}</a></li>`;
      }).join('\n');
      return `          <div class="megamenu__column">\n            <p class="megamenu__heading">${ctx.esc(['Browse', 'Popular', 'Explore', 'Get started'][column % 4])}</p>\n            <ul class="megamenu__list">\n${links}\n            </ul>\n          </div>`;
    }).join('\n');
    const promo = pick(site, words(site).promos, 'mm-promo', index);
    return `      <div class="megamenu__panel" id="${id}" hidden data-menu-index="${index}">\n        <div class="megamenu__inner">\n${columns}\n          <div class="megamenu__promo">\n${mediaImg(site, ctx, `mm-${index}`, 'megamenu__promo-image', '')}\n            <p class="megamenu__promo-text">${ctx.esc(promo)}</p>\n            <a class="megamenu__promo-link" href="${ctx.href(item.href)}?utm_source=site&amp;utm_medium=megamenu&amp;utm_campaign=promo-${index + 1}">${ctx.esc(`Explore ${item.label.toLowerCase()}`)}</a>\n          </div>\n        </div>\n      </div>`;
  }).join('\n');
  const wrapperClass = kind === 'wordpress' ? 'megamenu wp-block-group' : kind === 'drupal' ? 'megamenu block block-superfish' : 'megamenu c-menu';
  return `<div class="${wrapperClass}" id="megamenu" aria-hidden="true">\n${panels}\n    </div>`;
}

function offCanvas(site, page, ctx) { return memo(site, `offCanvas${pageKey(site, page)}`, () => offCanvasBuild(site, page, ctx)); }
function offCanvasBuild(site, page, ctx) {
  const nav = site.navigation ?? [];
  const items = nav.map((item, index) => `        <li class="mobile-menu__item">\n          <a class="mobile-menu__link" href="${ctx.href(item.href)}">${ctx.esc(item.label)}</a>\n          <button type="button" class="mobile-menu__toggle" aria-expanded="false" aria-controls="mobile-sub-${index + 1}"><span class="visually-hidden">Show submenu for ${ctx.esc(item.label)}</span>${icon('chevron-down')}</button>\n          <ul class="mobile-menu__sub" id="mobile-sub-${index + 1}" hidden>\n            <li><a href="${ctx.href(item.href).replace(/\/$/, '')}">${ctx.esc(`All ${item.label}`)}</a></li>\n            <li><a href="${ctx.href(item.href)}#main-listing">${ctx.esc(`Jump to ${item.label.toLowerCase()} list`)}</a></li>\n          </ul>\n        </li>`).join('\n');
  return `<div class="off-canvas" id="mobile-menu" hidden aria-label="Mobile menu">\n    <div class="off-canvas__header">\n      <button type="button" class="off-canvas__close" data-close="mobile-menu"><span class="visually-hidden">Close menu</span>${icon('close')}</button>\n    </div>\n    <nav class="mobile-menu" aria-label="Mobile">\n      <ul class="mobile-menu__list">\n        <li class="mobile-menu__item"><a class="mobile-menu__link" href="${ctx.href('/')}">Home</a></li>\n${items}\n      </ul>\n    </nav>\n    <div class="off-canvas__footer">\n      <a href="tel:+15550100${String(r(site, 'tel') % 100).padStart(2, '0')}">${icon('phone')} Call us</a>\n      <a href="mailto:info@${handle(site)}.example">${icon('mail')} Email us</a>\n    </div>\n  </div>`;
}

function consent(site, ctx) { return memo(site, 'consent', () => consentBuild(site, ctx)); }
function consentBuild(site, ctx) {
  const vendor = pick(site, ['cmplz', 'eu-cookie-compliance', 'cookie-notice', 'onetrust-like', 'cookieyes'], 'consent');
  const categories = ['Strictly necessary', 'Functional', 'Analytics', 'Marketing', 'Preferences'].slice(0, 3 + r(site, 'consent-cats') % 3);
  const rows = categories.map((name, i) => `        <div class="consent-category">\n          <label class="consent-category__label" for="consent-${i}">${ctx.esc(name)}</label>\n          <input type="checkbox" id="consent-${i}" name="consent-${i}"${i === 0 ? ' checked disabled' : ''}>\n          <p class="consent-category__text">${ctx.esc(['Required for the site to work. These cannot be switched off.', 'Remember your choices such as language and region.', 'Help us understand how visitors use the site so we can improve it.', 'Used to show relevant content and measure campaigns.', 'Store settings such as text size and contrast.'][i])}</p>\n        </div>`).join('\n');
  return `<div class="consent-banner ${vendor}" id="consent-banner" role="dialog" aria-live="polite" aria-label="Cookie consent" hidden>\n    <div class="consent-banner__body">\n      <p class="consent-banner__title">We value your privacy</p>\n      <p class="consent-banner__text">We use cookies to make this site work and to understand how it is used. You can accept all cookies or choose which ones to allow.</p>\n      <div class="consent-banner__actions">\n        <button type="button" class="consent-button consent-button--accept" data-consent="accept">Accept all</button>\n        <button type="button" class="consent-button consent-button--deny" data-consent="deny">Reject non-essential</button>\n        <button type="button" class="consent-button consent-button--prefs" data-open="consent-preferences">Manage preferences</button>\n      </div>\n    </div>\n  </div>\n  <div class="consent-preferences" id="consent-preferences" role="dialog" aria-modal="true" aria-label="Cookie preferences" hidden>\n    <form class="consent-preferences__form" action="#" onsubmit="return false;">\n${rows}\n      <button type="submit" class="consent-button">Save preferences</button>\n    </form>\n  </div>`;
}

function newsletter(site, ctx) {
  const id = `newsletter-${hex(site, 6, 'nl')}`;
  return `<section class="newsletter-band" aria-labelledby="${id}-title">\n    <div class="newsletter-band__inner">\n      <h2 class="newsletter-band__title" id="${id}-title">${ctx.esc(words(site).newsletter)}</h2>\n      <p class="newsletter-band__text">${ctx.esc(pick(site, ['News, events and updates once a week. Unsubscribe at any time.', 'The best of what’s new, straight to your inbox.', 'Monthly updates. No spam, ever.'], 'nl-text'))}</p>\n      <form class="newsletter-band__form" action="${ctx.href('/')}" method="get" novalidate>\n        <label for="${id}-email" class="visually-hidden">Email address</label>\n        <input type="email" id="${id}-email" name="newsletter_email" placeholder="you@example.com" autocomplete="email">\n        <input type="hidden" name="list" value="${hex(site, 10, 'nl-list')}">\n        <input type="text" name="${id}-website" tabindex="-1" autocomplete="off" class="visually-hidden" aria-hidden="true">\n        <button type="submit" class="newsletter-band__button">Subscribe</button>\n      </form>\n    </div>\n  </section>`;
}

function mediaImg(site, ctx, salt, className, alt) {
  if (!site.mediaPool) return '';
  const n = r(site, 'media', salt);
  const src = ctx.href(n % 3 === 0 ? `/assets/media/portrait-${1 + n % 6}.png` : `/assets/media/${site.domain}-${1 + n % 8}.png`);
  return `            <img class="${className}" src="${src}" srcset="${src} 480w" sizes="240px" width="480" height="640" loading="lazy" decoding="async" alt="${ctx.esc(alt)}">`;
}

function socialFeed(site, page, ctx) {
  if (!site.mediaPool || r(site, page.pageId, 'feed') % 3 === 0) return '';
  const count = 4 + r(site, 'feed-count') % 5;
  const captions = ['Behind the scenes this week', 'Thank you to everyone who came out!', 'New this month', 'Our team at the community fair', 'Sneak peek', 'Throwback to last spring', 'Volunteers make it happen', 'See you this weekend'];
  const items = Array.from({ length: count }, (_, i) => `      <li class="social-feed__item">\n${mediaImg(site, ctx, `feed-${page.pageId}-${i}`, 'social-feed__image', captions[(i + r(site, page.pageId, 'cap')) % captions.length])}\n      </li>`).join('\n');
  return `<section class="social-feed" aria-label="From our social feed">\n    <p class="social-feed__title">@${handle(site)}</p>\n    <ul class="social-feed__list">\n${items}\n    </ul>\n  </section>`;
}

function socialLinks(site, page, ctx) { return memo(site, `socialLinks${pageKey(site, page)}`, () => socialLinksBuild(site, ctx)); }
function socialLinksBuild(site, ctx) {
  const name = handle(site);
  return ['facebook', 'instagram', 'youtube', 'linkedin'].filter((_, i) => r(site, 'social', i) % 4 !== 0)
    .map(network => `          <li class="social-links__item"><a class="social-links__link" href="#connect" aria-label="${ctx.esc(site.name)} on ${network}" data-handle="@${name}">${icon(network)}</a></li>`).join('\n');
}

function jsonLd(site, page, ctx) {
  const origin = new URL(ctx.canonical).origin;
  const graph = [
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: site.name, description: site.description, publisher: { '@id': `${origin}/#organization` }, potentialAction: [{ '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/?s={search_term_string}` }, 'query-input': { '@type': 'PropertyValueSpecification', valueRequired: true, valueName: 'search_term_string' } }], inLanguage: 'en-US' },
    { '@type': { library: 'Library', museum: 'Museum', university: 'CollegeOrUniversity', healthcare: 'MedicalOrganization', government: 'GovernmentOrganization', municipality: 'GovernmentOrganization', news: 'NewsMediaOrganization', nonprofit: 'NGO', records: 'ArchiveOrganization', documentation: 'Organization' }[site.domain] ?? 'Organization', '@id': `${origin}/#organization`, name: site.name, url: `${origin}/`, logo: { '@type': 'ImageObject', '@id': `${origin}/#logo`, url: `${origin}/assets/collection.png`, width: 480, height: 640, caption: site.name }, sameAs: ['facebook', 'instagram', 'youtube'].map(network => `https://${network}.example/${handle(site)}`) },
    { '@type': page.kind === 'listing' ? 'CollectionPage' : 'WebPage', '@id': ctx.canonical, url: ctx.canonical, name: `${page.title} | ${site.name}`, isPartOf: { '@id': `${origin}/#website` }, datePublished: `20${20 + r(site, page.pageId, 'pub') % 6}-0${1 + r(site, page.pageId, 'pubm') % 9}-1${r(site, page.pageId, 'pubd') % 9}T09:${10 + r(site, page.pageId, 'min') % 49}:00+00:00`, dateModified: `2026-0${1 + r(site, page.pageId, 'mod') % 9}-2${r(site, page.pageId, 'modd') % 8}T1${r(site, page.pageId, 'h') % 9}:00:00+00:00`, breadcrumb: { '@id': `${ctx.canonical}#breadcrumb` }, inLanguage: 'en-US', potentialAction: [{ '@type': 'ReadAction', target: [ctx.canonical] }] },
    { '@type': 'BreadcrumbList', '@id': `${ctx.canonical}#breadcrumb`, itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` }, ...(page.kind !== 'home' ? [{ '@type': 'ListItem', position: 2, name: page.title }] : [])] },
  ];
  if (page.kind === 'detail') {
    const type = { book: 'Book', event: 'Event', author: 'Person', faculty: 'Person', provider: 'Physician', journalist: 'Person', creator: 'Person', article: 'NewsArticle', feature: 'NewsArticle', course: 'Course', object: 'VisualArtwork', clinic: 'MedicalClinic', branch: 'Library', guide: 'TechArticle', tutorial: 'TechArticle' }[page.contentType] ?? 'Thing';
    graph.push({ '@type': type, '@id': `${ctx.canonical}#primary`, name: page.title, mainEntityOfPage: { '@id': ctx.canonical } });
  }
  return `<script type="application/ld+json"${cms(site) === 'wordpress' ? ' class="yoast-schema-graph"' : ''}>\n${scriptJson({ '@context': 'https://schema.org', '@graph': graph })}\n</script>`;
}

function socialMeta(site, page, ctx) {
  const origin = new URL(ctx.canonical).origin;
  const handleName = handle(site);
  return [
    '<meta property="og:locale" content="en_US">', `<meta property="og:type" content="${page.kind === 'detail' ? 'article' : 'website'}">`,
    `<meta property="og:title" content="${ctx.esc(page.title)}">`, `<meta property="og:url" content="${ctx.esc(ctx.canonical)}">`,
    `<meta property="og:site_name" content="${ctx.esc(site.name)}">`, `<meta property="og:image" content="${ctx.esc(`${origin}/assets/collection.png`)}">`,
    '<meta property="og:image:width" content="480">', '<meta property="og:image:height" content="640">', '<meta property="og:image:type" content="image/png">',
    `<meta name="twitter:card" content="${pick(site, ['summary', 'summary_large_image'], 'tw-card')}">`, `<meta name="twitter:site" content="@${handleName}">`,
    `<meta name="twitter:title" content="${ctx.esc(`${page.title} | ${site.name}`)}">`,
    ...(page.kind === 'detail' ? [`<meta property="article:modified_time" content="2026-0${1 + r(site, page.pageId, 'mod') % 9}-2${r(site, page.pageId, 'modd') % 8}T1${r(site, page.pageId, 'h') % 9}:00:00+00:00">`] : []),
    `<meta name="${pick(site, ['google-site-verification', 'msvalidate.01', 'facebook-domain-verification'], 'verify')}" content="${b64(site, 43, 'verify')}">`,
    `<meta name="theme-color" content="#${hex(site, 6, 'theme-color')}">`,
  ].join('\n');
}

function analyticsBootstrap(site, page) {
  const containers = Array.from({ length: 1 + r(site, 'gtm-count') % 2 }, (_, i) => `XG-${hex(site, 7, 'gtm', i).toUpperCase()}`);
  const experiments = Array.from({ length: 2 + r(site, 'ab') % 4 }, (_, i) => ({ id: `exp_${hex(site, 6, 'exp', i)}`, variant: pick(site, ['control', 'a', 'b'], 'variant', i), weight: (10 + r(site, 'w', i) % 80) / 100 }));
  return `<!-- Tag manager -->\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function siteTag(){ window.dataLayer.push(arguments); }\n  siteTag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', functionality_storage: 'granted', wait_for_update: 500 });\n  window.dataLayer.push({\n    event: 'page_meta',\n    pageType: '${page.kind}',\n    contentType: '${String(page.contentType).replace(/[^a-zA-Z0-9_-]/g, '')}',\n    siteSection: '${String(page.url).split('/').filter(Boolean)[0] ?? 'home'}',\n    containers: ${JSON.stringify(containers)}\n  });\n  window.siteExperiments = ${JSON.stringify(experiments, null, 2).replace(/\n/g, '\n  ')};\n</script>\n<!-- End tag manager -->`;
}

function stateBlob(site, page, ctx) {
  const nav = (site.navigation ?? []).map((item, i) => ({ id: `nav-${i + 1}`, label: item.label, url: item.href, children: [{ label: `All ${item.label}`, url: `${item.href}?ref=state` }] }));
  const state = {
    build: { id: hex(site, 12, 'build'), generatedAt: `2026-10-${10 + r(site, 'build-day') % 18}T0${r(site, 'build-h') % 9}:${10 + r(site, 'build-m') % 49}:00Z`, release: `${2 + r(site, 'rel') % 3}.${r(site, 'rel2') % 30}.${r(site, 'rel3') % 9}` },
    page: { id: page.pageId, kind: page.kind, path: page.url, title: page.title },
    features: Object.fromEntries(['newHeader', 'searchSuggest', 'lazyImages', 'darkMode', 'chatWidget', 'stickyNav', 'printView'].map((name, i) => [name, r(site, 'feature', i) % 2 === 0])),
    navigation: nav,
    i18n: { locale: 'en-US', strings: { 'menu.open': 'Open menu', 'menu.close': 'Close menu', 'search.placeholder': 'Search', 'consent.accept': 'Accept all' } },
    widgets: words(site).widgets.map((name, i) => ({ name, enabled: r(site, 'widget', i) % 3 !== 0, endpoint: `/api/${name}` })),
  };
  return `<script type="application/json" id="site-state">\n${scriptJson(state)}\n</script>`;
}

function domainWidgets(site, page, ctx) {
  const parts = [];
  const nav = site.navigation ?? [];
  if (site.domain === 'news') {
    const slots = 3 + r(site, page.pageId, 'ads') % 5;
    for (let i = 0; i < slots; i++) parts.push(`<div class="ad-slot ad-slot--${pick(site, ['leaderboard', 'rectangle', 'skyscraper', 'native'], 'ad', i)}" id="ad-slot-${i + 1}" data-ad-unit="/${r(site, 'network') % 90000 + 10000}/${handle(site)}/${page.kind}/${i + 1}" data-sizes="[[728,90],[300,250]]" aria-hidden="true"></div>`);
    parts.push(`<div class="paywall-meter" data-free-articles="${3 + r(site, 'meter') % 5}" hidden>\n    <p>You have <span class="paywall-meter__count">${1 + r(site, page.pageId, 'left') % 4}</span> free articles left this month.</p>\n    <button type="button" class="paywall-meter__cta">${ctx.esc(words(site).cta[0])}</button>\n  </div>`);
  }
  if (site.domain === 'documentation') parts.push(`<script type="application/json" id="search-index">\n${scriptJson(nav.map(item => ({ title: item.label, url: item.href, keywords: [item.label.toLowerCase(), 'docs'] })))}\n</script>`);
  if (['government', 'municipality'].includes(site.domain)) parts.push(`<div class="translate-widget" id="translate-widget" hidden>\n    <label for="translate-select">Translate</label>\n    <select id="translate-select">\n${['English', 'Español', 'Tiếng Việt', '中文', 'Kreyòl ayisyen', 'Português', 'العربية', 'Русский'].map(lang => `      <option>${lang}</option>`).join('\n')}\n    </select>\n  </div>\n  <div class="feedback-survey" id="feedback-survey" hidden>\n    <p>Was this page helpful?</p>\n    <button type="button">Yes</button>\n    <button type="button">No</button>\n  </div>`);
  if (site.domain === 'nonprofit') parts.push(`<div class="donate-modal" id="donate-modal" role="dialog" aria-modal="true" aria-label="Donate" hidden>\n    <form action="${ctx.href('/')}" method="get" class="donate-modal__form">\n${[25, 50, 100, 250].map(amount => `      <label><input type="radio" name="amount" value="${amount}"> $${amount}</label>`).join('\n')}\n      <button type="submit">Give now</button>\n    </form>\n    <div class="campaign-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${30 + r(site, 'progress') % 60}"></div>\n  </div>`);
  if (site.domain === 'healthcare') parts.push(`<div class="portal-login" id="portal-login" hidden>\n    <p>Sign in to the patient portal to message your care team, view results and pay bills.</p>\n    <button type="button" class="portal-login__button">Sign in</button>\n  </div>`);
  return parts.join('\n  ');
}

function wpLocalized(site) {
  const nonce = hex(site, 10, 'nonce');
  const parts = selectedPlugins(site).slice(0, 4).map(plugin => {
    const name = plugin[0].replace(/[^a-z0-9]/g, '_');
    return `<script id="${plugin[0]}-js-extra">\nvar ${name}_settings = ${JSON.stringify({ ajax_url: '/wp-admin/admin-ajax.php', nonce, rest_url: '/wp-json/', version: plugin[2], i18n: { loading: 'Loading…', error: 'Something went wrong. Please try again.' } }, null, 2)};\n</script>`;
  });
  parts.push(`<script id="wp-i18n-js-after">\nwindow.wpLocaleData = { "text direction\\u0004ltr": [ "ltr" ] };\n</script>`);
  return parts.join('\n');
}

function drupalTwigDebug(site, hook, file) {
  if (r(site, 'twig-debug') % 3 !== 0) return '';
  return `\n<!-- THEME DEBUG -->\n<!-- THEME HOOK: '${hook}' -->\n<!-- FILE NAME SUGGESTIONS:\n   * ${hook}--${themeDir(site).replaceAll('-', '_')}.html.twig\n   x ${hook}.html.twig\n-->\n<!-- BEGIN OUTPUT from 'themes/custom/${themeDir(site).replaceAll('-', '_')}/templates/${file}' -->`;
}

function bigPipe(site, page) {
  if (cms(site) !== 'drupal') return { placeholders: '', replacements: '' };
  const count = 2 + r(site, page.pageId, 'bigpipe') % 4;
  const ids = Array.from({ length: count }, (_, i) => `callback=Drupal%5Cblock%5CBlockViewBuilder%3A%3AlazyBuilder&amp;args%5B0%5D=${themeDir(site).replaceAll('-', '_')}_block_${i + 1}&amp;token=${b64(site, 43, page.pageId, 'bp', i)}`);
  return {
    placeholders: ids.map(id => `<span data-big-pipe-placeholder-id="${id}"></span>`).join('\n    '),
    replacements: ids.map((id, i) => `<script type="application/vnd.drupal-ajax" data-big-pipe-replacement-for-placeholder-with-id="${id}">\n[{"command":"settings","settings":{"ajaxPageState":{"theme":"${themeDir(site).replaceAll('-', '_')}"}},"merge":true},{"command":"insert","method":"replaceWith","selector":"[data-big-pipe-placeholder-id=\\u0022${id.replaceAll('&amp;', '\\u0026')}\\u0022]","data":"","settings":null}]\n</script>`).join('\n'),
  };
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// ---------------------------------------------------------------- public API

export function clutterAssetFiles(site) {
  const files = new Map();
  const css = `/* ${site.name} */\n.megamenu,.off-canvas,.consent-banner,.consent-preferences{display:none}\n.megamenu[hidden],.off-canvas[hidden],.consent-banner[hidden],.consent-preferences[hidden]{display:none!important}\n.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}\n.icon{width:1em;height:1em;vertical-align:-0.125em}\n.newsletter-band{margin:0;padding:40px 20px;background:var(--wash,#f3f4f6);border-top:1px solid var(--line,#ddd)}\n.newsletter-band__inner{width:min(1120px,100%);margin-inline:auto}\n.newsletter-band__title{margin:0 0 6px;font:700 1.35rem var(--heading-font,Georgia,serif)}\n.newsletter-band__text{margin:0 0 14px;color:var(--muted,#555)}\n.newsletter-band__form{display:flex;flex-wrap:wrap;gap:8px}\n.newsletter-band__form input[type=email]{flex:1 1 220px;max-width:360px;padding:10px 12px;border:1px solid var(--line,#ccc);font:inherit}\n.newsletter-band__button{padding:10px 18px;border:0;background:var(--accent-strong,#1d4ed8);color:#fff;font:inherit;font-weight:700;cursor:pointer}\n.ad-slot{display:none}\n.back-to-top{position:fixed;right:16px;bottom:16px;padding:8px 12px;border:1px solid var(--line,#ccc);background:var(--paper,#fff);color:var(--ink,#111);font:inherit;font-size:.85rem;opacity:.9}\n.social-links{display:flex;gap:10px;margin:12px 0 0;padding:0;list-style:none}\n.social-links__link{display:inline-flex;width:34px;height:34px;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:50%;color:inherit}\n.footer-meta{margin:10px 0 0;font-size:.78rem}\n.footer-meta a{color:inherit}\n.social-feed{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:32px 0}\n.social-feed__title{margin:0 0 12px;font-weight:800}\n.social-feed__list{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:0;padding:0;list-style:none}\n.social-feed__image{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:var(--card-radius,0)}\n.megamenu__promo-image{display:block;width:100%;height:auto}\n`;
  for (const [, path] of localStyles(site)) files.set(path, realStyle(site, path));
  for (const [, path] of localScripts(site)) files.set(path, realScript(site, path));
  files.set(clutterCssPath(site), css);
  files.set(pdfPath(site), annualReport(site));
  if (cms(site) === 'drupal') {
    const theme = `/themes/custom/${themeDir(site).replaceAll('-', '_')}/`;
    files.set(`${theme}favicon.ico`, TINY_PNG);
    files.set(`${theme}assets/favicons/apple-touch-icon.png`, TINY_PNG);
    files.set(`${theme}assets/favicons/site.webmanifest`, `${JSON.stringify({ name: site.name, short_name: handle(site), icons: [{ src: `${theme}assets/favicons/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }], theme_color: `#${hex(site, 6, 'theme-color')}`, background_color: '#ffffff', display: 'standalone' }, null, 2)}\n`);
  }
  return [...files].map(([path, body]) => ({ path, body }));
}

function clutterCssPath(site) {
  if (platformPaths(site)) return platformPaths(site).css;
  if (cms(site) === 'wordpress') return `/wp-content/themes/${themeDir(site)}/assets/css/components.css`;
  if (cms(site) === 'drupal') return `/themes/custom/${themeDir(site).replaceAll('-', '_')}/dist/css/components.css`;
  return `/static/css/components.${hex(site, 8, 'components')}.css`;
}

function pdfPath(site) {
  if (platformPaths(site)) return platformPaths(site).pdf;
  return cms(site) === 'wordpress' ? '/wp-content/uploads/2026/05/annual-report-2025.pdf' : cms(site) === 'drupal' ? '/sites/default/files/2026-05/annual-report-2025.pdf' : '/static/docs/annual-report-2025.pdf';
}

// The annual report linked from every footer: a real multi-section PDF with fictional text (built once per site).
function annualReport(site) { return memo(site, 'annualReport', () => annualReportPdf(site)); }

export function headClutter(site, page, ctx) {
  const kind = cms(site);
  const out = [];
  const seo = kind === 'wordpress' ? pick(site, ['yoast', 'rankmath', 'none'], 'seo-plugin') : 'none';
  if (seo === 'yoast') out.push(`<!-- This site is optimized with the Yoast SEO plugin v26.2 - https://yoast.com/product/yoast-seo-wordpress/ -->`);
  if (seo === 'rankmath') out.push('<!-- Search Engine Optimization by Rank Math PRO - https://rankmath.com/ -->');
  out.push(socialMeta(site, page, ctx));
  out.push(jsonLd(site, page, ctx));
  if (seo === 'yoast') out.push('<!-- / Yoast SEO plugin. -->');
  if (seo === 'rankmath') out.push('<!-- /Rank Math WordPress SEO plugin -->');
  out.push(...['fonts.cdn.example', 'cdn.media.example', 'stats.analytics.example'].filter((_, i) => r(site, 'hint', i) % 3 !== 0).map(host => `<link rel="${r(site, 'hint-kind', host) % 2 ? 'dns-prefetch' : 'preconnect'}" href="//${host}">`));
  if (kind === 'drupal') {
    const theme = `/themes/custom/${themeDir(site).replaceAll('-', '_')}/`;
    out.push(`<link rel="icon" href="${ctx.href(`${theme}favicon.ico`)}" type="image/vnd.microsoft.icon">`, `<link rel="alternate" hreflang="en" href="${ctx.esc(ctx.canonical)}">`, `<link rel="apple-touch-icon" sizes="180x180" href="${ctx.href(`${theme}assets/favicons/apple-touch-icon.png`)}">`, `<link rel="manifest" href="${ctx.href(`${theme}assets/favicons/site.webmanifest`)}">`, `<meta name="msapplication-TileColor" content="#${hex(site, 6, 'tile')}">`);
  }
  if (kind === 'wordpress') {
    out.push(`<link rel="alternate" type="application/rss+xml" title="${ctx.esc(site.name)} &raquo; Comments Feed" href="${ctx.href('/')}">`);
    out.push(`<script id="wp-emoji-settings" type="application/json">\n{"baseUrl":"\\/wp-includes\\/images\\/core\\/emoji\\/16.0.1\\/72x72\\/","ext":".png","svgUrl":"\\/wp-includes\\/images\\/core\\/emoji\\/16.0.1\\/svg\\/","svgExt":".svg","source":{"concatemoji":"\\/wp-includes\\/js\\/wp-emoji-release.min.js?ver=7.1.3"}}\n</script>`);
  }
  for (const [id, path, query, media] of localStyles(site)) out.push(`<link rel="stylesheet"${id ? ` id="${id}"` : ''} href="${ctx.href(path)}${query ? `?${query}` : ''}" media="${media ?? 'all'}">`);
  out.push(`<link rel="stylesheet" href="${ctx.href(clutterCssPath(site))}" media="all">`);
  for (const [id, css] of inlineStyles(site, page)) out.push(`<style id="${id}">\n${css}\n</style>`);
  if (kind === 'wordpress') out.push(wpLocalized(site));
  out.push(analyticsBootstrap(site, page));
  if (r(site, 'hotjar') % 2 === 0) out.push(`<!-- Session recording snippet (loads only after consent) -->\n<script>\n  window.sessionRecorder = window.sessionRecorder || { queue: [], siteId: ${100000 + r(site, 'hj') % 900000}, consentRequired: true };\n</script>`);
  if (r(site, 'pixel') % 2 === 0) out.push(`<!-- Social pixel (deferred until consent) -->\n<script>\n  window.socialPixelQueue = window.socialPixelQueue || [];\n  window.socialPixelQueue.push(['init', '${String(r(site, 'px')).padStart(10, '1')}'], ['track', 'PageView']);\n</script>\n<!-- End social pixel -->`);
  return out.join('\n');
}

export function bodyOpenClutter(site, page, ctx) {
  const out = [];
  out.push('<!-- Tag manager (noscript) -->\n<noscript><p class="noscript-notice">Some features of this site need JavaScript. You can still <a href="' + ctx.href('/') + '?nojs=1">browse the basic site</a>.</p></noscript>\n<!-- End tag manager (noscript) -->');
  out.push(svgSprite(site));
  if (cms(site) === 'drupal') out.push(drupalTwigDebug(site, 'html', 'layout/html.html.twig').trim());
  out.push(`<a href="#main-content-anchor" class="visually-hidden focusable skip-to-main">Skip to main navigation</a>`);
  out.push(`<div class="accessibility-toolbar" id="accessibility-toolbar" hidden>\n    <button type="button" data-a11y="text-larger">A+</button>\n    <button type="button" data-a11y="text-smaller">A-</button>\n    <button type="button" data-a11y="contrast">High contrast</button>\n    <button type="button" data-a11y="dyslexic">Readable font</button>\n  </div>`);
  out.push(megaMenu(site, page, ctx));
  out.push(offCanvas(site, page, ctx));
  const bp = bigPipe(site, page);
  if (bp.placeholders) out.push(bp.placeholders);
  out.push(`<template id="tpl-search-suggestion">\n    <li class="search-suggestion"><a class="search-suggestion__link" href="${ctx.href('/')}"><span class="search-suggestion__title"></span></a></li>\n  </template>`);
  return out.join('\n  ');
}

export function beforeFooterClutter(site, page, ctx) {
  const out = [];
  const feed = socialFeed(site, page, ctx);
  if (feed) out.push(feed);
  if (r(site, page.pageId, 'newsletter') % 3 !== 0) out.push(newsletter(site, ctx));
  const promo = pick(site, words(site).promos, page.pageId, 'promo');
  out.push(`<aside class="promo-strip" aria-label="Promotion" hidden>\n    <p>${ctx.esc(promo)}</p>\n    <a href="${ctx.href(site.navigation?.[0]?.href ?? '/')}?utm_source=site&amp;utm_medium=promo-strip&amp;utm_campaign=${hex(site, 6, 'campaign')}" data-track="promo">Learn more</a>\n  </aside>`);
  const widgets = domainWidgets(site, page, ctx);
  if (widgets) out.push(widgets);
  if (cms(site) === 'drupal') out.push(drupalTwigDebug(site, 'region', 'layout/region--footer.html.twig').trim());
  return out.filter(Boolean).join('\n  ');
}

function fatFooter(site, page, ctx) { return memo(site, `fatFooter${pageKey(site, page)}`, () => fatFooterBuild(site, page, ctx)); }
function fatFooterBuild(site, page, ctx) {
  const nav = site.navigation ?? [];
  const facets = ['?sort=newest', '?sort=title', '?view=list', '?view=grid', '?topic=local-history', '?topic=community', '?audience=teens', '?audience=seniors', '?format=online', '?year=2025', '?year=2024', '?ref=footer'];
  const columns = nav.map((item, index) => {
    const count = 5 + r(site, 'footer-col', index) % 6;
    const links = Array.from({ length: count }, (_, n) => {
      const query = facets[(r(site, 'footer-q', index, n) + n) % facets.length];
      const label = facetLabel(query, item.label);
      return `            <li><a href="${ctx.href(item.href)}${query.replaceAll('&', '&amp;')}">${ctx.esc(label)}</a></li>`;
    }).join('\n');
    return `          <div class="footer-sitemap__column">\n            <p class="footer-sitemap__heading">${ctx.esc(item.label)}</p>\n            <ul>\n${links}\n            </ul>\n          </div>`;
  }).join('\n');
  return `<nav class="footer-sitemap" aria-label="Site map" hidden>\n${columns}\n        </nav>`;
}

export function footerInnerClutter(site, page, ctx) {
  const nav = site.navigation ?? [];
  // Policy links open short notices inside the footer (no extra pages); Cookie settings opens the consent dialog;
  // Print version prints this page (site-actions.js).
  const policies = [['accessibility', 'Accessibility', `${ctx.esc(site.name)} aims to meet WCAG 2.2 AA. Use the toolbar at the top of each page to change text size, contrast and font; the settings are remembered in this browser.`],
    ['privacy', 'Privacy', `${ctx.esc(site.name)} is a fictional organization. This site stores your cookie choice, display settings, saved items and requests in your own browser only; nothing is sent to a server.`],
    ['terms', 'Terms of use', 'All content is fictional and generated for testing. Holds, bookings, donations, sign-ins and requests made here are demonstrations: no order, payment or appointment is created.'],
    ['connect', 'Follow us', `${ctx.esc(site.name)} has no real social media accounts. Follow our news by subscribing to the newsletter, or contact us at <a href="mailto:info@${handle(site)}.example">info@${handle(site)}.example</a>.`]];
  const kb = Math.max(1, Math.round(annualReport(site).length / 1024));
  return `<div class="site-footer-inner footer-extra">\n        ${fatFooter(site, page, ctx)}\n        <ul class="social-links">\n${socialLinks(site, page, ctx)}\n        </ul>\n        <p class="footer-meta">\n          ${policies.slice(0, 3).map(([id, label]) => `<a href="#${id}">${label}</a>`).join(' · ')} · <a href="#cookie-settings">Cookie settings</a>\n          · <a href="${ctx.href(pdfPath(site))}" download>Annual report (PDF, ${kb} KB)</a>\n          · <button type="button" class="footer-print">Print version</button>\n        </p>\n        <div class="footer-policies">\n${policies.map(([id, label, text]) => `          <details class="footer-policy" id="${id}"><summary>${label}</summary><p>${text}</p></details>`).join('\n')}\n        </div>\n        <div hidden class="crawler-honeypot">\n          <a href="${ctx.href(cms(site) === 'drupal' ? '/user/login' : cms(site) === 'wordpress' ? '/wp-admin/' : platformPaths(site)?.login ?? '/admin/')}" rel="nofollow">Staff sign in</a>\n          <a href="${ctx.href('/')}?s=&amp;sessionid=${hex(site, 16, page.pageId, 'session')}" rel="nofollow">Search</a>\n        </div>\n      </div>`;
}

export function bodyEndClutter(site, page, ctx) {
  const out = [];
  out.push(consent(site, ctx));
  out.push(`<div class="chat-widget" id="chat-widget" data-label="${ctx.esc(words(site).chat)}" data-position="${pick(site, ['bottom-right', 'bottom-left'], 'chat')}" hidden></div>`);
  out.push(`<button type="button" class="back-to-top" onclick="window.scrollTo(0, 0)" aria-label="Back to top" hidden>Back to top</button>`);
  out.push(stateBlob(site, page, ctx));
  const bp = bigPipe(site, page);
  if (bp.replacements) out.push(bp.replacements);
  // Scripts are listed in dependency order (jQuery before plugins, drupal.js before drupal.init.js), so once one is
  // deferred every later one is deferred too: a blocking script never runs before a deferred one it needs (matrix
  // check 2026-11-04: a blocking drupal.init.js after a deferred drupal.js threw "reading 'attachBehaviors'").
  let deferred = false;
  for (const [id, path, query] of localScripts(site)) {
    deferred ||= r(site, 'defer', path) % 2 === 0;
    out.push(`<script src="${ctx.href(path)}${query ? `?${query}` : ''}"${id ? ` id="${id}"` : ''}${deferred ? ' defer' : ''}></script>`);
  }
  if (cms(site) === 'wordpress') {
    const seconds = 1 + r(site, page.pageId, 'cache') % 600;
    out.push(`<!--\n\tgenerated ${seconds} seconds ago\n\tgenerated in 0.${String(100 + r(site, page.pageId, 'gen') % 899)} seconds\n\tserved from page cache in 0.00${r(site, page.pageId, 'hit') % 9} seconds\n\tcached ${pick(site, ['by object cache', 'by edge cache', 'for great performance'], 'cache-kind')}\n-->`);
  }
  if (cms(site) === 'drupal') out.push(drupalTwigDebug(site, 'html', 'layout/html.html.twig').replace('BEGIN OUTPUT', 'END OUTPUT').trim());
  return out.filter(Boolean).join('\n');
}
