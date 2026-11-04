// Working behaviour for the controls on generated test websites.
//
// Every page loads /assets/site-actions.js (src/pages/browser/site-pages.js + src/pages/browser/site-actions.js). It gives each
// button, form and toggle the effect its label names: search goes to a results page, "Place hold"/"Add to list"
// save to a "My list" page, request and booking buttons open a request form that ends on a confirmation, sign-in goes
// to a sign-in page, newsletter forms end on a confirmation page, cookie buttons hide the banner and remember the
// choice, print prints, share copies the link. State lives in the visitor's localStorage; nothing is sent anywhere.
//
// The utility pages (search results, my list, sign-in, request, subscribe) are root-level .html files: the preview
// server serves them, and the WordPress/Drupal packages serve them as static files. They carry noindex, are not in the
// sitemap, are never answer-key pages and no page links to them in its HTML: they are reached through forms and
// clicks handled by site-actions.js, so a crawler's link graph is the same as before they existed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
let engineSource = null;
// Read once per process from the readable sources in src/pages/browser/, without indentation and whole-line // comments
// (no bundler here: this module is also loaded by the Next.js app, which must not pull in esbuild).
const compact = source => source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//')).join('\n');
const engine = () => engineSource ??= compact(`${readFileSync(join(HERE, 'browser', 'site-pages.js'), 'utf8')}\n${readFileSync(join(HERE, 'browser', 'site-actions.js'), 'utf8')}`);

export const RUNTIME_ASSET = '/assets/site-actions.js';
export const SEARCH_INDEX_ASSET = '/assets/search-index.js';
export const UTILITY_PAGES = { search: '/site-search.html', list: '/my-list.html', signin: '/sign-in.html', request: '/request.html', subscribe: '/subscribe.html' };
export const UTILITY_PATHS = new Set([...Object.values(UTILITY_PAGES), RUNTIME_ASSET, SEARCH_INDEX_ASSET]);
export const isUtilityPath = path => UTILITY_PATHS.has(path);

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const js = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const rel = path => path.replace(/^\//, '');

export function runtimeScript(site) {
  const config = { name: site.name, domain: site.domain, pages: Object.fromEntries(Object.entries(UTILITY_PAGES).map(([key, path]) => [key, rel(path)])) };
  return `/* ${String(site.name).replace(/\*\//g, '')}: site behaviours */\nwindow.SF_SITE = ${js(config)};\nwindow.SF_RUNTIME_CSS = ${js(RUNTIME_CSS)};\n${engine()}`;
}

// Search index: title, path, section and a short text of every page, as a script (served as JavaScript everywhere).
export function searchIndexScript(site, pages, limit = 20000) {
  const nav = site.navigation ?? [];
  const sections = ['Home', ...nav.map(item => item.label)];
  const sectionOf = url => { const i = nav.findIndex(item => item.href !== '/' && String(url).startsWith(item.href)); return i + 1; };
  const rows = pages.slice(0, limit).map(page => {
    const text = Object.entries(page.fields ?? {}).filter(([key, value]) => typeof value === 'string' && key !== 'title' && !/^(\/|https?:)/.test(value) && !/image|url|href/i.test(key))
      .map(([, value]) => value.replace(/\s+/g, ' ').trim()).join(' · ').slice(0, 180);
    return [String(page.title ?? ''), rel(page.url), sectionOf(page.url), text];
  });
  return `window.SF_SEARCH_INDEX = ${js({ sections, total: pages.length, pages: rows })};\n`;
}

const field = (label, input) => `<p class="sf-field"><label>${label}<br>${input}</label></p>`;

// Main content of each utility page. renderers.renderUtilityPage() wraps it in the site's own header and footer.
export function utilityPageSpecs(site) {
  const name = esc(site.name);
  const shell = (key, body) => `<div class="sf-utility" data-sf-page="${key}">${body}</div>`;
  return [
    { key: 'search', path: UTILITY_PAGES.search, title: 'Search results', main: shell('search', `<form class="sf-search-form" role="search" action="${rel(UTILITY_PAGES.search)}" method="get"><label for="sf-q">Search ${name}</label> <input id="sf-q" type="search" name="q"> <button type="submit" class="pg-btn pg-btn-primary">Search</button></form><p class="sf-search-status" role="status"></p><ol class="sf-search-results"></ol><noscript><p>Search needs JavaScript. Browse the sections in the menu instead.</p></noscript><script src="${SEARCH_INDEX_ASSET}"></script>`) },
    { key: 'list', path: UTILITY_PAGES.list, title: 'My list', main: shell('list', `<p>Items you place on hold, add to a list or planner, follow or request are kept here, in this browser.</p><div class="sf-list" aria-live="polite"></div>`) },
    { key: 'signin', path: UTILITY_PAGES.signin, title: 'Sign in', main: shell('signin', `<p class="sf-purpose"></p><form class="sf-signin-form" action="${rel(UTILITY_PAGES.signin)}" method="get" novalidate>${field('Email address', '<input type="email" name="email" autocomplete="username" required>')}${field('Password', '<input type="password" name="password" autocomplete="current-password" required>')}<p class="sf-error" role="alert" hidden></p><button type="submit" class="pg-btn pg-btn-primary">Sign in</button></form><div class="sf-signed-in" hidden></div><p class="sf-note">${name} is a fictional organization. This sign-in creates a demonstration account in your browser only.</p>`) },
    { key: 'request', path: UTILITY_PAGES.request, title: 'Request form', main: shell('request', `<h2 class="sf-request-title">Contact us</h2><p class="sf-request-item"></p><form class="sf-request-form" action="${rel(UTILITY_PAGES.request)}" method="get" novalidate><input type="hidden" name="type"><input type="hidden" name="item"><input type="hidden" name="from">${field('Your name', '<input type="text" name="name" autocomplete="name" required>')}${field('Email address', '<input type="email" name="email" autocomplete="email" required>')}<div class="sf-when">${field('Preferred date', '<input type="date" name="when">')}</div><div class="sf-amount" hidden>${field('Amount (USD, pledge only: no payment is taken)', '<input type="number" name="amount" min="1" step="1" inputmode="numeric">')}</div>${field('Message (optional)', '<textarea name="message" rows="4"></textarea>')}<p class="sf-error" role="alert" hidden></p><button type="submit" class="pg-btn pg-btn-primary">Send request</button></form><div class="sf-request-done" hidden></div>`) },
    { key: 'subscribe', path: UTILITY_PAGES.subscribe, title: 'Newsletter', main: shell('subscribe', `<form class="sf-subscribe-form" action="${rel(UTILITY_PAGES.subscribe)}" method="get" novalidate>${field('Email address', '<input type="email" name="email" autocomplete="email" required>')}<button type="submit" class="pg-btn pg-btn-primary">Subscribe</button></form><div class="sf-subscribed" hidden></div>`) },
  ];
}

// ------------------------------------------------------------------------------------------------ static assets
// Real, small file bodies for the CMS, plugin and platform asset URLs that page sources reference.

const CSS_LIBRARY = [
  [/print/i, '@media print{.site-header,.site-footer,.utility-bar,.megamenu,.off-canvas,.consent-banner,.newsletter-band,.social-feed,.accessibility-toolbar,.sf-toast,.back-to-top,.sf-menu-toggle,nav{display:none!important}body{font:12pt/1.45 Georgia,serif;color:#000;background:#fff}main a[href^="http"]::after{content:" (" attr(href) ")";font-size:.8em}h1,h2,h3{page-break-after:avoid}img{max-width:60%!important}}\n'],
  [/block-library|wp-block|blocks\//i, '.wp-block-group{box-sizing:border-box}.wp-block-columns{display:flex;flex-wrap:wrap;gap:2em;margin-bottom:1.75em}.wp-block-column{flex:1 1 0;min-width:0}.wp-block-image img{height:auto;max-width:100%;vertical-align:bottom}.wp-block-image figcaption{margin:.5em 0 1em;font-size:.85em;text-align:center}.wp-block-cover{position:relative;display:flex;min-height:430px;padding:1em;align-items:center;justify-content:center;background-size:cover}.wp-block-buttons{display:flex;flex-wrap:wrap;gap:.5em}.wp-block-button__link{display:inline-block;padding:.667em 1.333em;border-radius:9999px;background:#32373c;color:#fff;text-decoration:none}.wp-block-search__inside-wrapper{display:flex}.wp-block-search__input{flex:1;padding:8px;border:1px solid #949494}.wp-block-social-links{display:flex;gap:.5em;padding-left:0;list-style:none}.wp-block-navigation ul{display:flex;flex-wrap:wrap;gap:1em;margin:0;padding:0;list-style:none}.wp-block-heading{line-height:1.2}p.has-drop-cap:first-letter{float:left;font-size:4em;line-height:.7;margin:.05em .1em 0 0}\n'],
  [/contact-form-7|wpforms|gravityforms|webform|give|forms/i, 'form .wpcf7-form-control,.wpforms-field input,.gform_wrapper input,.webform-submission-form input,.give-form input{box-sizing:border-box;max-width:100%;padding:8px 10px;border:1px solid #8c8f94;border-radius:3px;font:inherit}.wpcf7-not-valid-tip,.wpforms-error,.gfield_validation_message,.form-item--error-message{display:block;margin-top:4px;color:#b32d2e;font-size:.9em}.wpcf7-response-output,.wpforms-confirmation-container,.gform_confirmation_message{margin:1em 0;padding:.6em 1em;border:2px solid #00a32a}.webform-element-description,.gfield_description{color:#555;font-size:.85em}\n'],
  [/carousel|slick/i, '.slick-slider,.jp-carousel-wrap{position:relative;overflow:hidden}.slick-track{display:flex;gap:12px;transition:transform .3s ease}.slick-arrow,.jp-carousel-nav{position:absolute;top:50%;transform:translateY(-50%);padding:6px 10px;border:0;background:rgba(0,0,0,.6);color:#fff;cursor:pointer}.slick-prev{left:4px}.slick-next{right:4px}.slick-dots{display:flex;justify-content:center;gap:6px;list-style:none}.sf-lightbox{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85)}.sf-lightbox img{max-width:90vw;max-height:85vh}\n'],
  [/related-posts/i, '.jp-relatedposts{clear:both;margin:1em 0;padding-top:1em;border-top:1px solid rgba(0,0,0,.2)}.jp-relatedposts-headline{font-size:.9em;font-weight:700;text-transform:uppercase}.jp-relatedposts-items{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}.jp-relatedposts-post-title a{font-weight:600;text-decoration:none}\n'],
  [/tribe-events|calendar|smart_date|event-card/i, '.tribe-events-schedule,.smart-date,.lc-event-card{display:flex;flex-wrap:wrap;align-items:baseline;gap:.4em;margin:.5em 0;font-weight:600}.tribe-event-date-start,.smart-date--date{white-space:nowrap}.lc-event-card{padding:12px;border:1px solid #d0d5dd;border-radius:6px}.calendar-upcoming{display:grid;gap:10px;list-style:none;padding:0}.simcal-calendar-grid{width:100%;border-collapse:collapse}.simcal-calendar-grid td{border:1px solid #ddd;vertical-align:top;height:4em}\n'],
  [/cookie|complianz|banner/i, '.consent-banner,.cmplz-cookiebanner,.eu-cookie-compliance-banner{position:fixed;right:16px;bottom:16px;left:16px;z-index:999;max-width:640px;padding:16px 20px;border-radius:8px;background:#1d2327;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25)}.consent-banner__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}\n'],
  [/extlink/i, 'svg.ext,svg.mailto,.ext-link-icon{width:.8em;height:.8em;margin-left:.2em;fill:currentColor;vertical-align:baseline}a.ext::after{content:"\\2197";display:inline-block;margin-left:.2em;font-size:.85em}\n'],
  [/autocomplete/i, '.search-api-autocomplete-search,.sf-suggest{position:absolute;z-index:500;margin:0;padding:4px 0;list-style:none;border:1px solid #c3c4c7;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.12)}.sf-suggest a{display:block;padding:6px 10px;color:inherit;text-decoration:none}.sf-suggest a:hover,.sf-suggest a:focus{background:#f0f0f1}\n'],
  [/exposed_filters|bef/i, '.bef-exposed-form .form--inline{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}.bef-checkboxes .form-item{display:flex;gap:6px;align-items:center}.bef-links a.bef-link--selected{font-weight:700}\n'],
  [/pum-site|popup/i, '.pum-overlay{position:fixed;inset:0;z-index:1999;background:rgba(0,0,0,.6)}.pum-container{position:relative;max-width:560px;margin:10vh auto;padding:24px;background:#fff;border-radius:6px}.pum-close{position:absolute;top:8px;right:8px;border:0;background:none;font-size:1.4em;cursor:pointer}\n'],
  [/paragraphs\.unpublished/i, '.paragraph--unpublished{padding:8px;background-color:#fff4f4}\n'],
  [/progress/i, '.progress{position:relative}.progress__track{min-width:100px;max-width:100%;height:.5rem;margin:.2em 0;border:1px solid;background-color:#fff}.progress__bar{width:3%;min-width:3%;max-width:100%;height:1.5em;background-color:#000}.progress__description,.progress__percentage{overflow:hidden;margin-top:.2em;color:#555;font-size:.875em}.ajax-progress,.ajax-progress-throbber{display:inline-block}.ajax-progress-fullscreen{position:fixed;z-index:1000;top:49.5%;left:49.5%;width:24px;height:24px;border-radius:50%;border:3px solid #ccc;border-top-color:#333}\n'],
  [/align\.module/i, '.align-left{text-align:left}.align-right{text-align:right}.align-center{text-align:center;margin-left:auto;margin-right:auto}.align-justify{text-align:justify}\n'],
  [/fieldgroup/i, '.fieldgroup{padding:0;border-width:0}\n'],
  [/container-inline/i, '.container-inline div,.container-inline label{display:inline-block}.container-inline .details-wrapper{display:block}\n'],
  [/clearfix/i, '.clearfix::after{display:table;clear:both;content:""}\n'],
  [/details\.module/i, '.js details:not([open]) .details-wrapper{display:none}\n'],
  [/hidden\.module/i, '.hidden{display:none}.visually-hidden{position:absolute!important;overflow:hidden;clip:rect(1px,1px,1px,1px);width:1px;height:1px;word-wrap:normal}.visually-hidden.focusable:active,.visually-hidden.focusable:focus-within{position:static!important;overflow:visible;clip:auto;width:auto;height:auto}.invisible{visibility:hidden}\n'],
  [/item-list/i, '.item-list__comma-list,.item-list__comma-list li{display:inline}.item-list__comma-list{margin:0;padding:0}.item-list__comma-list li::after{content:", "}.item-list__comma-list li:last-child::after{content:""}\n'],
  [/js\.module/i, '.js .js-hide{display:none}.js-show{display:none}.js .js-show{display:block}\n'],
  [/nowrap/i, '.nowrap{white-space:nowrap}\n'],
  [/position-container/i, '.position-container{position:relative}\n'],
  [/reset-appearance/i, '.reset-appearance{margin:0;padding:0;border:0 none;background:transparent;line-height:inherit;-webkit-appearance:none;appearance:none}\n'],
  [/resize/i, '.resize-none{resize:none}.resize-vertical{min-height:2em;resize:vertical}.resize-horizontal{max-width:100%;resize:horizontal}.resize-both{max-width:100%;min-height:2em;resize:both}\n'],
  [/system-status/i, '.system-status-counter{display:inline-flex;gap:.5em;align-items:center}.system-status-counter__status-icon{width:1.5em;height:1.5em}.system-status-report__entry{border-bottom:1px solid #ccc;padding:.5em 0}\n'],
  [/tablesort/i, 'th.is-active img,th.is-active .tablesort{display:inline-block;margin-left:.3em}.tablesort--asc::after{content:"\\25B2"}.tablesort--desc::after{content:"\\25BC"}\n'],
  [/views\.module/i, '.views-align-left{text-align:left}.views-align-right{text-align:right}.views-align-center{text-align:center}.views-view-grid .views-col{float:left}.views-view-grid .views-row{float:left;clear:both;width:100%}.views-display-link+.views-display-link{margin-left:.5em}\n'],
  [/caption/i, '.caption{display:table}.caption>*{display:block;max-width:none}.caption>figcaption{display:table-caption;max-width:none;caption-side:bottom;font-size:.85em}\n'],
  [/onecol/i, '.layout--onecol .layout__region{width:100%}\n'],
  [/fontawesome/i, '.fa,.fas,.far,.fab,[class^="icon-"]{display:inline-block;width:1em;height:1em;font-style:normal;line-height:1;vertical-align:-.125em}.fa-search::before,.icon-search::before{content:"\\1F50D"}.fa-bars::before,.icon-menu::before{content:"\\2630"}.fa-times::before,.icon-times::before{content:"\\00D7"}.fa-chevron-down::before{content:"\\25BE"}\n'],
  [/joomla-alert/i, 'joomla-alert{display:block;margin-bottom:1rem;padding:.75rem 1rem;border:1px solid #c1c9d0;border-radius:.25rem}joomla-alert[type=success]{border-color:#2f7d32;background:#e9f5ea}joomla-alert[type=danger]{border-color:#b32d2e;background:#fbeaea}joomla-alert .joomla-alert--close{float:right;border:0;background:none;font-size:1.25rem;cursor:pointer}\n'],
];
const PLATFORM_CSS = {
  joomla: '.container-header{background:var(--accent-strong,#112855)}.container-component{min-width:0}.com-content-article__body,.blog-items{line-height:1.6}.blog-item+.blog-item{margin-top:1.5rem}',
  squarespace: '.page-section{position:relative;padding:3.3vmax 4vw}.sqs-block{position:relative;padding:17px}.sqs-block-content{line-height:1.6}.content-wrapper{max-width:1200px;margin:0 auto}',
  webflow: '.w-container{max-width:940px;margin-left:auto;margin-right:auto}.w-container::after,.w-container::before{display:table;content:" "}.w-container::after{clear:both}.w-richtext>:first-child{margin-top:0}.w-richtext figure{max-width:60%}.w-layout-blockcontainer{display:block}',
  hubspot: '.body-container-wrapper{padding:2rem 0}.row-fluid{display:flex;flex-wrap:wrap;width:100%}.row-fluid .span12{width:100%}.dnd-section{padding:40px 20px}.hs_cos_wrapper_type_rich_text{line-height:1.6}',
  aem: '.aem-Grid{display:block;width:100%}.aem-Grid::after{display:table;clear:both;content:""}.aem-GridColumn{box-sizing:border-box;float:left;clear:none}.aem-GridColumn--default--12{width:100%}.cmp-container{position:relative}.cmp-text p{line-height:1.6}',
  sitecore: '.row{display:flex;flex-wrap:wrap;margin:0 -15px}.col-12{flex:0 0 100%;max-width:100%;padding:0 15px}.component{position:relative}.component-content{line-height:1.6}.rich-text p{margin:0 0 1em}',
  wix: '.wixui-section{position:relative;padding:40px 0}.wixui-rich-text{line-height:1.6;word-wrap:break-word}[data-testid=columns]{display:grid;grid-template-columns:minmax(0,1fr)}.wixui-column-strip__column{min-width:0}',
  shopify: '.page-width{max-width:120rem;margin:0 auto;padding:0 1.5rem}.page-width--narrow{max-width:72.6rem}.shopify-section{position:relative}.rte{line-height:1.6}.rte img{max-width:100%;height:auto}.section-template--main-padding{padding:36px 0}',
  ghost: '.gh-canvas{display:grid;grid-template-columns:[full-start] minmax(4vmin,auto) [wide-start] minmax(auto,240px) [main-start] min(720px,calc(100% - 8vmin)) [main-end] minmax(auto,240px) [wide-end] minmax(4vmin,auto) [full-end]}.gh-canvas>*{grid-column:main-start/main-end}.gh-content{line-height:1.6}.kg-card{margin:1.5em 0}',
};
const BASE_CSS = '*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}img,svg,video{max-width:100%;height:auto}button,input,select,textarea{font:inherit}button{cursor:pointer}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}.hidden,[hidden]{display:none!important}.sr-only,.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px);white-space:nowrap}table{border-collapse:collapse}';

export function realStyle(site, path) {
  const name = path.split('/').pop();
  const hit = CSS_LIBRARY.find(([pattern]) => pattern.test(path));
  const head = `/* ${name} — ${String(site.name).replace(/\*\//g, '')} */\n`;
  if (hit) return head + hit[1];
  const platform = PLATFORM_CSS[site.cmsProfile];
  return `${head}${BASE_CSS}\n${platform ? `${platform}\n` : ''}`;
}

// Small working scripts. The site's own behaviour is in /assets/site-actions.js; these implement the library each
// file name stands for (a jQuery-compatible core, Drupal behaviours, WordPress hooks, form validation, ...).
const JS_LIBRARY = [
  [/jquery-migrate/i, `(function($){if(!$)return;$.migrateVersion='3.4.1';$.fn.size=function(){return this.length;};$.fn.bind=$.fn.on;$.fn.unbind=$.fn.off;$.isArray=Array.isArray;$.trim=function(s){return s==null?'':String(s).trim();};$.parseJSON=JSON.parse;})(window.jQuery);`],
  [/jquery\.json/i, `(function($){if(!$)return;$.toJSON=function(v){return JSON.stringify(v);};$.evalJSON=$.secureEvalJSON=function(s){return JSON.parse(s);};})(window.jQuery);`],
  [/jquery/i, `(function(w,d){if(w.jQuery)return;function Q(n){var i;this.length=n.length;for(i=0;i<n.length;i++)this[i]=n[i];}
function $(s,c){if(typeof s==='function'){if(d.readyState!=='loading')s($);else d.addEventListener('DOMContentLoaded',function(){s($);});return;}
if(s instanceof Q)return s;if(!s)return new Q([]);if(typeof s==='string')return new Q((c||d).querySelectorAll(s));return new Q(s.length!==undefined&&s!==w?s:[s]);}
$.fn=Q.prototype;$.fn.jquery='3.7.1';
$.fn.each=function(f){for(var i=0;i<this.length;i++)f.call(this[i],i,this[i]);return this;};
$.fn.on=function(t,sel,f){if(typeof sel==='function'){f=sel;sel=null;}return this.each(function(){this.addEventListener(t,function(e){if(!sel)return f.call(this,e);var m=e.target.closest(sel);if(m&&this.contains(m))f.call(m,e);});});};
$.fn.off=function(){return this;};$.fn.find=function(s){var o=[];this.each(function(){o.push.apply(o,this.querySelectorAll(s));});return new Q(o);};
$.fn.addClass=function(c){return this.each(function(){this.classList.add.apply(this.classList,c.split(/\\s+/).filter(Boolean));});};
$.fn.removeClass=function(c){return this.each(function(){this.classList.remove.apply(this.classList,c.split(/\\s+/).filter(Boolean));});};
$.fn.toggleClass=function(c,s){return this.each(function(){this.classList.toggle(c,s);});};$.fn.hasClass=function(c){return this.length>0&&this[0].classList.contains(c);};
$.fn.attr=function(k,v){if(v===undefined)return this[0]?this[0].getAttribute(k):undefined;return this.each(function(){this.setAttribute(k,v);});};
$.fn.text=function(v){if(v===undefined)return this[0]?this[0].textContent:'';return this.each(function(){this.textContent=v;});};
$.fn.show=function(){return this.each(function(){this.hidden=false;});};$.fn.hide=function(){return this.each(function(){this.hidden=true;});};
$.extend=Object.assign;$.each=function(o,f){Object.keys(o).forEach(function(k){f.call(o[k],k,o[k]);});};w.jQuery=w.$=$;})(window,document);`],
  [/once/i, `window.once=function(id,selector,context){var els=typeof selector==='string'?(context||document).querySelectorAll(selector):[].concat(selector);var out=[];Array.prototype.forEach.call(els,function(el){var have=(el.getAttribute('data-once')||'').split(' ');if(have.indexOf(id)<0){have.push(id);el.setAttribute('data-once',have.join(' ').trim());out.push(el);}});return out;};`],
  [/drupalSettingsLoader/i, `(function(){var el=document.querySelector('head > script[type="application/json"][data-drupal-selector="drupal-settings-json"], body > script[type="application/json"][data-drupal-selector="drupal-settings-json"]');window.drupalSettings=el?JSON.parse(el.textContent):{};})();`],
  [/drupal\.init/i, `(function(Drupal,drupalSettings){function go(){Drupal.attachBehaviors(document,drupalSettings);}if(document.readyState!=='loading')go();else document.addEventListener('DOMContentLoaded',go);})(window.Drupal,window.drupalSettings);`],
  [/drupal\.js$/i, `window.Drupal=window.Drupal||{behaviors:{},locale:{}};(function(Drupal){Drupal.throwError=function(e){setTimeout(function(){throw e;},0);};Drupal.attachBehaviors=function(context,settings){context=context||document;settings=settings||window.drupalSettings;Object.keys(Drupal.behaviors).forEach(function(i){if(typeof Drupal.behaviors[i].attach==='function'){try{Drupal.behaviors[i].attach(context,settings);}catch(e){Drupal.throwError(e);}}});};Drupal.t=function(s,args){Object.keys(args||{}).forEach(function(k){s=s.split(k).join(args[k]);});return s;};Drupal.checkPlain=function(s){return String(s).replace(/[&<>"']/g,function(c){return '&#'+c.charCodeAt(0)+';';});};Drupal.url=function(p){return (window.drupalSettings&&drupalSettings.path?drupalSettings.path.baseUrl:'/')+p;};})(window.Drupal);`],
  [/debounce/i, `window.Drupal=window.Drupal||{behaviors:{}};Drupal.debounce=function(f,wait,immediate){var t;return function(){var c=this,a=arguments,later=function(){t=null;if(!immediate)f.apply(c,a);};var now=immediate&&!t;clearTimeout(t);t=setTimeout(later,wait);if(now)f.apply(c,a);};};`],
  [/displace/i, `window.Drupal=window.Drupal||{behaviors:{}};Drupal.displace=function(){var o={top:0,right:0,bottom:0,left:0};document.querySelectorAll('[data-offset-top]').forEach(function(el){o.top=Math.max(o.top,el.getBoundingClientRect().bottom);});Object.keys(o).forEach(function(k){document.documentElement.style.setProperty('--drupal-displace-offset-'+k,o[k]+'px');});Drupal.displace.offsets=o;return o;};window.addEventListener('resize',function(){Drupal.displace();});`],
  [/tabbable/i, `window.tabbable=function(root){return Array.prototype.filter.call((root||document).querySelectorAll('a[href],button,input,select,textarea,[tabindex]'),function(el){return !el.disabled&&el.tabIndex>=0&&!el.closest('[hidden]');});};window.isTabbable=function(el){return window.tabbable(el.parentNode).indexOf(el)>=0;};`],
  [/progress\.js/i, `window.Drupal=window.Drupal||{behaviors:{}};Drupal.ProgressBar=function(id){this.element=document.createElement('div');this.element.id=id;this.element.className='progress';this.element.innerHTML='<div class="progress__track"><div class="progress__bar"></div></div><div class="progress__percentage"></div>';};Drupal.ProgressBar.prototype.setProgress=function(p){this.element.querySelector('.progress__bar').style.width=p+'%';this.element.querySelector('.progress__percentage').textContent=p+'%';};`],
  [/ajax\.js/i, `window.Drupal=window.Drupal||{behaviors:{}};Drupal.behaviors.useAjax={attach:function(ctx){(window.once?once('use-ajax','a.use-ajax',ctx):[]).forEach(function(a){a.addEventListener('click',function(e){var target=document.querySelector(a.getAttribute('data-ajax-wrapper')?'#'+a.getAttribute('data-ajax-wrapper'):'main');if(!target)return;e.preventDefault();fetch(a.href).then(function(r){return r.text();}).then(function(h){var doc=new DOMParser().parseFromString(h,'text/html');var m=doc.querySelector('main');if(m)target.innerHTML=m.innerHTML;});});});}};`],
  [/hooks/i, `window.wp=window.wp||{};wp.hooks=(function(){var a={},f={};function add(s,n,cb,p){(s[n]=s[n]||[]).push({cb:cb,p:p||10});s[n].sort(function(x,y){return x.p-y.p;});}return{addAction:function(n,ns,cb,p){add(a,n,cb,p);},addFilter:function(n,ns,cb,p){add(f,n,cb,p);},doAction:function(n){var args=[].slice.call(arguments,1);(a[n]||[]).forEach(function(h){h.cb.apply(null,args);});},applyFilters:function(n,v){var args=[].slice.call(arguments,2);(f[n]||[]).forEach(function(h){v=h.cb.apply(null,[v].concat(args));});return v;},hasAction:function(n){return !!(a[n]&&a[n].length);}};})();`],
  [/i18n/i, `window.wp=window.wp||{};wp.i18n={__:function(s){return s;},_x:function(s){return s;},_n:function(one,many,n){return n===1?one:many;},sprintf:function(f){var a=[].slice.call(arguments,1),i=0;return String(f).replace(/%(\\d+\\$)?[sd]/g,function(m,pos){return pos?a[parseInt(pos,10)-1]:a[i++];});},setLocaleData:function(){},isRTL:function(){return document.documentElement.dir==='rtl';}};`],
  [/dom-ready/i, `window.wp=window.wp||{};wp.domReady=function(cb){if(document.readyState==='complete'||document.readyState==='interactive')return void cb();document.addEventListener('DOMContentLoaded',cb);};`],
  [/a11y/i, `window.wp=window.wp||{};wp.a11y={speak:function(message,politeness){var id='a11y-speak-'+(politeness==='assertive'?'assertive':'polite');var r=document.getElementById(id);if(!r){r=document.createElement('div');r.id=id;r.className='a11y-speak-region visually-hidden';r.setAttribute('aria-live',politeness==='assertive'?'assertive':'polite');document.body.appendChild(r);}r.textContent='';setTimeout(function(){r.textContent=message;},50);}};`],
  [/url\.min/i, `window.wp=window.wp||{};wp.url={addQueryArgs:function(u,args){var x=new URL(u||'',location.href);Object.keys(args||{}).forEach(function(k){x.searchParams.set(k,args[k]);});return x.href;},getQueryArg:function(u,k){return new URL(u,location.href).searchParams.get(k)||undefined;},removeQueryArgs:function(u){var x=new URL(u,location.href);[].slice.call(arguments,1).forEach(function(k){x.searchParams.delete(k);});return x.href;}};`],
  [/polyfill|legacy\.js/i, `(function(){if(!Element.prototype.matches)Element.prototype.matches=Element.prototype.msMatchesSelector;if(!Element.prototype.closest)Element.prototype.closest=function(s){var e=this;do{if(e.matches(s))return e;e=e.parentElement;}while(e);return null;};if(window.NodeList&&!NodeList.prototype.forEach)NodeList.prototype.forEach=Array.prototype.forEach;if(!Array.prototype.includes)Array.prototype.includes=function(v){return this.indexOf(v)>=0;};})();`],
  [/comment-reply/i, `document.addEventListener('click',function(e){var a=e.target.closest('.comment-reply-link');if(!a)return;var form=document.getElementById('respond');var target=document.getElementById(a.getAttribute('data-belowelement')||'');if(!form||!target)return;e.preventDefault();target.appendChild(form);var p=form.querySelector('[name=comment_parent]');if(p)p.value=a.getAttribute('data-commentid')||'0';var t=form.querySelector('textarea');if(t)t.focus();});`],
  [/contact-form-7|gravityforms|webform|wpforms|give|forms/i, `document.addEventListener('submit',function(e){var form=e.target;if(!form.matches('.wpcf7-form,.gform_wrapper form,.webform-submission-form,.wpforms-form,.give-form'))return;var bad=[].filter.call(form.querySelectorAll('[required],[aria-required=true]'),function(i){return !String(i.value).trim();});form.querySelectorAll('.sf-invalid-tip').forEach(function(t){t.remove();});if(bad.length){e.preventDefault();bad.forEach(function(i){i.setAttribute('aria-invalid','true');var tip=document.createElement('span');tip.className='sf-invalid-tip wpcf7-not-valid-tip';tip.textContent='Please fill out this field.';i.insertAdjacentElement('afterend',tip);});bad[0].focus();}});`],
  [/carousel|slick|cards/i, `document.addEventListener('click',function(e){var img=e.target.closest('.gallery img,.wp-block-gallery img,.kg-gallery-image img,.pg-gallery img');if(!img)return;e.preventDefault();var box=document.createElement('div');box.className='sf-lightbox';box.setAttribute('role','dialog');box.setAttribute('aria-label',img.alt||'Image');box.innerHTML='<img alt=""><button type="button" class="sf-dialog__close">Close</button>';box.querySelector('img').src=img.currentSrc||img.src;box.addEventListener('click',function(){box.remove();});document.body.appendChild(box);});`],
  [/extlink/i, `document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('a[href^="http"]').forEach(function(a){if(a.host!==location.host){a.classList.add('ext');a.rel=(a.rel+' noopener').trim();var s=document.createElement('span');s.className='visually-hidden';s.textContent=' (link is external)';a.appendChild(s);}});});`],
  [/exposed_filters/i, `document.addEventListener('change',function(e){var f=e.target.closest('.pg-facets-form,.bef-exposed-form');if(f&&e.target.matches('input[type=checkbox],select')){if(f.requestSubmit)f.requestSubmit();else f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));}});`],
  [/autocomplete|search[.-]/i, `(function(){var loaded=false,box;function load(cb){if(window.SF_SEARCH_INDEX||loaded)return cb();loaded=true;var root=(document.querySelector('script[src*="assets/site-actions.js"]')||{}).src;if(!root)return;var s=document.createElement('script');s.src=root.replace('site-actions.js','search-index.js');s.onload=cb;document.head.appendChild(s);}
document.addEventListener('input',function(e){var i=e.target;if(!i.matches('form[role=search] input[type=search]'))return;load(function(){var idx=window.SF_SEARCH_INDEX;if(!idx)return;var q=i.value.trim().toLowerCase();if(!box){box=document.createElement('ul');box.className='sf-suggest';box.setAttribute('role','listbox');}i.form.style.position='relative';i.form.appendChild(box);var root=document.querySelector('script[src*="assets/site-actions.js"]').src.replace(/assets\\/site-actions\\.js.*$/,'');var hits=q.length<2?[]:idx.pages.filter(function(p){return p[0].toLowerCase().indexOf(q)>=0;}).slice(0,6);box.innerHTML=hits.map(function(p){return '<li role="option"><a href="'+new URL(p[1],root).href+'">'+p[0].replace(/[&<>]/g,'')+'</a></li>';}).join('');box.hidden=!hits.length;});});})();`],
  [/analytics|gtag|parsely|loader\.js|load_feature|embed\.js/i, `window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments);};(function(){var sent={};function track(name,data){var e=Object.assign({event:name,page:location.pathname,time:Date.now()},data||{});dataLayer.push(e);return e;}if(!sent.view){sent.view=1;track('page_view',{title:document.title});}document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;if(a.host!==location.host)track('outbound_click',{href:a.href});else if(/\\.(pdf|ics|zip)(\\?|$)/i.test(a.pathname)||a.hasAttribute('download'))track('file_download',{href:a.pathname});});window.siteAnalytics={track:track};})();`],
  [/messages|alert/i, `document.addEventListener('click',function(e){var b=e.target.closest('.joomla-alert--close,[data-dismiss=alert],.messages__close');if(!b)return;var box=b.closest('joomla-alert,.alert,.messages');if(box)box.remove();});`],
  [/portal|account|login/i, `document.addEventListener('click',function(e){var a=e.target.closest('[data-portal],[data-members-signin]');if(!a||!window.SiteActions)return;e.preventDefault();location.assign(SiteActions.url('signin',{for:'Sign in',next:location.pathname}));});`],
  [/worker/i, `/* Search worker: matches page titles off the main thread when a page posts {index, query}. */\nif(typeof self!=='undefined'&&typeof document==='undefined'){self.onmessage=function(e){var q=String(e.data.query||'').toLowerCase();self.postMessage((e.data.index||[]).filter(function(p){return String(p[0]).toLowerCase().indexOf(q)>=0;}).slice(0,20));};}`],
  [/navigation/i, `document.addEventListener('keydown',function(e){var link=e.target.closest('.site-nav a, nav[aria-label=Primary] a');if(!link||['ArrowLeft','ArrowRight'].indexOf(e.key)<0)return;var links=[].slice.call(link.closest('nav').querySelectorAll('a'));var i=links.indexOf(link)+(e.key==='ArrowRight'?1:-1);if(links[i]){e.preventDefault();links[i].focus();}});window.addEventListener('scroll',function(){var h=document.querySelector('header');if(h)h.classList.toggle('is-scrolled',window.scrollY>40);},{passive:true});`],
];
const DEFAULT_JS = `/* Theme utilities: focus the target of skip links, wrap wide tables so they scroll, and smooth in-page anchors. */
(function(){function ready(f){if(document.readyState!=='loading')f();else document.addEventListener('DOMContentLoaded',f);}
ready(function(){document.documentElement.classList.add('js');document.querySelectorAll('main table').forEach(function(t){if(t.parentElement.classList.contains('table-scroll'))return;if(t.scrollWidth<=t.parentElement.clientWidth)return;var w=document.createElement('div');w.className='table-scroll';w.style.overflowX='auto';t.parentNode.insertBefore(w,t);w.appendChild(t);});});
document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a||a.getAttribute('href').length<2)return;var t=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));if(!t)return;if(!t.hasAttribute('tabindex'))t.setAttribute('tabindex','-1');setTimeout(function(){t.focus({preventScroll:true});},0);});})();`;

export function realScript(site, path) {
  const name = path.split('/').pop();
  const hit = JS_LIBRARY.find(([pattern]) => pattern.test(name)) ?? JS_LIBRARY.find(([pattern]) => pattern.test(path));
  return `/*! ${name} | ${String(site.name).replace(/\*\//g, '')} */\n${hit ? hit[1] : DEFAULT_JS}\n`;
}

// ------------------------------------------------------------------------------------------------ PDF documents
const pdfSafe = text => String(text).normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1');
export function textPdf(title, paragraphs) {
  const lines = [];
  for (const paragraph of paragraphs) {
    const heading = paragraph.startsWith('# ');
    let line = '';
    for (const word of pdfSafe(heading ? paragraph.slice(2) : paragraph).split(' ')) {
      if (`${line} ${word}`.length > 86) { lines.push([line, heading]); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push([line, heading]);
    lines.push(['', false]);
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += 46) pages.push(lines.slice(i, i + 46));
  const objects = ['<< /Type /Catalog /Pages 2 0 R /Lang (en-US) >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', `<< /Title (${pdfSafe(title)}) /Producer (SiteForge) >>`];
  const kids = [];
  pages.forEach((page, n) => {
    let stream = `BT /F2 18 Tf 56 770 Td (${pdfSafe(n ? `${title} (continued)` : title)}) Tj 0 -30 Td 15 TL`;
    for (const [text, bold] of page) stream += ` /${bold ? 'F2 12' : 'F1 10.5'} Tf (${text}) Tj T*`;
    stream += ` ET BT /F1 8 Tf 56 36 Td (Page ${n + 1} of ${pages.length}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objects.length} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
    kids.push(`${objects.length} 0 R`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const REPORT_FOCUS = {
  library: ['visits to our branches', 'items borrowed', 'library cards issued', 'programs for children and teens'],
  museum: ['visitors welcomed', 'objects conserved', 'school groups hosted', 'new acquisitions'],
  university: ['students enrolled', 'research grants awarded', 'graduates', 'community partnerships'],
  healthcare: ['patient visits', 'same-day appointments', 'vaccinations given', 'community health classes'],
  government: ['applications processed', 'service requests answered', 'grants distributed', 'public meetings held'],
  municipality: ['service requests closed', 'permits issued', 'miles of road resurfaced', 'public meetings streamed'],
  news: ['stories published', 'newsletter subscribers', 'corrections issued', 'community events covered'],
  nonprofit: ['families supported', 'volunteer hours', 'donors', 'programs delivered'],
  records: ['reading-room visits', 'records digitized', 'copy requests completed', 'research enquiries answered'],
  documentation: ['guides published', 'API versions supported', 'support questions answered', 'community contributions'],
};
export function annualReportPdf(site) {
  const seed = [...String(site.seed ?? 0)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const focus = REPORT_FOCUS[site.domain] ?? REPORT_FOCUS.library;
  const figures = focus.map((label, i) => `${(((seed >>> (i * 3)) % 900) + 100) * (i === 0 ? 120 : i === 1 ? 37 : 3)} ${label}`);
  return textPdf(`${site.name} Annual Report 2025`, [
    `${site.name} is a fictional organization. This report was generated for a test website and every figure in it is invented.`,
    '# A message from the director',
    `2025 was a year of steady growth for ${site.name}. We listened to the people we serve, simplified how they reach us online and in person, and invested in the staff and volunteers who make our work possible.`,
    '# The year in numbers',
    ...figures.map(line => `- ${line}`),
    '# Highlights',
    `We redesigned our website so that searching, saving items and making requests take fewer steps. Opening hours were extended at our busiest locations, and a new accessibility review led to clearer signage and better contrast across our printed and online materials.`,
    '# Finances',
    `Operating income was ${(seed % 40) + 12}.${seed % 10} million dollars, of which ${(seed % 20) + 55} percent came from public funding, ${(seed % 15) + 10} percent from grants and the rest from donations and earned income. Spending stayed within budget for the third year in a row.`,
    '# Looking ahead',
    'In 2026 we will expand evening programs, publish more of our collections and services online, and continue to ask for feedback through our website and at every location.',
    `Contact: ${site.name}, annual report enquiries. This document is part of a fictional test site.`,
  ]);
}

// A 32x32 favicon: a rounded square in a colour seeded from the site, with a lighter inner band (real PNG, ~150 bytes).
export function faviconPng(site) {
  const seed = [...`${site.seed ?? 0}|${site.name ?? ''}`].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const [r, g, b] = [40 + seed % 120, 40 + (seed >>> 8) % 120, 60 + (seed >>> 16) % 140];
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const corner = (x < 3 || x > 28) && (y < 3 || y > 28) && Math.hypot(x < 3 ? 3 - x : x - 28, y < 3 ? 3 - y : y - 28) > 3;
      const band = y >= 12 && y <= 19 && x >= 6 && x <= 25;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = band ? 255 : r; raw[o + 1] = band ? 255 : g; raw[o + 2] = band ? 255 : b; raw[o + 3] = corner ? 0 : 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Styles for what site-actions.js adds to a page (toasts, dialogs, menu toggles, utility pages); the script injects
// them once per page so every site, whatever its stylesheet, shows them consistently.
export const RUNTIME_CSS = `.sf-toast{position:fixed;left:50%;bottom:20px;z-index:2000;display:flex;gap:10px;align-items:center;max-width:min(560px,calc(100% - 32px));padding:12px 16px;transform:translateX(-50%);border-radius:8px;background:#1f2937;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:.95rem}.sf-toast a{color:#bfdbfe}.sf-toast__close{border:0;background:none;color:inherit;font-size:1.2rem}
.sf-dialog{position:fixed;inset:0;z-index:1900;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55)}.sf-dialog__panel{width:min(480px,100%);padding:22px;border-radius:10px;background:var(--paper,#fff);color:var(--ink,#111);box-shadow:0 12px 40px rgba(0,0,0,.3)}.sf-dialog__title{margin:0 0 10px;font-size:1.25rem}.sf-dialog__close{margin-top:12px;padding:8px 14px;border:1px solid var(--line,#ccc);border-radius:6px;background:transparent;color:inherit}
.sf-menu-toggle,.sf-mega-toggle{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:.9rem}.sf-mega-toggle{margin-left:4px;padding:0 6px;border:0}.sf-menu-toggle{flex:0 0 auto;width:auto}
.off-canvas:not([hidden]){position:fixed;inset:0 auto 0 0;z-index:1500;display:block!important;width:min(340px,90vw);overflow:auto;padding:16px;background:var(--paper,#fff);color:var(--ink,#111);box-shadow:4px 0 24px rgba(0,0,0,.25)}.off-canvas .mobile-menu__list,.off-canvas .mobile-menu__sub{list-style:none;margin:0;padding:0}.off-canvas .mobile-menu__item{display:flex;flex-wrap:wrap;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line,#ddd)}.off-canvas .mobile-menu__sub{flex-basis:100%;padding:6px 0 0 12px}.off-canvas__footer{display:flex;flex-direction:column;gap:8px;margin-top:16px}.off-canvas button{border:0;background:none;color:inherit}.off-canvas .icon{width:1.1em;height:1.1em}
.megamenu.is-open{position:absolute;left:0;right:0;z-index:1400;display:block!important}.megamenu__panel:not([hidden]){display:block;padding:20px;background:var(--paper,#fff);color:var(--ink,#111);box-shadow:0 12px 30px rgba(0,0,0,.18)}.megamenu__inner{display:flex;flex-wrap:wrap;gap:28px;max-width:1120px;margin:0 auto}.megamenu__list{list-style:none;margin:0;padding:0}.megamenu__item{margin:4px 0}.megamenu__heading{margin:0 0 6px;font-weight:700}.megamenu__promo{max-width:220px}
.consent-banner:not([hidden]){position:fixed;right:16px;bottom:16px;left:16px;z-index:1600;display:block!important;max-width:640px;padding:16px 20px;border-radius:10px;background:#111827;color:#f9fafb;box-shadow:0 10px 30px rgba(0,0,0,.3)}.consent-banner__title{margin:0 0 4px;font-weight:700}.consent-banner__text{margin:0}.consent-banner__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.consent-button{padding:8px 14px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font:inherit}.consent-button--accept{background:#f9fafb;color:#111827}
.consent-preferences:not([hidden]){position:fixed;inset:0;z-index:1700;display:flex!important;align-items:center;justify-content:center;background:rgba(15,23,42,.55)}.consent-preferences__form{width:min(520px,calc(100% - 32px));max-height:85vh;overflow:auto;padding:20px;border-radius:10px;background:var(--paper,#fff);color:var(--ink,#111)}.consent-category{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:10px 0;border-bottom:1px solid var(--line,#ddd)}.consent-category__text{grid-column:1/-1;margin:0;font-size:.9rem;color:var(--muted,#555)}.consent-preferences .consent-button{margin-top:14px;background:var(--accent-strong,#1d4ed8);color:#fff;border:0}
.accessibility-toolbar:not([hidden]){display:flex;justify-content:flex-end;gap:6px;padding:4px 12px;background:var(--wash,#f3f4f6);font-size:.8rem}.accessibility-toolbar button{padding:2px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:var(--paper,#fff);color:var(--ink,#111)}.accessibility-toolbar button[aria-pressed=true]{background:var(--ink,#111);color:var(--paper,#fff)}
html.sf-contrast body{background:#000!important;color:#fff!important}html.sf-contrast a{color:#ff0!important}html.sf-contrast *{border-color:#fff!important}html.sf-readable body,html.sf-readable button,html.sf-readable input{font-family:Verdana,Tahoma,sans-serif!important;letter-spacing:.03em;word-spacing:.12em;line-height:1.7}
.chat-widget:not([hidden]){position:fixed;right:16px;bottom:72px;z-index:1300}.chat-widget[data-position=bottom-left]{right:auto;left:16px}.chat-launcher{padding:10px 16px;border:0;border-radius:999px;background:var(--accent-strong,#1d4ed8);color:#fff;font:inherit;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.2)}
.sf-printbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;background:#fef3c7;color:#111}html.sf-print-view .site-header,html.sf-print-view .utility-bar,html.sf-print-view .site-footer,html.sf-print-view .newsletter-band,html.sf-print-view .social-feed{display:none!important}@media print{.sf-printbar,.sf-toast,.sf-menu-toggle,.sf-mega-toggle,.chat-widget,.consent-banner,.accessibility-toolbar{display:none!important}}
.footer-policies{display:flex;flex-wrap:wrap;gap:4px 18px;margin:8px 0 0;font-size:.8rem}.footer-policy summary{cursor:pointer}.footer-policy p{max-width:520px;margin:4px 0 8px}.footer-print{padding:0;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}
.sf-empty{padding:16px;border:1px dashed var(--line,#ccc);border-radius:8px}[aria-pressed=true].pg-btn{outline:2px solid currentColor;outline-offset:1px}.pg-view-grid .pg-results>table,.pg-view-grid .pg-results ul{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.sf-utility{max-width:760px}.sf-utility form{display:grid;gap:4px;margin:16px 0}.sf-search-form{display:flex!important;flex-wrap:wrap;gap:8px!important;align-items:center}.sf-search-form input,.sf-field input,.sf-field textarea{width:100%;max-width:420px;padding:9px 11px;border:1px solid var(--line,#bbb);border-radius:6px;font:inherit}.sf-search-form input{flex:1 1 240px}.sf-field{margin:6px 0}.sf-error{color:#b42318;font-weight:600}.sf-ok{padding:10px 14px;border-left:4px solid #15803d;background:#f0fdf4;color:#14532d}.sf-search-results{padding-left:1.4em}.sf-result{margin:14px 0}.sf-result__title{font-weight:700;font-size:1.05rem}.sf-result__meta{margin:2px 0;color:var(--muted,#555);font-size:.85rem}.sf-result__text{margin:2px 0}.sf-items{list-style:none;padding:0}.sf-item{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line,#ddd)}.sf-item__meta{color:var(--muted,#555);font-size:.85rem}.sf-note{color:var(--muted,#555);font-size:.9rem}mark{background:#fde68a;color:inherit}
`;
