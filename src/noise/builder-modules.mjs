import { seedFor } from '../site/util.mjs';

// "builder-modules" noise: the photo, button, audio player and content slider modules that page builders
// (Beaver Builder, Elementor) put next to a page's real content. None of them carries a record field, so the
// answer key is unchanged; they are decoys a migration tool has to look past (or, later, a place to hide fields).
//
// The markup follows the structure those builders emit (module and widget wrapper classes, data-node and data-id
// attributes). It was written from memory of real output, not copied from it: compare it with a page built in the
// local Elementor (`npm run wordpress`) or on a Beaver Builder site before relying on exact class names.
//
// Rules shared with the other markup operators: no <script>, only local resources, nothing that names the
// operator in the HTML, and the page's own field list is never touched.

export const BUILDER_MODULES_TYPE = 'builder-modules';
export const BUILDER_PHOTO_PATH = '/assets/media/builder-photo.png';
export const BUILDER_AUDIO_PATH = '/assets/media/builder-sample.wav';

const SLIDES = [
  ['Featured this month', 'A short note about something happening soon. Check the calendar for dates.'],
  ['Plan your visit', 'Opening hours and directions are listed on the visitor information page.'],
  ['Latest updates', 'Read the most recent announcements from our team.'],
];

// Severity 1 adds a photo and a button, 2 adds an audio player, 3 adds a three-slide content slider.
export function builderModuleKinds(severity) {
  return ['photo', 'button', ...(severity >= 2 ? ['audio'] : []), ...(severity >= 3 ? ['slider'] : [])];
}

// Which markup family a site gets. Beaver Builder and Elementor have their own; every other site gets plain blocks.
export function builderModulesProfile(site) {
  if (site?.cmsProfile !== 'wordpress') return 'generic';
  if (site.builderProfile === 'beaver-builder') return 'beaver';
  if (site.builderProfile === 'elementor') return 'elementor';
  return 'generic';
}

// The wrapper class the new modules are appended to, so they sit beside the page's own module the way a real
// builder page lists its modules in one column. Used by applyHtmlNoise; null means "append to <main>".
export const BUILDER_CONTAINER_CLASS = { beaver: 'fl-col-content', elementor: 'e-con', generic: null };

export function builderModulesMarkup({ profile, severity, seed, pageId }) {
  const kinds = builderModuleKinds(severity);
  const id = kind => seedFor(seed, pageId, BUILDER_MODULES_TYPE, kind).toString(16).padStart(8, '0');
  const attachment = kind => 100 + (seedFor(seed, pageId, BUILDER_MODULES_TYPE, `attachment-${kind}`) % 900);
  const photo = (extra = '') => `src="${BUILDER_PHOTO_PATH}" width="480" height="640" alt="Photo from a recent event"${extra}`;
  const render = { beaver, elementor, generic }[profile] ?? generic;
  return kinds.map(kind => render(kind)).join('');

  function beaver(kind) {
    const node = id(kind);
    const module = inner => `<div class="fl-module fl-module-${kind === 'slider' ? 'content-slider' : kind} fl-node-${node}" data-node="${node}"><div class="fl-module-content fl-node-content">${inner}</div></div>`;
    if (kind === 'photo') return module(`<div class="fl-photo fl-photo-align-center" itemscope itemtype="https://schema.org/ImageObject"><div class="fl-photo-content fl-photo-img-png"><img loading="lazy" decoding="async" class="fl-photo-img wp-image-${attachment(kind)} size-full" ${photo(' itemprop="image"')}></div></div>`);
    if (kind === 'button') return module('<div class="fl-button-wrap fl-button-width-auto fl-button-left"><a href="/" target="_self" class="fl-button" role="button"><span class="fl-button-text">Learn more</span></a></div>');
    if (kind === 'audio') return module(`<div class="fl-audio"><audio class="fl-audio-player" controls controlslist="nodownload" preload="none"><source src="${BUILDER_AUDIO_PATH}" type="audio/wav"></audio></div>`);
    const slides = SLIDES.map(([title, text], i) => `<div class="fl-slide fl-slide-${i} fl-slide-text-left"><div class="fl-slide-content-wrap"><div class="fl-slide-content"><h2 class="fl-slide-title">${title}</h2><div class="fl-slide-text"><p>${text}</p></div><a class="fl-slide-cta-button fl-button" href="/"><span class="fl-button-text">Read more</span></a></div></div></div>`).join('');
    return module(`<div class="fl-content-slider"><div class="fl-content-slider-wrapper">${slides}</div><div class="fl-content-slider-navigation"><a class="slider-prev" href="#"><span class="fl-sr-only">Previous slide</span></a><a class="slider-next" href="#"><span class="fl-sr-only">Next slide</span></a></div></div>`);
  }

  function elementor(kind) {
    const widget = id(kind);
    const wrap = (name, type, inner) => `<div class="elementor-element elementor-element-${widget} elementor-widget elementor-widget-${name}" data-id="${widget}" data-element_type="widget" data-widget_type="${type}"><div class="elementor-widget-container">${inner}</div></div>`;
    if (kind === 'photo') return wrap('image', 'image.default', `<img loading="lazy" decoding="async" class="attachment-large size-large wp-image-${attachment(kind)}" ${photo()}>`);
    if (kind === 'button') return wrap('button', 'button.default', '<div class="elementor-button-wrapper"><a class="elementor-button elementor-button-link elementor-size-sm" href="/"><span class="elementor-button-content-wrapper"><span class="elementor-button-text">Learn more</span></span></a></div>');
    if (kind === 'audio') return wrap('wp-widget-media_audio', 'wp-widget-media_audio.default', `<div class="widget widget_media_audio"><audio class="wp-audio-shortcode" id="audio-${attachment(kind)}-1" preload="none" style="width: 100%;" controls><source type="audio/wav" src="${BUILDER_AUDIO_PATH}"></audio></div>`);
    const slides = SLIDES.map(([title], i) => `<div class="swiper-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${SLIDES.length}"><figure class="swiper-slide-inner"><img decoding="async" class="swiper-slide-image" ${photo()}><figcaption class="elementor-image-carousel-caption">${title}</figcaption></figure></div>`).join('');
    return wrap('image-carousel', 'image-carousel.default', `<div class="elementor-image-carousel-wrapper swiper" dir="ltr"><div class="elementor-image-carousel swiper-wrapper" aria-live="polite">${slides}</div></div>`);
  }

  function generic(kind) {
    if (kind === 'photo') return `<figure class="content-module content-module-photo"><img loading="lazy" decoding="async" ${photo()}><figcaption>Photo from a recent event</figcaption></figure>`;
    if (kind === 'button') return '<p class="content-module content-module-button"><a class="module-button" href="/" role="button">Learn more</a></p>';
    if (kind === 'audio') return `<div class="content-module content-module-audio"><audio controls preload="none"><source src="${BUILDER_AUDIO_PATH}" type="audio/wav"></audio></div>`;
    const slides = SLIDES.map(([title, text]) => `<li class="module-slide"><h2>${title}</h2><p>${text}</p></li>`).join('');
    return `<div class="content-module content-module-slider"><ul class="module-slides">${slides}</ul></div>`;
  }
}

// A short, quiet tone: a real audio file for the player to point at, so a crawler that follows <source> gets a 200.
export function builderSampleWav() {
  const rate = 8000;
  const samples = 3200;
  const data = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) data[i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * 440 * i) / rate));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, data]);
}
