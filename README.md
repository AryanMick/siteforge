# SiteForge

SiteForge builds fake websites for testing Smartcite, a tool that crawls websites and moves their content to a new system.
Each fake site comes with an answer key: a JSON file that lists every page on the site and every value on each page.
You run Smartcite on the site, then compare what it found with the answer key.

The organizations, people and records are invented. Page layouts follow real sites such as si.edu, nypl.org and
boston.gov, but no real content is copied.

## Run it

You need [Node.js 24](https://nodejs.org).

- **Mac:** double-click `Open SiteForge.command`.
- **Windows:** double-click `Open SiteForge.bat`.
- **Any system:** run `npm install` once, then `npm run siteforge`.

The app opens at http://127.0.0.1:4400. It runs on your computer only. Closing the window stops it.

## Make a test set

Fill in **Create test set** and press **Generate test set**.

| Setting | What it does |
| --- | --- |
| Websites | How many sites to build (1 to 500). |
| Pages per site | How many pages each site has (5 to 100,000). 0 picks a random size. |
| Site type | Library, government, city, university, healthcare, documentation, museum, nonprofit, public records or news. Each type has its own content and layouts. |
| Technology | Plain HTML, React or Angular. React and Angular pages are built in the browser, like real apps. |
| CMS markup | None, WordPress or Drupal. Adds the classes, scripts and headers those systems put on every page. |
| Markup noise | How much broken or messy HTML to add, from clean to high. |
| Look & page source | Old, conventional or modern design, page-builder markup (Gutenberg, Elementor and others) and how fields are laid out. |
| Noise & scenarios | Which kinds of problems to add, such as misleading metadata, damaged HTML or crawler traps, and how hard to make them. |
| Links & responses | How links are written (relative, root-relative, full URLs or mixed) and server problems such as errors and redirect loops. |
| Repeatability | The seed. The same seed and settings always build the same sites. |

**Randomize settings** sets every choice to random.

## Use a test set

Open **Saved test sets**. Each site has these buttons:

- **Preview** starts the site at a local address. Point Smartcite at that address.
- **ZIP** downloads the website files only. This is what Smartcite may see.
- **JSON** downloads the answer key. Keep it away from Smartcite.
- **WP** and **Drupal** download a theme or module that installs the site into a real WordPress or Drupal.
- **Score** takes Smartcite's output file and shows how much it got right.
- **Push** puts the site's content into the real WordPress on your computer (see below).

**Download full test package** saves every site and its answer key, one folder per site.

## The answer key

For every page the answer key records its URL, its content type, its cluster (pages with the same data structure share
a cluster), every field value, which optional fields are missing, links to related records, the records shown on listing
pages and every piece of noise that was added. It is written from the source data before any HTML exists, so it is
always correct.

## Score Smartcite's output

Smartcite writes one JSON file per site:

```json
{ "version": 1, "pages": [
  { "url": "/books/000001-the-lost-house/", "cluster": "group-7", "contentType": "book",
    "fields": { "title": "The Lost House", "author": "Barry Hills" } } ] }
```

Only `url` and `cluster` are required. `contentType`, `fields`, `relationships` and `repeatedItems` are scored when
present. The full format is in `examples/smartcite-output.schema.json`.

Upload the file with **Score**, or run:

```bash
node src/cli.mjs evaluate --truth answer-key.json --actual output.json --out report
```

The report shows how many pages were found, how well pages were grouped, and how many field values, relationships and
listing records were right.

## Put a site into a real WordPress

SiteForge can run a real WordPress on your computer and fill it with a generated site's content. You don't need PHP,
MySQL or Docker: WordPress Playground runs WordPress inside Node.js.

1. In **Saved test sets**, open a set and press **Start WordPress**. The first start downloads WordPress and the free
   Elementor plugin and takes about a minute. Later starts take 15 to 20 seconds.
2. Choose how pages are built: **WordPress blocks** (the theme's own layout) or **Elementor** (the real Elementor page
   builder).
3. Press **Push** next to a site.
4. Open **/wp-admin** (http://127.0.0.1:9400/wp-admin/, user `admin`, password `password`). The menu shows the site's
   content types, such as **Books**, **Authors** and **Events**, each with its fields as columns.

What the push does:

- Each SiteForge content type becomes a WordPress content type (custom post type) at the same address, such as
  `/books/` and `/books/000001-the-lost-house/`. If the WordPress site already has a matching type, it is reused.
- Fields are saved as custom fields and shown on the page. Images go into the media library. Topics become tags in
  a **Topics** list.
- The active WordPress theme (Twenty Twenty-Five by default) decides how everything looks.
- Pushing again updates the same posts. **Content types in this WordPress** shows what the site already has.
- Each push writes a WordPress answer key with WordPress's real addresses. Download it next to the push result and
  score Smartcite's crawl of the WordPress site against it.

The same works on any other WordPress: install the plugin in `wordpress/siteforge-importer/`, copy the token from
**Settings → SiteForge Importer**, and run
`node src/cli.mjs wordpress push <site folder> --url <wordpress address> --token <token>` (add `--builder elementor` for
Elementor). The local WordPress keeps its files and database in `.wordpress/` (about 260 MB). Delete `.wordpress/site/`
to start again with an empty WordPress.

### WordPress or Drupal theme export

The **WP** and **Drupal** buttons download a package that makes WordPress or Drupal serve the generated pages exactly
as SiteForge made them, with the CMS's own markup around them.

- **WordPress:** upload the WP theme under Appearance → Themes → Add New and activate it. Big themes are too large to
  upload, so unzip them into `wp-content/themes/` instead. Pages import in batches each time you open an admin page,
  or all at once with `php wp-content/themes/<theme>/siteforge-import.php`.
- **Drupal:** unzip the package into the site's `web/` folder and run `drush en siteforge_content -y`. Big sites keep
  importing on admin page loads and cron, or all at once with `drush php:eval "siteforge_content_import_all();"`.

## Command line

```bash
node src/cli.mjs generate examples/library.yaml --out outputs/library   # build one site from a settings file
node src/cli.mjs serve outputs/library --port 4310                     # preview it
node src/cli.mjs evaluate --truth ... --actual ... --out ...           # score a tool's output
npm run wordpress                                                      # start the local WordPress
node src/cli.mjs wordpress push outputs/library --builder elementor     # push a site into it
npm run benchmark:baseline -- outputs/library                          # score SiteForge's own simple crawler
```

## Folders

| Folder | What it holds |
| --- | --- |
| `app/` | The web app you use at http://127.0.0.1:4400, and its API. |
| `src/site/` | Plans each fake site: settings, records and pages. `generator.mjs` writes the finished site. |
| `src/render/` | Turns pages into HTML: layouts, WordPress and Drupal markup and the CSS. `browser/` holds the scripts that run inside the generated pages. |
| `src/noise/` | Adds the problems on purpose: messy markup, crawler traps and failing server responses. |
| `src/answers/` | Builds the answer key and scores a tool's output against it. |
| `src/cms/` | Packs a site as a WordPress theme or a Drupal module. |
| `src/wordpress/` | Runs the local WordPress, reads what content types a WordPress site has, and pushes a site's content into it. |
| `wordpress/siteforge-importer/` | The WordPress plugin that creates the content types, posts, fields and images, and writes the WordPress answer key. |
| `src/preview/` | The local server that shows a generated site. |
| `src/crawl/` | SiteForge's own simple crawlers, used for the baseline benchmark and the app's health check. |
| `src/fixture-lab/` | The app's back end: jobs, saved test sets, downloads and request checks. |
| `src/cli.mjs` | The command-line tool. |
| `scripts/` | Starts the app and its background workers. `checks/` holds the browser tests and `tools/` the benchmarks and audits. |
| `test/` and `features/` | Unit tests and behaviour tests. |
| `config/` | Settings for the behaviour and mutation tests. |
| `docker/` | An optional Docker setup that serves a finished test set. |
| `examples/` | Example settings files and the Smartcite output format. |

## Tests

```bash
npm run typecheck       # TypeScript
npm test                # unit tests
npm run test:bdd        # behaviour tests, written in Gherkin
npm run test:mutation   # mutation tests with Stryker (slow)
npm run test:matrix     # every site type with every technology and CMS (about 8 minutes)
```

`npm run test:matrix` builds a small site for each of the 10 site types with HTML, React, Angular and mixed
technology, each with no CMS, WordPress and Drupal markup (120 combinations). For each one it checks the answer key,
opens pages in a browser to find every field where the answer key says it is, requests every link and image, and
scores a perfect answer. `--quick` runs only HTML, React and Angular without CMS markup. The last full run
(2026-11-04) passed all 120.

The browser checks in `scripts/checks/` need the app running. Set `PAGEPILOT_URL=http://127.0.0.1:4400` first
(PowerShell: `$env:PAGEPILOT_URL="http://127.0.0.1:4400"`).

## Known limits

- Windows support has been checked by reading the code and on Linux, not yet on a Windows computer.
- HTTPS previews need `openssl` installed.
- No real Smartcite output has been scored yet.
- WordPress archive pages follow WordPress's defaults (newest first). A theme that changes them is not reflected in the
  WordPress answer key.
