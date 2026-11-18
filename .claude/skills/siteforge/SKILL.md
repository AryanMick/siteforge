---
name: siteforge
description: Use SiteForge to build fake test websites with answer keys, load them into a real local WordPress, and score a crawler's output (such as Smartcite's) against the answer key. Use when asked to make test sites, add noise, push a site into WordPress, or score a crawl.
---

# SiteForge

SiteForge builds fake websites for testing Smartcite, a crawler that moves website content into a new system. Every
site has a private answer key (JSON) listing each page, its content type, its cluster and every field value. README.md
explains everything for people; this file is the short version for an AI assistant.

## Rules

- Never show the answer key (`private/`, `answer-key.json`, `ground-truth.json`, `wordpress-answer-key.json`) to the
  crawler being tested. Only the `public/` folder and preview addresses are for the crawler.
- The same seed and settings always build the same site. To get a different site, change the seed.
- Everything runs on this computer. Do not deploy, and do not push to GitHub unless the user asks.

## Start

```bash
npm start            # installs what's missing, starts the app at http://127.0.0.1:4400 and opens the browser
npm run wordpress    # starts only the local WordPress at http://127.0.0.1:9400 (login admin / password)
```

In the app: **Create test set** makes sites, **Saved test sets** lists them with Preview, ZIP, JSON (answer key),
WP/Drupal packages, Score and Push buttons. **Start WordPress**, then **Push** (one site) or **Push all sites**.
Typing http://127.0.0.1:4400/wp-admin opens the WordPress dashboard, or offers to start WordPress.

## Command line

```bash
node src/cli.mjs generate examples/library.yaml --out outputs/library        # one site from a settings file
node src/cli.mjs generate examples/library.yaml --out outputs/hard --noise high --pages 200
node src/cli.mjs serve outputs/library --port 4310                           # preview it for the crawler
node src/cli.mjs evaluate --truth outputs/library/private/answer-key.json --actual output.json --out outputs/report
node src/cli.mjs wordpress push outputs/library --builder elementor          # into the local WordPress
node src/cli.mjs wordpress inspect                                           # what content types WordPress has
```

Settings files are YAML; see `examples/` (`library.yaml`, `adversarial-library.yaml`, `noise-custom.yaml`). Useful
keys under `site`: `domain` (library, government, municipality, university, healthcare, documentation, museum, nonprofit,
records, news), `framework` (html, react, angular), `visualStyle` (legacy, conventional, modern), `cmsProfile`
(none, wordpress, drupal and others), `builderProfile` (gutenberg, elementor, beaver-builder, divi, wpbakery, oxygen,
bricks, avada, siteorigin; WordPress only), `pageCount`. Under `noise`: `level` (clean, low, medium, high, custom) and,
for custom, `types` (names in `src/site/config.mjs`, for example `builder-modules`, `split-text-runs`,
`shortcode-residue`).

## Scoring

The crawler writes `{ "version": 1, "pages": [{ "url", "cluster", "contentType"?, "fields"? }] }`; the format is
`examples/smartcite-output.schema.json`. Upload it with **Score** in the app, or run `evaluate` above. For a crawl of
the WordPress site, score against the WordPress answer key that each push writes (download it next to the push result).

## Where things are

- `src/site/` plans a site, `src/render/` writes its HTML, `src/noise/` adds problems on purpose, `src/answers/` builds
  and scores answer keys.
- `src/wordpress/` and `wordpress/siteforge-importer/` run the local WordPress and push sites into it.
- Saved test sets live in `.fixture-lab/jobs/<set>/sites/<site>/` (`public/` for the crawler, `private/` for answers).

## Adding a new kind of noise

1. Add the operator to `applyHtmlNoise` in `src/noise/noise.mjs` (or its own file, like `src/noise/builder-modules.mjs`).
2. Add its name to `MARKUP_NOISE_TYPES` in `src/site/config.mjs`; if it does not change field values, also to the
   non-semantic sets in `src/noise/noise.mjs` and `src/answers/answer-key.mjs`.
3. Add a label in `src/fixture-lab/catalog.mjs` so it shows in the app.
4. Test it in `test/adversarial-html.test.mjs`, then run `npm test` and `npm run test:matrix -- --quick`.
