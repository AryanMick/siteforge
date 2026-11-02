# Test Plan

## Purpose

SiteForge creates controlled, fictional source websites and private answer keys for testing Smartcite. It does not replace Smartcite, crawl live sites to discover the answers, or migrate content to WordPress.

The source model defines every page, content type, field, value, optional-field state, relationship and expected cluster before HTML is rendered. Noise creates a controlled public observation of that model. Smartcite receives the public site only; the fixture owner keeps the answer key.

**What you get for each generated website (as of 2026-10-30):**
- **The public website.** A preview address or ZIP for the tool under test.
- **A private answer key (JSON).** Keep it away from the tool.
- **Optionally, real CMS output.** A WordPress theme or a Drupal module and theme installs the same fictional pages into a throwaway CMS, so the CMS's own markup surrounds them. These packages are test fixtures, not a migration feature.

**Quick start (2026-10-30):**
1. Run `npm ci`, then `npm run siteforge`, and open the address it prints (usually http://127.0.0.1:4400).
2. On **Create**, pick a **Site type**, **Pages per site** and **Markup noise**, then choose **Generate test set**.
3. In **Saved test sets**, start a preview or download the website **ZIP**. Give only that to the tool under test.
4. Download the answer key (**JSON**) and keep it separate. It is what you score the tool's output against.
5. Optional: download a site's **WP** or **Drupal** package and install it on a throwaway CMS (steps under *WordPress and Drupal theme packages*). Then point the tool at the CMS instead; the same answer key applies.

The rest of this guide is reference material: settings, noise types, test evidence and known limits.

Sites can carry the markup fingerprints of 11 platforms besides plain HTML. *WordPress and Drupal theme packages* and *Nine more platform profiles* below describe them.

**A cluster means a shared logical data structure, not matching HTML or CSS.** Books with and without optional summaries or cover images still belong to the same book cluster. Identical schemas can share a cluster even when their content-type names differ. Home and listing pages are included in the inventory, not silently omitted.

## Requirements checklist (2026-11-02)

Each item from the consolidated requirements list, with where it stands. "Fresh" means checked on 2026-11-02. On that day the app generated a 3-site batch with every setting random and **Pages per site** set to 0. It produced an Angular museum site (188 pages), an Angular records site (12 pages) and a React nonprofit site (56 pages), with Shopify, HubSpot and Drupal markup and fully qualified or mixed links.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1–2 | A generator for testing Smartcite, with answers known in advance | Done | Source model and answer key are built before HTML; SiteForge has no crawler or migration feature of its own |
| 3–6 | Real sites as inspiration; content-heavy library/government sites; old and modern; several content types | Done | Ten site types (library, government, municipality, museum, records, ...); legacy, conventional and modern looks; 4–5 content types per site (fresh run: object, creator, exhibition, resource) |
| 7–8 | Settings-driven tool: site type, technology, look, page count, noise | Done | **Create** form; API and CLI take the same settings |
| 9 | Plain HTML, React and Angular | Done | Fresh run produced Angular and React sites; browser checks render them |
| 10 | Batches with a chosen number of sites | Done | 1–500 sites per set |
| 11 | Up to 100,000 pages per site | Done | One 100,000-page site passed a full audit on October 9 (generator 1.2.0); on 2026-11-02 a fresh 100,000-page site was installed into real WordPress and Drupal and passed a 551-page sampled check |
| 12–13 | Random on each setting, plus one Randomize button | Done | Every selector has *Random*; **Randomize settings** fills them all |
| 14 | Page count 0 means random | Done (fixed 2026-11-02) | The API already treated 0 as random (5–200 pages); the form now accepts 0 too and says so. The *Random page count* checkbox allows larger random sizes (up to 100,000) |
| 15–17 | Realistic HTML problems and a noise control | Done | 37 markup noise types (eight added 2026-11-02, generator 1.9.0), real-world date and label pools, 3,120 catalog cases, 80 opt-in crawler traps in 7 groups (four added 2026-11-02), ten server response conditions; *Markup noise* from clean to high |
| 18 | Superficial differences do not change content type or cluster | Done | Clusters come from the data structure; tests compare clean and noisy keys |
| 19 | WordPress and Drupal-style markup | Done, beyond scope | Imitation markup on every site, plus optional real WordPress/Drupal installs (*WordPress and Drupal theme packages*) |
| 20 | Selectable page-builder markup | Done | Gutenberg, Elementor, Beaver Builder, Divi, WPBakery |
| 21–26 | JSON answer key from source data: clusters, fields, optional fields, kept apart from the site | Done | Fresh run: 8 schemas, 9 clusters per site, 5–89 optional fields marked absent; the answer key is never in the public ZIP |
| 27 | Keep the JSON format until comparison with Smartcite starts | Done; ready for the comparison | Answer-key format unchanged (additive versions only). Since 2026-11-02 the output format a tool must produce is written down (*Scoring a tool's output*), and the scorer has been run end to end with SiteForge's own offline crawlers. A real Smartcite result has not been scored yet |
| 28–30 | Domain-named folders with answer key, metadata, website folder and a redirecting index.html | Done | Fresh run: `site-001-museum.siteforge.test/{answer-key.json, metadata.json, website/, index.html}`; index.html redirects to `website/index.html` |
| 31 | Relative, fully qualified and mixed links, including assets | Done | Plus root-relative and document-base-relative modes |
| 32 | Next.js and TypeScript | Done | Next.js 16 app, typechecked |
| 33 | BDD with Gherkin and Cucumber JS | Done | 126 scenarios pass (2026-11-02), including four new listing-record scoring cases |
| 34 | Stryker mutation testing | Done | Four focused Stryker configs. New on 2026-11-02: `npm run test:mutation:scoring` covers listing-record scoring and killed 140 of 142 mutants (98.6%). The 2 survivors are equivalent: an error message on a path that cannot be reached, and a check the next condition already implies. The three older configs were re-run the same day with the same results as October 9: 85/86 (`src/engine/structure.ts`), 117/118 (`src/field-locations.mjs`) and 107/110 (`src/repeated-item-locations.mjs`) |
| 35 | A written plan to catch misunderstandings | Done | This README |
| — | Scale examples (10, 200, 500 sites) | Examples, not requirements | A 500-site batch ran historically |
| — | Reusable AI skills | Optional suggestion | Not built; the generator is deterministic code |
| — | Agile/Scrum breakdown | Done | *Scrum Delivery* section |
| — | Remove the preview protocol control | Done | Not on the main form |
| — | Docker | Not used | Not required |
| — | Hosts file and local domains | Excluded by later instruction | No hosts or DNS changes |
| — | Pay-period updates to Pat with a recurring reminder | Waiting on the schedule | Needs the pay-period dates; SiteForge sends no messages itself |

## Requirement Review (2026-10-09)

The combined pasted messages and attachments now cover the supplied meeting interval from 0:54 through 30:36 without identified internal gaps. The final attachment received October 9 fills 20:46-23:08. Transcript coverage is not proof that every requirement has been implemented or verified; the status table and outstanding work below distinguish those claims. Docker execution, permanent preview deployment, and actual Smartcite integration remain outside the current scope.

The domain-named handoff format requested at 12:19-13:41 is implemented: each new app-generated site has `answer-key.json`, `metadata.json`, a nested `website/` folder and a top-level `index.html` redirect. The main form no longer shows the preview protocol control, as requested at 14:14-14:28. The link dropdown supports root-relative, relative, fully qualified, mixed and document-base-relative links. The meeting also requested a generated hosts text file and local name routing. The later user instruction excludes hosts setup: the interface omits it, new jobs omit `hosts.txt`, and no system DNS or hosts-file changes are made. This is a user-excluded requirement, not a claim that the meeting never requested it.

On October 9 the user explicitly requested deletion of all old generated websites to recover disk space. Their generated payloads, including the historical scale fixtures, have now been removed. Dated test reports, summaries, screenshots and application source remain. Earlier statements about preserving existing fixtures describe those implementation passes, not their present availability. Historical scale results cannot be re-audited against the deleted payloads without explicitly generating new ones.

| Requirement | Current evidence and remaining boundary |
| --- | --- |
| Generate fictional content-heavy websites | Ten domain presets; source records are constructed before HTML, with no live crawl required. |
| Legacy and modern layouts, HTML/React/Angular | Implemented renderers and browser checks. React/Angular mount generated HTML through real runtimes; they do not emulate every framework component or routing pattern. |
| Repeatable variation and a noise dial | Seeded configuration, 29 bounded markup operators (including `shortcode-residue`, added 2026-10-30) and ten preview response conditions. Not every possible real-world failure is represented. |
| Known logical clusters, including optional covers | Detail schemas preserve membership across optional absence. Generator 1.1.0 also separates listing clusters by their declared repeated-item schemas. |
| Private JSON answers | Page inventory, values, field states, relations, source values and observed noise are exported separately from public files. Version 1.2.0 adds source-planned page-field locations; 1.3.0 adds repeated listing-item locations and explicit optional absence. |
| WordPress and Drupal output patterns | Representative static CMS markup, including Gutenberg, Elementor and Beaver Builder wrappers. Generator 1.6.0 adds detectable head, asset-path and body-class fingerprints (for example `WordPress` / `Drupal 11` generator tags, `/wp-includes/`, `/wp-content/` and `/sites/default/files/` stylesheets). SiteForge itself serves imitation CMS markup. Since 2026-10-30, any site can also be exported as a WordPress theme or a Drupal module and theme, so a real CMS install serves it with genuine CMS output (see *WordPress and Drupal theme packages*). |
| One website with 100,000 pages | October 9 generator 1.2.0 created a fresh HTML site. All answer records, 100,012 public files and 100,015 evaluator files/ZIP entries passed integrity checks. This is one measured profile, not 100,000 independent browser inspections or every framework at scale. |
| Many sites and local handoff | Historical 500-site batch evidence; new domain-named evaluator folders and a batch ZIP. No system DNS or hosts-file changes. |
| BDD and mutation testing | 126 executable Cucumber scenarios (2026-11-02). On 2026-11-02 a new Stryker run on listing-record scoring killed 140/142 mutants (the 2 survivors are equivalent), and the three older runs were repeated with the same scores as on October 9. Separate October 9 Stryker runs caught 85/86 mutations in `src/engine/structure.ts`, 117/118 in `src/field-locations.mjs` and 107/110 in `src/repeated-item-locations.mjs`. These are focused module checks, not whole-application mutation coverage. |
| Simple usable interface | The page opens with a one-sentence purpose and a three-step *Choose → Generate → Test* guide. The main settings come first, each with a hint, and everything else sits in collapsible groups. Saved test sets are a separate, searchable view. Each set offers a private full-package download plus per-site public ZIP, private JSON, WordPress theme and Drupal package downloads; a one-line legend and an install guide explain them. Answer inspection is paginated. Deletion asks for confirmation and also stops that set's running previews. **Disk space (2026-10-30):** *Estimated pages* shows an estimate: about 92 KB per page for realistic page source and 27 KB for clean, plus about 1 MB (realistic) or 0.45 MB (clean) of assets per site. After generation, each set records its real size: website files and answer keys in `job.diskBytes`, evaluator copies in `job.handoffBytes`. The set header and the saved-set list show it. Evaluator copies are shared clones on macOS APFS but full copies on ext4/NTFS, which can double the space used. |
| A shared plan and honest results | This document is the consolidated plan. The 74-case acceptance table below is a backlog, not 74 completed acceptance runs. Smartcite accuracy remains unevaluated. |

Generator 1.1.0 selects repeated listing fields from the declared source schema before rendering, including required/optional status and types. Book and author listings with different item structures receive different expected clusters; equivalent article/feature item structures share one. Missing optional item values do not change membership. The private definition is `schemaDefinitions[page.expectedCluster].repeatedItemSchema`. Existing 1.0.0 files are preserved and use the legacy validator; their coarse listing clusters are not retroactively corrected. Replaying a saved configuration with newer code can therefore change public bytes and answer keys.

Generator 1.2.0 adds `fieldLocationVersion: 1` and `pages[].fieldLocations`. Locations are planned from source structure before HTML is created, then adjusted using the actual noise plan. `textContent` reads an exact value element; `afterLabel` reads a paragraph container after removing its declared label plus `: `; `urlPath` resolves an image source against `document.baseURI` and returns its pathname. Absent fields have no selector. React/Angular fields are available after client rendering. These locations cover `page.fields`, not `repeatedItems[*].fields`. Source text normalizes CR/CRLF to LF and replaces NUL or lone surrogates with U+FFFD before canonical values are recorded, preventing browser text normalization from silently contradicting the answer. Other Unicode spelling and whitespace remain unchanged. Old 1.0/1.1 keys remain readable without invented retroactive selectors.

Generator 1.2.1 corrects JavaScript-only link noise for page-relative, fully qualified and mixed URLs. A recorded event now changes a same-site link; the click destination remains local when the preview origin is rebased. Cross-origin, credential-bearing and double-leading-slash destinations are excluded. Existing generated websites are not rewritten. The answer-key shape and field-location contract remain unchanged.

Generator 1.3.0 adds `repeatedItemLocationVersion: 1` and `pages[].repeatedItemLocations`, an ordered array matching `repeatedItems` by `pageId` and `url`. Each entry has `fieldLocations` for every declared item field. Title selectors read exact text; scalar selectors use `afterStrongLabel`: require the leading `<strong>` text to equal the declared label, then read the following text after removing exactly one separator space. Keep all remaining value whitespace. Optional fields absent at source have no selector. Table/list positions are planned before rendering and independently validated against the source structure. Link-only listings do not invent item locations. A listing value can legitimately differ from a noisy detail-page value because they are separate rendered occurrences; the listing retains its original source value. Existing 1.0-1.2 keys remain readable without invented new locations, and public HTML is unchanged by this additive answer contract. The answer inspector displays these locations separately from values; new keys are not applied retroactively to old test sets.

Generator 1.3.1 adds opt-in **Document base relative** links (`site.linkMode: "base-relative"`). Generated pages declare `<base href="/">`; links and assets use `./` paths that resolve from that base, not the nested page URL. Canonical source links, field values, optional states and clusters stay unchanged. Skip links remain on the same page, and JavaScript-only link noise uses the first declared base with the standard invalid-base fallback. Existing random choice pools are unchanged, so this mode must be selected explicitly. It adds a navigation case, not a 29th markup operator. This follows the [HTML document-base rules](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-urls) and [Scrapy's base-aware URL joining](https://docs.scrapy.org/en/master/topics/request-response.html#scrapy.http.TextResponse.urljoin). Tests compare resolved edges against known source targets; because the sitemap also lists the pages, successful page discovery alone does not prove base handling.

The October 9 dependency audit initially reported seven advisories (four high, three moderate). Pinned compatible updates to Next 16.3.8 and Crawlee 3.18.2, plus patched transitive packages in the lockfile, produced zero reported npm advisories and passed the production build and 36 retained-crawler smoke tests in an isolated local runtime. This is an advisory snapshot, not a security certification. Evidence is under `outputs/refinement-20261009/`; full integrated verification is recorded separately when complete.

Generator 1.4.0 corrects CMS structure without changing the private answer schema: CMS articles now sit inside `main`, with the source heading outside the builder wrappers. WordPress type classes reflect the content type; Drupal no longer mislabels the entire page as one body field or invents a history-node ID. Elementor uses a representative HTML widget, deterministic markup-only IDs and a deliberately retained legacy widget container. These IDs are not database identities or answer-key fields. This is not an installed CMS or a complete emulation of its versions and plugins.

The same release fixes phantom wrapper events. Nested layout tables, obsolete markup and deep wrapper trees are eligible only when source fields will actually render a scalar field list. Rich listings, title/image-only records and records whose last scalar field was removed do not falsely claim those mutations. Eligibility is decided from the source before rendering; DOM inspection is an independent test, not how the answers are derived. Historical websites and answer keys are preserved. Replaying their settings with 1.4.0 may change CMS HTML and previously inaccurate noise-event records.

Generator 1.5.0 adds a third selectable WordPress builder pattern: Beaver Builder-style rows, column groups, columns and an HTML module. Matching `data-node` and `fl-node-*` tokens are deterministic from source seed/page identity and are not database IDs. New random builder choices include this profile; that expands the choice pool, so recreating an older random request can select a different builder. Saved resolved plans and artifacts are not rewritten. Clean-source tests require explicit closing div tags, so browser repair cannot conceal a broken baseline fixture.

Generator 1.6.0 (October 19) adds CMS fingerprints outside `main`, where a migration tool's CMS detection usually looks. WordPress pages declare a `WordPress 6.6.2` generator tag and `wp-block-library-css` and theme stylesheets under `/wp-includes/` and `/wp-content/`. They also get WordPress-style body classes (`home`, `archive post-type-archive-<type>` or `wp-singular single single-<type> postid-<n>`, plus `wp-theme-siteforge`). Elementor adds its generator tag, `elementor-frontend-css` and `elementor-default` body classes. Beaver Builder adds a `/wp-content/uploads/bb-plugin/` layout bundle and `fl-builder` body classes. Drupal pages declare `Drupal 10` Generator/MobileOptimized/HandheldFriendly tags and a `/sites/default/files/css/` aggregate. They get `path-frontpage`, `path-<type>` or `path-node page-node-type-<type>` body classes and a `drupal-settings-json` script after the footer. Each referenced stylesheet is written into the public site as a small placeholder file, so fingerprints do not create broken links. The links follow the selected link mode, including `?ver=` queries. Post IDs are seeded markup tokens, not database identities. Answer keys, clusters, field locations and `main` structure are unchanged. Drupal still avoids an invented `data-history-node-id` or whole-page body field. Saved older sites are not rewritten; replaying an old CMS configuration with 1.6.0 produces different public bytes.

### Generator 1.9.0 (2026-11-02): eight more markup noise types and real-world date and label variants

SiteForge now has **37 markup noise types** (up from 29) and **117 noise types in total**, counting the 80 opt-in crawler traps. The *Baseline* scenario uses all 37 markup types. The eight new types change markup only. A browser shows the same field text, and canonical values, links, field locations and repeated-item locations stay the same. Each new type is recorded in `noiseEvents` like any other noise. No noise type id ever appears in public HTML.

| Noise type | What the public HTML shows | Where real sites get this markup |
| --- | --- | --- |
| `split-text-runs` | Field text broken into adjacent `<span>` pieces (`<span class="mso-run">Rog</span><span class="Apple-converted-space">ers</span>`); at severity 3 a value is split into three pieces | Text pasted from Word or Outlook, which wraps each piece in its own `mso-` span, and Apple Mail or WebKit editors, which add `Apple-converted-space` spans |
| `entity-encoded-text` | Punctuation written as numeric character references (`&#39;`, `&#45;`, `&#58;`), spaces as `&nbsp;`; digits from severity 2 and some letters as hex references (`&#x65;`) from severity 3 | Old CMS and newsletter encoders, such as early FrontPage and Dreamweaver output or PHP `htmlentities` used twice |
| `uppercase-legacy-tags` | `<DIV>`, `<TD>`, `<DT>`… in `main`; unquoted `class=x` from severity 2; upper-case attribute names (`CLASS=`, `WIDTH=`) at severity 3 (static HTML sites only) | Hand-written HTML from the 1990s, and HTML exported by FrontPage or Netscape Composer |
| `microdata-attributes` | `itemscope`, `itemtype="https://schema.org/CreativeWork"` and `itemprop` on the field list's cells; `<meta itemprop="inLanguage">` at severity 3 | schema.org microdata added by SEO plugins such as Yoast and Schema Pro, and by e-commerce templates |
| `inline-svg-icons` | An `aria-hidden` inline `<svg>` at the start of each field label (`dt`, `th`, `strong`, or the paragraph) | Icon sets such as Font Awesome (SVG + JS) and Material Symbols, or theme icon helpers that place an icon before each "Author", "Date" or "Location" label |
| `hidden-reader-copy` | Visually hidden text: "You are viewing: *title*" (`visually-hidden sr-only`), "(opens in a new window)" (`screen-reader-text`) from severity 2, and an `aria-live` status from severity 3 | WordPress core's `screen-reader-text` class, and the `sr-only` / `visually-hidden` helpers in Bootstrap |
| `analytics-beacon` | One or two 1×1 `<img class="tracking-pixel">` elements, moved off-screen or `hidden`, pointing to a local asset with a beacon query | Tracking pixels from Meta (Facebook Pixel `<noscript><img>`), Google Analytics or Universal Analytics `__utm.gif`, and email-campaign open trackers. SiteForge links only to local assets, never to a real tracker |
| `spacer-elements` | Empty `<p>&nbsp;</p>` and `<p></p>`; stacked `<br>` and a clearing `div` from severity 2; a `<table class="spacer" width="100%" height="10">` at severity 3 | Dreamweaver and early GoLive spacer tables (`spacer.gif`), and the empty paragraphs that TinyMCE and CKEditor leave when an editor presses Enter repeatedly |

`hidden-reader-copy`, `analytics-beacon` and `spacer-elements` add content outside the record, so their events record `preservesSemantics: false`. The other five record `true`. The four types that rewrite the field list only apply to pages that have a server-rendered field list. `uppercase-legacy-tags` applies only to the `html` framework.

#### Date and label variants based on real sites

Before this version, `date-format` always showed one alternative format ("March 5, 2024"), and `label-variation` always appended " details" to the label. Each one now picks from a pool of formats or labels seen on real sites. The pick is seeded by the site seed and page ID, so the same settings give the same pages again.

Date formats (shown here for canonical `2024-03-05`):

| Pool id | Shown | Typical source |
| --- | --- | --- |
| `us-long` | March 5, 2024 | US news and library catalogues |
| `us-numeric` | 03/05/2024 | US government forms, Excel exports |
| `day-month-year` | 5 March 2024 | UK, Australian and Indian sites |
| `abbreviated-month` | Mar. 5, 2024 | Abbreviated news datelines (May has no full stop) |
| `dotted-european` | 5.3.2024 | German, Czech and Finnish sites |
| `weekday-long` | Tuesday, March 5, 2024 | Blog post headers, event pages |
| `month-year` | March 2024 | Report and journal issue dates (the day is lost) |
| `iso-datetime` | 2024-03-05T00:00:00Z | Feeds, APIs and `<time datetime>` values shown as visible text |

The plain `2024-03-05` form is deliberately left out of the pool. It is the canonical rendering, so choosing it would make the defect invisible.

Field labels are chosen to match the real field:

| Field | Labels |
| --- | --- |
| `author` | Author: · By · Written by · Author(s) |
| `publicationDate`, `recordDate` | Published · Pub. date · Date issued · Released |
| `releaseDate` | Released · Release date: · Published · Date released |
| `isbn` | ISBN-13 · ISBN · International Standard Book Number |
| `startDate` / `endDate` | Starts · Start date: · When · Date / Ends · End date: · Until · Closes |
| `meetingDate` | Meeting date: · Date of meeting · When · Held on |
| `deadline` | Closing date · Apply by · Deadline: · Due date |
| `effectiveDate` | Effective · Effective from · In effect from · Date effective |
| `location`, `serviceArea` | Venue · Where · Location: · Area served |
| `address` | Address: · Find us · Street address · Visit us |
| `openingHours` | Hours · Opening times · Hours of operation · Open |
| `summary`, `abstract`, `overview`, `description` | Summary: · Overview · Abstract · About |
| any other field | *Label* details · *Label*: · *Label* information |

The paragraphs layout already prints `Label:`, so on those pages a pool label drops its own trailing colon. A label identical to the default (for example `Author` on a paragraphs page) is skipped, so the defect is always visible.

The answer-key contract is unchanged. `canonicalValues` holds the ISO date and the original label. The event records only `field`. `fields` and `fieldLabels` hold the variant that is shown. `validateAnswerKey` works out the expected variant again from the seed and page ID (`dateFormatVariant` / `fieldLabelVariant` in `src/noise.mjs`). Any other value, including a different entry from the same pool, fails generation. The evaluator's opt-in `date` normalizer (`dateFields`) reads ISO, ISO date-time, "March 5, 2024", "Mar. 5, 2024", "5 March 2024" and "Tuesday, March 5, 2024" (a wrong weekday is rejected), added 2026-11-02 with tests. It deliberately does not guess numeric forms (03/05/2024, 5.3.2024, which differ between the US and Europe) or month-only "March 2024", because those lose or confuse the day; a tool must turn them into the canonical date itself, or the comparison uses a custom `fieldNormalizers` function.

**Compatibility:** with the same seed and settings, 1.9.0 can show a different date format or label than 1.8.0 did. Saved sites are not changed. Pages without `date-format` or `label-variation` noise are unchanged apart from the version number, unless they select one of the eight new markup types.

#### Checks (2026-11-02, generator 1.9.0)

- `npm test`: 674 tests passed, 0 failed, 0 skipped. This includes:
  - the new-operator suite in `test/adversarial-html.test.mjs` (31 tests)
  - a test that each date format renders exactly for 2024-03-05 and none equals the ISO form
  - a 40-seed sweep in which every date format and every `author`, `publicationDate` and `isbn` label was generated, found in rendered HTML and accepted by `validateAnswerKey`
  - a tamper test in which swapping in a different pool entry is rejected
- `npm run test:bdd`: 126 scenarios and 752 steps passed.
- `npx tsc --noEmit -p .`: no errors.
- Not run for 1.9.0: browser checks, CMS-installed comparisons, scale runs, Stryker, and any Smartcite accuracy measurement.

#### Real-world case profiles: 1,680 more catalog cases

The case catalog now holds **3,120 cases**: the original 1,440 (`case-0001` to `case-1440`,
6 profiles, unchanged IDs, still the `regression-1440` suite) plus **1,680 real-world cases**
(`case-1441` to `case-3120`). The new block uses the same matrix, 10 domains x 3 frameworks
x 4 field layouts x 2 protocols, with 7 profiles, so each profile has 240 cases. Each profile copies a
failure pattern that real crawlers and migration tools meet. Every profile is built only from
existing noise types, crawler traps, CMS profiles, link modes, source clutter and transport
profiles. Within each 7-case block the profiles run in table order (for example, `case-1441` is
`word-paste` and `case-1447` is `aspnet-webforms`).

| Profile | Label | First case | Real-world source | Obstacles and settings |
|---|---|---|---|---|
| `word-paste` | Pasted from Word | case-1441 (first of 240) | Copy pasted from Microsoft Word or Outlook into a WYSIWYG editor, as on many university, council and charity sites: MsoNormal span runs, &nbsp; spacer paragraphs, character entities, font colours and windows-1252 bytes behind a conflicting charset. | `split-text-runs`, `entity-encoded-text`, `spacer-elements`, `inline-style`, `obsolete-markup`, `legacy-color-attribute`, `class-churn`, `windows-1252-documents`, `charset-conflict`; transport: none |
| `legacy-dreamweaver` | Dreamweaver-era table site | case-1442 (first of 240) | Hand-built 2000s Dreamweaver/FrontPage sites on IIS: upper-case tags, nested layout tables, spacer cells, bgcolor attributes, MM_swapImage rollover and document.write menus, image maps and no main landmark. | `uppercase-legacy-tags`, `nested-layout-table`, `spacer-elements`, `legacy-color-attribute`, `obsolete-markup`, `legacy-document`, `missing-main`, `image-missing-alt`, `image-map-navigation`, `dhtml-hover-menu`, `document-write-menu`, `ie-conditional-links`, `mixed-case-extensions`, `default-document-aliases`; transport: legacy-server |
| `seo-plugin-heavy` | Stacked WordPress SEO plugins | case-1443 (first of 240) | WordPress with Yoast SEO and Rank Math (or All in One SEO) active at once: schema.org microdata plus contradicting JSON-LD, two canonicals, extra titles, og:/twitter: URL conflicts, screen-reader text, tracking pixels and sitemap/robots quirks. | `microdata-attributes`, `structured-data-conflict`, `multiple-canonical`, `title-anomalies`, `social-url-conflicts`, `meta-robots-variants`, `hidden-reader-copy`, `analytics-beacon`, `rel-link-hints`, `feed-links`, `sitemap-traps`, `robots-txt-traps`, `shortcode-residue`; site: cmsProfile=wordpress, builderProfile=none; transport: none |
| `calendar-facets` | Event calendar and facet explosion | case-1444 (first of 240) | Drupal Views exposed filters and event-calendar modules (as on council, museum and university event listings): endless next-month/next-day calendars, year/month/day archives, faceted filters, sort parameters, tag-cloud search and session IDs. | `calendar-trap`, `day-calendar-trap`, `date-archive-trap`, `faceted-navigation`, `sort-order-params`, `pagination-query-variants`, `search-tag-cloud`, `session-id-urls`, `login-wall-links`; site: cmsProfile=drupal; transport: none |
| `analytics-heavy` | Tag-manager marketing site | case-1445 (first of 240) | HubSpot-style marketing sites run through Google Tag Manager: consent banners over the content, tracking pixels, utm_ parameters on internal links, inline SVG icon sprites, links that only exist in scripts, JSON or data-href, and lazy images. | `analytics-beacon`, `inline-svg-icons`, `cookie-consent-wall`, `tracking-params`, `hidden-reader-copy`, `js-string-links`, `json-blob-links`, `data-attribute-links`, `lazy-load-noscript`, `onclick-navigation`, `delayed-content`; site: cmsProfile=hubspot, sourceClutter=realistic; transport: none |
| `migration-redirects` | Half-finished platform migration | case-1446 (first of 240) | A site part-way through a replatform (for example .aspx to WordPress, or HTTP to HTTPS): redirect chains, canonical chains to the new host, meta-refresh and JavaScript stubs, mixed relative/absolute links, http/https and protocol-relative duplicates, default-document aliases and dated copies. | `canonical-chain`, `canonical-cross-host`, `meta-refresh-link`, `js-redirect-page`, `cross-scheme-links`, `protocol-relative-links`, `duplicate-url-aliases`, `default-document-aliases`, `near-duplicate-dated`, `tracking-params`, `link-variants`; site: linkMode=mixed; transport: redirects |
| `aspnet-webforms` | ASP.NET WebForms intranet | case-1447 (first of 240) | ASP.NET WebForms sites on IIS (common for public-sector portals): __doPostBack links, drop-down jump menus, GET search forms, cookieless session IDs in the path, Default.aspx aliases, mixed-case .ASPX extensions and window.open pop-ups. | `postback-link`, `select-navigation`, `form-get-navigation`, `session-id-urls`, `default-document-aliases`, `mixed-case-extensions`, `window-open-popup`, `javascript-only-link`, `deep-wrapper-tree`, `frame-missing-title`; site: linkMode=root-relative; transport: legacy-server |

Rules that apply to every profile: HTML-only types (`missing-main` and `uppercase-legacy-tags`) are left out
for React and Angular cases. `delayed-content` is left out for HTML cases. Noise uses probability 1 and severity 3,
with `maxPerPage` equal to the number of types, so every eligible type fires on every eligible page.

**How to run them**

- One case: send a `catalog-case` request with `caseId` set to any ID from `case-1441` to `case-3120`. Use the same
  fixed catalog settings as before, and set `previewProtocol` to the case's protocol. In code, use
  `buildCatalogSiteConfig('case-1441')`.
- To list cases in code, call `listCatalogCases({ set: 'real-world' })`, or `{ set: 'all' }` for all 3,120.
  With no `set`, `listCatalogCases()` still returns the 1,440 core cases, so the `regression-1440` suite,
  `sitePlan` indexes and existing callers are unchanged. A lookup by `id` searches every set.
- Tests: `node --test test/case-catalog.test.mjs`.
- Exports: `REAL_WORLD_PROFILES`, `ALL_CASE_PROFILES`, `CORE_CASE_COUNT` (1440), `TOTAL_CASE_COUNT` (3120).

**In the app:** the **Case catalog** page and `GET /api/fixtures/catalog` list all 3,120 cases and all 13 profiles (filter with `?set=core`, `?set=real-world` or `?set=all`, the default). **Generate 1,440 core websites** still builds only the core regression suite; real-world cases are generated one at a time with the per-case button. A full 1,680-site corpus has not been generated.

**Test results (2026-11-02, fresh)**

- `node --test test/case-catalog.test.mjs`: 7/7 passed, including 3 new tests:
  - The case IDs and counts are correct and the core IDs did not move.
  - Every listed type exists. Across each profile's 240 cases, every type the case's framework allows
    appears in `noiseEvents` from `applyDataNoise`. All 1,680 configurations are distinct, and the
    site settings and transport rules match the profile.
  - One HTML case per profile was generated with `generate()`, and every configured type appears in the
    private `answer-key.json` `noiseEvents`.
- One React case per profile was also generated by hand: every configured type appeared in its answer key.
- `test/fixture-lab.test.mjs`, `test/fixture-new-request.test.mjs` and `test/fixture-plan-snapshot.test.mjs`:
  14/14 passed. `test/fixture-lab-routes.test.ts`: 7/7 passed. Cucumber `fixture-lab.feature` and
  `catalog-request.feature`: 126/126 scenarios passed.
- `npx tsc --noEmit -p .`: passed.

### Working controls on generated websites (2026-11-02)

#### What was fake before
- Buttons in page bodies ("Place hold", "Add to list", "Add to planner", "Register", "Request a visit", "View textbooks", "Print", "Share", "Get directions", "Download PDF", filter chips, Grid/List, A–Z letters, "Was this page helpful?" Yes/No, ...) had no handler and did nothing.
- Header search, newsletter, filter and sort forms all submitted to `/` (the home page). Header calls to action such as "Renew items" or "My account" opened an unrelated section page.
- Cookie banner, mega menu, off-canvas menu, accessibility toolbar, back-to-top button and chat widget were `hidden` with nothing able to open them; the cookie buttons did nothing.
- Footer "Accessibility / Privacy / Terms" were links to `#ids` that did not exist; "Print version" opened `/?print=1` (the home page); social icons linked to `https://facebook.example/...`; mega-menu and footer link texts did not match their queries ("Newest first" → `?sort=title`).
- Vendor CSS/JS files were stand-ins: platform files said "stylesheet placeholder for this fictional test site" / "script placeholder (no-op)"; every clutter script was the same 185-byte file that only added a `js` class; plugin/core CSS was one dummy rule; favicons were 1×1 pixels; the SVG icon sprite was random scribbles; the annual-report PDF held one title line.

#### What is real now
- Every page loads `/assets/site-actions.js` (readable sources: `src/browser/site-actions.js`, `src/browser/site-pages.js`; built by `src/site-runtime.mjs`). It uses event delegation, so it also works on React/Angular client-rendered pages and inside the WordPress/Drupal packages. State is kept in the visitor's `localStorage` only; nothing is sent anywhere.
- Five noindex utility pages are written at the site root as `.html` files (served by the preview server and as static files by the WordPress/Drupal packages): `site-search.html`, `my-list.html`, `sign-in.html`, `request.html`, `subscribe.html`, plus `/assets/search-index.js`. They are not in the sitemap or the answer key, and **no page links to them in its HTML**: they are reached through forms and clicks, so a crawler's link graph is unchanged.
- How each control behaves:
  - Header search (and `/?s=term`, `?keys=term`): results page listing matching pages of that site (title, section, text), each linking to the page.
  - "Place hold", "Add to list", "Add to planner", "Add to research cart", "Follow…", "Join waitlist", "Save": toggles the item on **My list** (button shows "Hold placed ✓" etc.; click again to remove). My list shows groups, Remove and "Clear my list".
  - Request/booking/apply/register/donate/contact-style buttons and header CTAs ("Book a room", "Request info", "Get tickets", "Donate", ...): open the request form for that item; submitting (name + email, optional date or pledge amount, no payment) shows "Request received" with a reference `R-XXXXXX`; it is listed on My list.
  - "Sign in", "My account", "Patient portal", "Renew items", "Check request status", "Open e-edition": sign-in page; signing in shows the demonstration account (renew: "nothing to renew"; status: your requests); Sign out works.
  - Newsletter forms: validate the email and end on a "Thanks for subscribing" page.
  - Cookie banner: shown on a first visit; Accept all / Reject non-essential / Manage preferences → Save hide it and remember the choice; footer "Cookie settings" reopens the preferences.
  - Menu (added to the header) opens the off-canvas menu; submenu toggles and Close work; ▾ toggles open the mega-menu panels; Escape closes. A+/A-/High contrast/Readable font change the page and are remembered.
  - Print / Print version / Print this page call `window.print()`; `?print=1` shows a print view. Share and Copy link copy the URL; Facebook/Bluesky copy post text and link; Email opens a mailto dialog; Cite/Copy citation copy a citation; Copy page copies the text.
  - Add to calendar downloads an `.ics` file; Download PDF/agenda/guidelines/activity builds a PDF of the page; Download image downloads the page image; Get directions and Call the office show the address/phone from the page; Watch live and View textbooks show an honest dialog.
  - Listing controls filter, sort and switch view in place (pills, facets, keyword bar, A–Z letters, sort select, Grid/List, chips ×, Clear all), with "Showing N of M" and a no-results message. Mega-menu/footer links (`?sort=`, `?view=`, `?audience=`, `?page=2`, ...) now say what they do and the script applies them.
  - Footer Accessibility/Privacy/Terms/Follow us open short notices inside the footer; the annual-report link states its real size.
- Vendor and platform files now contain small working code named by the file (jQuery-compatible core, jQuery Migrate aliases, Drupal behaviours/once/settings/debounce/displace, WordPress hooks/i18n/a11y/url, form validation, lightbox, external-link marking, autocomplete, local analytics queue, ...) and real CSS for the components they style (WordPress blocks, Drupal core modules, plugins, platform wrappers, print). Favicons are 32×32 PNG/SVG; the icon sprite draws real icons; the annual report is a multi-section fictional PDF.
- Deliberate noise is unchanged: crawler traps, broken images, onclick/JS-only links and buttons keep their own inline behaviour. The hidden `rel="nofollow"` "Staff sign in" honeypot still points to the CMS login (`/wp-admin/`, `/user/login`, platform login): real once installed into WordPress/Drupal, 404 on the static preview.
- Answer keys are byte-identical to before for the five sampled profiles (field values, locations, clusters, URLs).
- The baseline crawler (`src/crawler.mjs`) no longer follows `rel="nofollow"` links.

#### Tests (fresh, 2026-11-02)
- `PLAYWRIGHT_BROWSERS_PATH=… node scripts/check-site-controls.mjs`: six sites (plain library HTML, WordPress/React university, Drupal/Angular museum with page-relative links, Wix healthcare with absolute links, Shopify news, municipality without source clutter). Checks every same-site link/asset/form action in every HTML file (110–240 URLs per site) and clicks every visible button in `<main>` on a listing and up to four detail pages (9–40 per site), asserting a visible effect, plus the consent, menu, accessibility, search, CTA, footer, newsletter, request, sign-in, print and back-to-top flows. All pass except links on the Drupal Views listing pages that were being added in parallel (`…/sort/title-asc.html` pages linking to non-existent `…/sort/` and `…/creator/` folders).
- `PAGEPILOT_URL=http://127.0.0.1:4400 node scripts/check-app-buttons.mjs`: 26 app controls (Create/Saved switch, technology/noise options, settings sections, Randomize settings, Generate test set, Answer keys/Coverage/Websites tabs, answer page selection, Preview/Open/Copy URL, ZIP/JSON/full package downloads, Inspect answers, saved-set search and rows, Repeat test set, Delete Cancel/confirm; catalog paging, Clear filters, single and "Generate all" (intercepted, not run), error Dismiss). All pass. Score upload and WordPress/Drupal download buttons were not exercised.
- `node --test test/*.test.mjs`: 678 of 679 passed in a parallel run; the one failure (`fixture-plan-snapshot`, 30 s timeout under load) passes when run alone. `npx tsc --noEmit -p .` passes.

### Drupal Views listings (cmsProfile `drupal`)

Sites that use the Drupal markup profile render every section listing as a Drupal Views page. The markup is copied from real Drupal sites and Drupal core templates. Every facet, sort, tab and pager link opens a real page that shows the right records.

**What was copied, and from where (checked 2026-11-02)**

- https://www.si.edu/exhibitions (Drupal). Copied:
  - the result summary ("Displaying 25 of 245 exhibitions");
  - the Current/Upcoming/Past tabs;
  - the facet blocks, with a count after each value;
  - the sort list, including Title (A-Z) and Title (Z-A);
  - the numbered pager with Next and Last;
  - cards with an image, title, description, date range and a "My Visit" heart toggle.
- https://www.usda.gov/about-usda/news/press-releases (Drupal). Its "Showing: 1 - 10 of 294 Results" confirms the start–end–total summary form.
- Drupal core templates, read from the official GitHub mirror (api.drupal.org and drupal.org returned bot challenges):
  - the pager: https://raw.githubusercontent.com/drupal/drupal/11.x/core/themes/stable9/templates/navigation/pager.html.twig. Copied `nav.pager[role=navigation][aria-labelledby]`, the visually hidden "Pagination" heading, `pager__items js-pager__items`, `pager__item--first/previous/next/last/ellipsis`, `is-active`, the title texts and `rel="prev"`/`rel="next"`;
  - https://raw.githubusercontent.com/drupal/drupal/11.x/core/themes/stable9/templates/views/views-view.html.twig (`js-view-dom-id-*`);
  - https://raw.githubusercontent.com/drupal/drupal/11.x/core/themes/stable9/templates/views/views-view-unformatted.html.twig (`views-row`);
  - https://raw.githubusercontent.com/drupal/drupal/11.x/core/themes/stable9/templates/views/views-view-fields.html.twig.
- The pretty-path facet URL format `<base>/<alias>/<value>` comes from https://backdropcms.org/project/facetapi_pretty_paths. Drupal's facets_pretty_paths module uses the same format, but its project page could not be read.
- Some markup is from memory and was not checked against a fetched source:
  - the Facets links-widget classes (`facets-widget-links`, `facet-item`, `facet-item__value`, `facet-item__count`, `data-drupal-facet-item-*`, `is-active`, `rel="nofollow"`, `js-facet-deactivate`);
  - the Better Exposed Filters sort links (`bef-links`, `bef-link--selected`, `sort_bef_combine`);
  - the `view view-<id> view-id-<id> view-display-id-page_N` classes from Classy/Olivero;
  - the primary tabs markup.

**How it works** (`src/drupal-views.mjs`; hooks in `src/renderers.mjs` and `src/generator.mjs`)

- **One View per content type.** It is built from the observed records in the answer key. Facet counts, filters and sorting all use the records' source values (`canonicalValues`).
- **Facets.** A View has at most two facets, each showing up to 10 values (the most frequent first). They are chosen in this order:
  1. the related record type (an entity-reference facet);
  2. a short text field with few distinct values;
  3. the year of the first date field.
- **Sorts.** Featured (model order), Title (A-Z), Title (Z-A), plus "<date field> (newest first)" when the type has dates.
- **Tabs.** Types with a start/meeting date get All, Current (only when there is also an end date), Upcoming and Past tabs. These are measured against a reference date: the median start date, shown in the summary as "Dates as of …".
- **The unfiltered listing.** `/<type>/` and `/<type>/page/N/` are unchanged answer-key pages. Their rows come from the page itself, so the answer key's links, repeated items and repeated-item locations stay exactly the same.
- **Repeated-item rows.** When a listing has repeated items, rows keep the `ul.repeated-records > li` or `table.repeated-records > tbody > tr > td` shape, with an `<a>` and `<p><strong>Label</strong> value</p>`. Drupal classes are added to those elements only.
- **Other rows.** These use Views unformatted markup (`views-row`, `views-field views-field-*`, `field-content`).
- **Variant pages.** Every other state is written as a real static `.html` file:

  | State | Path |
  |---|---|
  | Tab | `/<type>/<tab>.html` |
  | Facet value | `/<type>/<alias>/<value>.html` |
  | Sort | `…/sort/<key>.html` |
  | Later pages | `…/page/N.html` |

  Static files work on any static host:
  - the SiteForge preview server;
  - WordPress/Drupal installs made with `src/cms-theme.mjs`, which serve other public files by exact file path. They do not serve folder indexes and do not route query strings.
- **Combinations.** One facet value can be active at a time; choosing another value replaces it. Facets are shown on the All display only. Sorting and paging combine with every filter.
- **Size.** For example, a 120-page museum site gets 110 variant files and a 500-page one about 290.
- **"My Visit" toggle.** Museum-domain cards have this toggle. It is a button that saves to `localStorage` in that browser only. Its script is in the Drupal JS bundle, and the View CSS is in the Drupal CSS bundle.
- **Determinism.** Output is seeded, so the same configuration always produces the same files. Profiles other than Drupal are unchanged.

**What was not copied**

- **si.edu's per-value exclude (−) control.** It is a custom Smithsonian widget, not standard Facets behaviour, and it would double the number of variant pages.
- **Multi-facet combinations.** These would also add many more variant pages.
- **Real Drupal query URLs** (`?f[0]=alias:value`, `?sort_by=…&sort_order=…`, zero-based `?page=N`). Static hosts ignore query strings, so these URLs would show the unfiltered page. Pretty paths are used instead.

**Answer key handling**

- Variant pages are not answer-key content pages and are not in the sitemap.
- Each one declares the unfiltered listing as `<link rel="canonical">`.
- Facet links carry `rel="nofollow"`, as the Facets module adds it.
- `private/drupal-views.json` (mode 0600) lists:
  - each View's facets (with counts), sorts and tabs;
  - each variant's `url`, `canonical`, `contentPage: false`, display, facet, sort, page, total and `recordPageIds`.
- The evaluator is unchanged. If a crawler returns a variant URL as a page, the evaluator counts it under `coverage.unexpectedUrls`, as it does for crawler-trap URL variants. Use `drupal-views.json` to treat those URLs as expected duplicates of the canonical listing.

**Test results (2026-11-02, fresh)**

- **`test/drupal-views.test.mjs`** (5 tests, all pass). They check:
  - the markup structure;
  - that summary and facet counts match the source records;
  - a crawl of every facet, sort, tab and pager link on the preview server, run once with root-relative links and once with relative links. It checks that every link returns 200 with exactly the expected records in the expected order, and that the links reach every listing and every variant and nothing else;
  - that no variant URL is in the answer key;
  - that repeated-item locations equal the model's and resolve to the right values in the HTML;
  - that profiles other than Drupal render no Views markup.
- **The requested command passed: 30 tests, 0 failures.**
  - Command: `node --test test/drupal-views.test.mjs test/platforms.test.mjs test/cms-markup.test.mjs test/repeated-item-locations*.test.mjs test/cms-theme.test.mjs`.
  - One earlier run had 5 failures. They did not recur on the next run, and the likely cause is another agent's edits that were in progress at the time.
- **`npx tsc --noEmit -p .` passes.**
- **These suites also pass: 47 tests.** core, renderer, crawler-traps, noise-event-fidelity, private-artifact-permissions, build-artifacts, listing-records, site-realism, link-modes, base-relative and fixture-new-request.
- **Generation is deterministic.** Two runs gave the same public files and the same `drupal-views.json`.
- **Playwright (Chromium) on `serve(dir, { port: 0, rebaseOrigin: true })`:** each click below changed the URL and the results.

  | Step | Result |
  |---|---|
  | Year 2023 facet | 4 of 4 |
  | Title (Z-A) | Sorted |
  | Clear filters | 27 |
  | Next | 11 - 20 of 27 |
  | Past tab | 12 |
  | My Visit | Toggled, and stayed toggled after a reload |

- **Not verified:** an actual WordPress or Drupal install of a generated Drupal site. Serving is confirmed only by reading the static-file handlers in `src/cms-theme.mjs`.

### WordPress and Drupal packages for big sites (up to 100,000 pages)

Changed 2026-11-02. WordPress and Drupal packages now support every site size SiteForge generates (up to 100,000
pages; `MAX_CMS_PAGES` in `src/cms-theme.mjs`). The single-site and batch download routes use that constant, and the
Saved test sets view shows the WP/Drupal buttons for sites up to 100,000 pages.

**Packaging (`src/cms-theme.mjs`).** The packager streams: the answer key's per-page facts are read from
`private/answer-pages/` (250 pages per file) and only the head of `answer-key.json` is parsed (that file is about
300 MB at 100,000 pages); older sites without those files fall back to parsing the whole answer key. Lines used once
are tracked in a fixed 16 MB Bloom filter instead of a set of every line, and no list of all pages is kept: the
second pass re-reads the answer pages. `content/site.json` no longer lists every path (Drupal no longer needs it).

**WordPress.** Activation imports a first batch (about 20 seconds); each admin page load by an administrator continues
for about 20 seconds with the notice "SiteForge is importing test pages: X of Y. Reload this page to continue...".
Pages are written in transactions of 50 together with the progress option (pages done, byte offset in
`pages.ndjson`), so an interrupted request leaves a whole slice or none. The path-to-post map is split into buckets of
about 200 paths (non-autoloaded `siteforge_paths_N` options), so a request loads one small bucket, not a map of the
whole site. The in-request object cache is emptied after each slice so memory stays flat. A previously imported
SiteForge site is removed first, in slices of 500 posts, directly in the database. On sites with more than 200
listing pages the footer "Browse" widget shows the latest comments instead of a list of every page.

Command-line importer (refuses web requests with 403; activates the theme if needed):

    php wp-content/themes/<siteforge-theme>/siteforge-import.php [path/to/wp-load.php]

Installing a big theme: the ZIP is larger than WordPress's upload limit (52 MB for 100,000 pages; the unzipped theme
is about 570 MB, mostly `content/pages.ndjson`). Unzip it into `wp-content/themes/` instead, then either activate it in
Appearance > Themes and reload admin pages until the notice disappears, or run the command-line importer.

**Drupal.** `hook_install()` installs the SiteForge theme first (so pages already imported render as the generated
site during the import) and imports a first batch (about 20 seconds). Progress (`siteforge_content.progress` =
[pages done, byte offset]) and the total are kept in Drupal state; each batch of 25 nodes is saved in one transaction
with its progress. The import continues:
- on admin page loads by users with "administer site configuration" (status message "SiteForge is importing test
  pages: X of Y. Reload to continue."),
- on cron (`hook_cron`, about 30 seconds per run),
- fully from the command line: `drush php:eval "siteforge_content_import_all();"`.
A lock prevents overlapping batches. A page that already exists (found by its path alias) is skipped, so an
interrupted batch never duplicates nodes. The front page is set as soon as it is imported; the main menu, site name,
front page and cache clear run once, when the last batch completes. The trailing-slash link processor now asks
Drupal's alias manager (before alias processing) instead of loading a state list of every alias. Uninstall removes all
nodes in slices of 50 with the entity cache emptied after each, plus all import state.

`scripts/check-cms-theme.mjs <site> <cms-url> --sample N [--seed S]` checks N random pages plus the home page and up
to max(20, N/10) random listing pages (the menu check still covers every answer-key URL), and reads big sites' answer
pages from `private/answer-pages/` instead of parsing the whole answer key.

#### Measured 2026-11-02 (100,000-page site, local WordPress 6.9.11 and Drupal 11.4.11 on SQLite, 2 CPUs)

Site: library domain, 100,000 pages (96,292 detail, 3,707 listing, home), `sourceClutter: 'none'`, seed 100100;
generated in 3 min 39 s (2.6 GB on disk). The machine was shared with other jobs (load average 3-6 on 2 CPUs), so
times are upper bounds.

| Step | WordPress | Drupal |
| --- | --- | --- |
| Packaging (streaming, one CMS at a time in parallel) | 6 min, ZIP 52 MB (unzipped 553 MB) | 6 min, ZIP 52 MB |
| Packaging peak RSS (100,000 / 1,000 / 30 pages) | 290 / 134 / 121 MB | 381* / 130 / 122 MB |
| Packaging with `node --max-old-space-size=64` | completes, peak RSS 190 MB, byte-identical pages.ndjson | (same code path) |
| First batch on activation / `drush en` | ~20 s, 3,047 pages | 27 s, 1,309 pages |
| Admin page loads (about 20 s each) | 4 loads: 4,365 / 5,463 / 6,413 pages, notice shown | 3 loads: 3,400 / 4,543 / 5,730, status message shown |
| Cron | (not used) | one `drush cron`: 33 s, to 7,164 pages |
| CLI import to completion under `php -d memory_limit=128M` | 785 s for the last 65,348 pages (about 83 pages/s), peak 40 MB | 2,749 s for 92,836 pages (about 34 pages/s), peak 64.5 MB |
| Result | 100,000 posts, 100,000 distinct paths, 32,043 comments, 500 path buckets | 100,000 nodes, 99,999 aliases (front has none), 32,042 comments |
| `check-cms-theme.mjs --sample 500` (500 random + home + 50 listing pages) | PASS 551 pages, 2,096 fields, 4,837 repeated fields, 1,877 assets (4 min) | PASS 551 pages, same fields, 1,098 assets (4.5 min) |
| Reset to a 30-page site | CLI importer removed the 100,000 posts and imported 30 pages in 24 s; check PASS | `drush pmu siteforge_content` removed the 100,000 nodes in 2,978 s (about 34 nodes/s; drush printed "terminated abnormally" at the very end, cause not found, but every node, alias and comment was gone and the 30-page install then passed) |

*The JavaScript heap stays bounded (the 64 MB-heap run proves it); the rest of the RSS is garbage-collector slack, which
grows when the machine has free memory.

The first WordPress CLI run was stopped at 34,652 pages (after 2,251 s, slowing to about 10 pages/s): WordPress's
unique-slug check scans the whole posts table on SQLite. The importer now skips that check (pages are found by path,
so slugs need not be unique). The fixed theme files were copied over the installed theme (same content hash) and the
import resumed after the stale lock expired, with no duplicate posts. During the Drupal run a page requested before it
was imported kept answering 404 after the import from Drupal's route cache; each batch and the final step now
invalidate the `route_match` and `4xx-response` cache tags (verified on the installed site by invalidating those tags,
not by re-running the 100,000-page import). Removing a 100,000-page Drupal site is the slowest step: use drush, not the
Extend page. The 100,000-page site, its ZIPs and the imported content were deleted
afterwards and both SQLite databases were vacuumed (Drupal 1.48 GB to 40 MB, WordPress 721 MB to 2 MB).

### Generator 1.8.0 (2026-11-02): four more crawler traps

Four opt-in traps from the Sitebulb crawler test site's list, each recorded in the answer key like the other 76:

| Trap | Group | What the page does | Answer-key details |
| --- | --- | --- | --- |
| `pushstate-infinite-scroll` | JavaScript-only links | On listing pages, scrolling to the end rewrites the address bar to `?page=2`, `?page=3`… with `history.pushState`. Those addresses serve the same listing | `pushStateUrls`, `servedAs`, `contentPagesAdded: 0`, `linkedInMarkup: false` |
| `title-anomalies` | Indexing signals | One or two extra `<title>` elements ("Untitled Document", "Home") after the real one | `extraTitles`; the true title is the first `<title>` and the page heading |
| `structured-data-conflict` | Indexing signals | A JSON-LD block whose `name` (and at higher severity `datePublished` and `url`) contradicts the visible fields | `declared` values; the true values are the page fields |
| `rtl-content-block` | Encoding & URL syntax | An Arabic or Hebrew notice with `dir="rtl"` (and `<bdi>` at higher severity), outside every field | `language`, `text`, `isField: false` |

Checked 2026-11-02: unit tests (639), the trap markup test (titles, JSON-LD, right-to-left text and the scroll addresses are exactly as recorded), and a real browser on the preview. The browser kept the real title as `document.title`, scrolling moved the address to `/books/?page=2`, which answered 200, and the right-to-left block rendered right-to-left. A 60-page site with all four traps also passed the full check installed in WordPress and Drupal. The CMS packages now keep extra `<title>` elements; only the page's own title is replaced by the CMS's. Adding traps changes what the *crawler traps* scenarios select, so replaying an older trap-scenario request with 1.8.0 can produce different pages; saved sites are unchanged. Default (non-trap) output is unchanged apart from the version number.

### Generator 1.7.0 (2026-10-30)

Generator 1.7.0 covers several changes:
- nine platform profiles (Joomla, Squarespace, Webflow, HubSpot, AEM, Sitecore, Wix, Shopify, Ghost)
- Divi and WPBakery builders
- per-platform header, footer and clutter URL shapes
- the `shortcode-residue` markup operator

The *Baseline* scenario uses every markup operator, so the new operator competes for each page's noise slots. Replaying a saved 1.6.0 configuration therefore changes some pages' `noiseEvents` and public bytes; in one measured 20-page site, 7 pages changed. Saved test sets and their answer keys are not rewritten. Their `generatorVersion` stays 1.6.0, which tells the two apart.

### Nine more platform profiles (2026-10-30)

Migration sources are not only WordPress and Drupal. The CMS markup setting now also offers Joomla, Squarespace, Webflow, HubSpot CMS, Adobe Experience Manager (AEM), Sitecore, Wix, Shopify and Ghost styles (`site.cmsProfile`). Each adds what that platform prints outside the content, based on the public markup shapes of each platform:

| Profile | Head and assets | Page and content markup | Robots and headers (realistic previews) |
| --- | --- | --- | --- |
| Joomla 5 | `Joomla! - Open Source Content Management` generator, Cassiopeia `/media/templates/site/...` CSS/JS with version hashes, `joomla-script-options` JSON with a CSRF token | `site com_content view-article itemid-N` body classes, `#system-message-container`, `com-content-article__body` with schema.org microdata | Joomla's default robots.txt; Apache/PHP |
| Squarespace 7.1 | `<!-- This is Squarespace. -->`, `Static.SQUARESPACE_CONTEXT`, versioned static assets, `/site.css?v=` | `<body id="collection-…">`, `sqs-seven-one` tweak classes, section → `sqs-layout` grid → `sqs-block-html` wrappers | Squarespace's robots.txt (author/tag/month/format query rules); `Server: Squarespace` |
| Webflow | `Webflow` generator, `<site-id>/css/<slug>.webflow.<hash>.css`, `w-mod-js` inline script | `data-wf-page` / `data-wf-site` on `<html>`, `w-container` and `w-richtext` wrappers, jQuery and `webflow.js` | Allow-all robots; Cloudflare headers |
| HubSpot CMS | `HubSpot` generator, `/hs-fs/hub/<portal>/hub_generated/...` and `/hs/hsstatic/...` assets, `hsVars` | `hs-content-id-N` body classes, drag-and-drop row/column wrappers and `hs_cos_wrapper` spans that contain block content (as HubSpot really nests it), analytics `_hsq` queue and script loader | HubSpot's robots.txt; `X-HS-Cache-Config`, `X-HS-Content-Id` |
| AEM | `/etc.clientlibs/…lc-<hash>-lc.min.css/js` client libraries, `template` meta | `data-cmp-data-layer-enabled` body, `adobeDataLayer.push` at body start, responsive grid → `aem-GridColumn` → `cmp-text` with a `data-cmp-data-layer` attribute | Dispatcher-style robots (`/bin/`, `/libs/`, `*.model.json`); `X-Dispatcher`, `X-Vhost` |
| Sitecore SXA | `/-/media/Base-Themes/…/pre-optimized-min.css?rev=` theme bundles | `default-device bodyclass`, `component rich-text` / `component-content` wrappers, `__RequestVerificationToken` hidden input | Sitecore robots (`/sitecore/`, `/-/speak/`); IIS/ASP.NET headers and an `SC_ANALYTICS_GLOBAL_COOKIE` cookie |
| Wix | `Wix.com Website Builder` generator, `X-Wix-*` meta tags, Thunderbolt bundles under `/_partials/wix-thunderbolt/` | `pageHtmlEmbeds` comments, `wixui-section` → columns → `wixui-rich-text` wrappers, `wix-viewer-model` JSON | Wix's robots.txt (AdsBot and PetalBot rules); `Server: Pepyaka`, `X-Wix-Request-Id` |
| Shopify (Dawn theme) | `Shopify.theme` / `Shopify.shop` script, checkout API token and digital-wallet meta tags, `/cdn/shop/t/3/assets/*.css?v=` | `gradient template-*` body classes, `shopify-section-template--…__main` → `page-width` → `rte` wrappers, `ShopifyAnalytics` meta | Shopify's robots.txt (cart, checkout, `sort_by` and `preview_theme_id` rules); `Powered-By: Shopify`, `X-ShopId` |
| Ghost 6 | `Ghost 6.3` generator, `/assets/built/screen.css?v=` and `/public/cards.min.*` | `post-template` / `home-template` classes, `gh-article` → `gh-content gh-canvas` wrappers, Portal script with Content API attributes | Ghost's robots.txt (`/ghost/`, `/email/`, `/r/`); `X-Powered-By: Express` |

- **Same contract as the other profiles.** Wrappers sit inside `main` after the page heading, `main` stays a direct child of `body`, every page keeps one `<h1>` and every referenced asset is a small local file. With the same seed the answer key is identical to the plain site (`test/platforms.test.mjs`).
- **Verified 2026-10-30.** Wix, Shopify and Ghost passed the same check, both on their own previews and installed into WordPress or Drupal (30 pages each). `npm run test:realistic-locations` now rotates through WordPress, Drupal, plain, Joomla, Squarespace, Wix, Shopify, Ghost, AEM and Sitecore (last run: 1,101 page fields and 898 repeated fields, 0 failures). The first six profiles passed the full browser location check on realistic-source previews (30 pages each; 90 page fields and 71 repeated fields each), and so did React, Angular, relative, base-relative, absolute and mixed link combinations. Mixed and absolute links are rewritten to the preview origin by design.
- **Random choices.** *Random* and *Mixed* CMS choices now include these nine profiles, with WordPress and Drupal twice as likely as each of the others. Recreating an older random request can therefore pick a different profile; saved plans and generated sites are unchanged.
- **Platform URL shapes in the page clutter.** Downloads, vendor CSS/JS bundles, component CSS and the hidden staff sign-in link use each platform's paths, such as Shopify's flat `/cdn/shop/t/3/assets/`, `/hubfs/…pdf` and `/_hcms/mem/login` for HubSpot, `/content/dam/…` and the Granite login for AEM, `/-/media/Project/…` and `/sitecore/login` for Sitecore, `/images/documents/…` and `/administrator/` for Joomla.
- **Leftover shortcodes (`shortcode-residue` markup noise).** This noise appends unrendered shortcodes to the end of `main`, as left behind when a builder or plugin is switched off: `[vc_row]…` on WPBakery sites, `[et_pb_section]…` on Divi sites, and `[caption]` / `[contact-form-7]` elsewhere. It is recorded in `noiseEvents` like other non-semantic noise, outside every field location, and is part of the *Baseline* scenario's markup operators.
- **More page builders.** WordPress sites can also use Divi or WPBakery markup (see *Page-builder markup*). `npm run test:cms-markup` covers both, and a Divi site exported as a WordPress theme passed the full check on real WordPress (40 pages, 119 page fields, 97 repeated fields).
- **Exports.** These sites can still be exported as WordPress or Drupal theme packages; the platform's head tags stay in the page next to the real CMS output.

### WordPress and Drupal theme packages (2026-10-30)

A migration tool has to cope with the markup a real CMS adds around content. Each generated site can therefore be installed into a real WordPress or Drupal, which then serves the same pages wrapped in its own output. This is a test-fixture feature, not a CMS product. It installs one fictional test site into a throwaway CMS and never migrates real content.

- **What you download.** In the app, every website row has **WP** and **Drupal** buttons, and a test set has **All WordPress themes** / **All Drupal packages** for every site at once. The CLI equivalent is `node src/cli.mjs cms-theme <generated-site> --cms wordpress|drupal --out site.zip`, and the API is `download?kind=wordpress|drupal`.
  - WordPress gets one theme folder.
  - Drupal gets `modules/custom/siteforge_content` and `themes/custom/siteforge_theme`.
- **What the CMS adds (its own noise).**
  - WordPress (6.9 and 7.1):
    - real `wp_head()` output: emoji styles, block-library CSS, global styles, oEmbed, REST and feed links, generator tag, canonical and shortlink
    - body classes, jQuery, `comment-reply` and footer speculation rules
    - seeded comment threads (about one detail page in three) with WordPress's own comment form and `?replytocom=` reply links
    - WordPress's own RSS feeds: `/feed/` lists the imported detail pages at their answer-key URLs, and `/comments/feed/` lists the seeded comments
    - a real navigation menu of the home and section pages, printed by `wp_nav_menu()` (`menu-item menu-item-type-post_type …` classes) before the content
    - a block-widget area (search and page list) after the content, and a real search results page
    - real redirects: shortlinks (`/?p=123`) and URLs without the trailing slash return 301 to the page
    - its own HTTP headers: `Link: <…/wp-json/>; rel="https://api.w.org/"`, a JSON alternate and a shortlink

    Content lives in real posts and pages, with one custom post type per content type. SiteForge's imitation core body classes are dropped so WordPress's own are not duplicated.
  - Drupal (10 and 11):
    - real `html.html.twig` placeholders, aggregated CSS/JS URLs, Generator/MobileOptimized/HandheldFriendly tags
    - core's "Skip to main content" link and its `#main-content` anchor, placed before the generated `<main>`
    - canonical and `/node/<id>` shortlink tags, the `dialog-off-canvas-main-canvas` wrapper and `drupal-settings-json`
    - real core blocks: a main menu of the home and section pages (`menu_link_content` links, `data-drupal-link-system-path`), a status-messages placeholder, breadcrumbs and "Powered by Drupal"
    - Drupal's comment module on detail content types: seeded threads (about one detail page in three), the anonymous comment form and `/comment/reply/...` links
    - its own HTTP headers: `X-Generator: Drupal 11`, `X-Drupal-Cache`, `X-Drupal-Dynamic-Cache`, canonical and shortlink `Link` headers, `X-Frame-Options`

    Content lives in real nodes with path aliases, one content type per content type. Installing or uninstalling the module clears Drupal's page and render caches and its compiled Twig templates, so an earlier test site's pages or templates are never served again. To replace a SiteForge site, uninstall *SiteForge test content*, then unzip the new package and enable it. The blocks a new theme copies from the previous default theme (page title, menus, tabs) are removed, so each page keeps exactly one `<h1>`. Links Drupal prints itself (canonical, breadcrumbs) keep the generated trailing slash.
- **What stays identical.**
  - Every answer-key URL. Generated links end in `/`; WordPress routes by stored path, and Drupal strips the trailing slash before alias lookup.
  - The generated `<main>`, byte-for-byte. WordPress writes it directly to the post table so content filters cannot rewrite quotes or links; Drupal uses a text format with no filters. The one change is the address in fully qualified links (see the next item).
  - **Fully qualified links (since 2026-10-31).** Links to the generation address point to the CMS address instead, exactly as the SiteForge preview rewrites them: `href`/`src` attributes and the React/Angular page data. Visible text, deliberate wrong-host links, `srcset` values and links inside `<noscript>` are left unchanged, as on the preview. The package stores a placeholder (`http://siteforge-origin.invalid`). WordPress replaces it with its own address when it imports the pages, as WordPress stores absolute URLs in posts. Drupal replaces it each time it serves a page. Install WordPress at the root of its address, not in a subfolder. A WordPress site that later moves to another address needs the theme activated again, as with any WordPress content holding absolute URLs. Before this change, React and Angular sites generated with fully qualified or mixed links did not render on a CMS install: their scripts pointed at the generation address.
  - Images and other files, at their original URLs.
  - The answer key needs no changes. Pages whose `<main>` was removed by noise, and React/Angular pages, keep their whole body as content.
  - SiteForge's imitation CMS head tags are dropped, because the real CMS prints its own. Other generated noise (plugin assets, mega menus, consent dialogs, tracking snippets) is kept.
- **Small packages.** Lines repeated across pages (header, footer, inline styles) are stored once in a shared table; lines that appear on only one page stay with that page. The CMS loads the shared table on every page view, so keeping it to shared lines matters: 149 KB instead of 4.9 MB for a 1,000-page site (a page view on WordPress then peaks at about 40 MB). A 1,000-page site of 70 MB becomes a 2 MB package. Packages support up to 100,000 pages (5,000 before 2026-11-02; see *WordPress and Drupal packages for big sites*). Content sits in three files: `content/site.json` (site name, front page, content types, page count), `content/lines.json` (the shared line table) and `content/pages.ndjson` (one page per line). The importers read pages one line at a time, so memory stays flat as sites grow. Building the package also streams: SiteForge reads the site twice, one page at a time (first to find shared lines and the content hash, then to write each page into the ZIP). Building the 1,000-page package then peaks at about 115 MB of memory, down from 620 MB when the whole site was held in memory, and fits in a 96 MB JavaScript heap. Before 2026-10-30 a single 20 MB data file was decoded at once; a 1,000-page site then exceeded PHP's common 128 MB `memory_limit`. Re-checked 2026-10-30 at `memory_limit=128M` on that 1,000-page site: the WordPress import completed in repeated one-second batches (peak 40–55 MB per batch), and the Drupal install took 10 seconds. Package files carry the download time, so PHP's opcode cache picks up a reinstalled theme or module; public ZIPs keep their fixed, repeatable timestamps.
- **Install.**
  - WordPress: Appearance → Themes → Add New → Upload Theme, then Activate. Any permalink setting works, because the theme serves every page at its generated URL. Activation imports the pages; very large sites finish over a few admin page loads. Activating another SiteForge theme replaces the previous test site's posts.
  - Drupal: unzip into the web root, then enable *SiteForge test content*. That imports the nodes, installs the theme and sets the front page. Uninstalling removes the nodes, content types and theme again.
- **A throwaway local CMS (macOS, no MySQL).** These are the steps used for the verification, with PHP 8.3 and Composer (`brew install php composer`):
  - **WordPress.**
    1. Unzip WordPress (wordpress.org/latest.zip) and the *SQLite Database Integration* plugin (wordpress.org/plugins/sqlite-database-integration) into `wp-content/plugins/`.
    2. Copy the plugin's `db.copy` to `wp-content/db.php`.
    3. Create `wp-config.php` from the sample. No database settings are needed.
    4. Run `php -S 127.0.0.1:8081 -t <wordpress> scripts/cms-router.php` and open `/wp-admin/install.php`.
  - **Drupal.**
    1. Run `composer create-project drupal/recommended-project drupal`, then `composer require drush/drush` in that folder.
    2. Run `vendor/bin/drush site:install minimal --db-url=sqlite://sites/default/files/.ht.sqlite -y`.
    3. Unzip the package into `web/`.
    4. From `web/`, run `php -S 127.0.0.1:8082 <siteforge>/scripts/cms-router.php`, then enable the module on the Extend page or with `drush en siteforge_content`.

  `scripts/cms-router.php` gives PHP's built-in server the usual front-controller behaviour. It is for local testing only.
- **Check an install.** Run `node scripts/check-cms-theme.mjs <generated-site> <cms-url>`. It checks status 200, `<main>` identical to the generated page (after the same address rewrite as the preview), the same `<h1>` count, every answer-key field and repeated-item location in Chromium (after client rendering), and every same-site file the page links to, whether root-relative, relative or fully qualified (before 2026-10-31 only root-relative links were checked). On real installs it also checks that the CMS's own menu renders and links only to answer-key URLs.
- **Verified 2026-10-30** against WordPress 6.9.11, WordPress 7.1.4 (the current release; upload, activate and the full check, with no PHP warnings), Drupal 11.4.11 and Drupal 10.6.20. On Drupal 10: install, the full check (80 pages, 255 page fields, 219 repeated fields) and a clean uninstall, with no PHP warnings. All ran on SQLite, served by PHP 8.3 with front-controller routing. The full user flow also passed in a real browser: a fresh WordPress set up through its web installer, then the theme uploaded and activated in wp-admin with default permalinks (Divi site, 40 pages, 119 page fields, 97 repeated fields), and the Drupal module enabled on the Extend page. Earlier runs covered:
  - a medium-noise museum site (60 pages) on both CMSs
  - a high-noise government site (80 pages: missing `<main>`, malformed nesting, duplicate IDs) on Drupal, with 255 page fields and 219 repeated fields
  - a React news site (80 pages) on WordPress, with 244 page fields and 225 repeated fields
  - a 1,000-page library site on both, with 3,916 page fields. The imports took 8 s (Drupal) and 13 s (WordPress).
  - after the switch to streamed page data (late 2026-10-30), the same 1,000-page site again passed the full check on both CMSs, this time installed with PHP's `memory_limit=128M`. A browser-driven WordPress activation (sign in, Appearance → Themes → Activate) on a server with a 30 s execution limit imported all 1,000 pages within the activation request, in 12.7 s (WordPress raises its own memory limit for admin pages, so the 128 MB proof is the command-line import above)
  - **random sweep (2026-10-31):** eight sites with every setting random (randomness 100: HTML, React and Angular; clean to high noise; relative, mixed and fully qualified links; Wix, Drupal, Shopify, HubSpot, Ghost, Squarespace and Webflow profiles; error and redirect response conditions; 25 pages each), installed into both CMSs. Before the address fix, the three React/Angular sites with fully qualified or mixed links failed: their apps never rendered. After it, all 16 installs passed, with 73–121 same-site files checked per install
  - **full matrix after that switch:** every source profile (plain HTML, WordPress, Drupal and the nine other platforms; 30 pages each) installed into both WordPress 6.9.11 and Drupal 11.4.11. All 24 combinations passed the full check
  - platform-flavoured sites (30 pages each), all passing: Squarespace, AEM, Joomla and HubSpot on Drupal; Sitecore and Webflow on WordPress (Webflow's `data-wf-*` `<html>` attributes carried over)

  All checks passed. The CMS installs are local test environments, not part of SiteForge. `npm test` covers lossless splitting, package contents and PHP syntax without a CMS.
- **Robust installs (independent review, 2026-10-30).**
  - **Streamed imports (second independent review, 2026-10-30).**
    - WordPress stores import progress (pages done and the position in `pages.ndjson`) in one option, so a request that dies mid-batch cannot skip or repeat a page.
    - A shorter file than expected (for example a truncated upload) ends the import instead of leaving it pending on every admin page load. Checked by cutting `pages.ndjson` to 9 MB: the import finished with the 466 complete pages and stopped retrying.
    - Unreadable lines are skipped.
    - The content hash covers the split page parts and a format version, so a newer SiteForge that splits pages differently triggers a re-import.
    - Drupal reads all page paths from `site.json` and sets its trailing-slash aliases before saving nodes. If `pages.ndjson` is missing, the install stops with a clear message.
  - **Re-imports and concurrency.** A WordPress theme replaced in place with a different site (same folder name) is detected by a content hash and re-imported. Imports take a lock, skip admin AJAX requests and rebuild the path map from post meta, so overlapping admin page loads cannot duplicate posts and an interrupted batch never leaves pages unreachable.
  - **Titles and generator tags.** Post and node titles are the page titles; the full `<title>` stays only in the page head. Only the imitation WordPress/Drupal head output is dropped (robots meta, feed links, inline global styles, generator tags). Other platforms' generator tags and page-builder output stay.
  - **Page attributes.** `<html>` attributes such as Webflow's `data-wf-*` and `data-ready` are carried over. Only the WordPress imitation's own body classes are removed.
  - **Drupal routes.** The generated layout applies only to a node's own page, so edit, revision and delete pages stay normal Drupal pages.
  - **Static files.** Both CMSs serve the full set of static file types with proper MIME types. Legacy `.htm` trap documents keep their declared windows-1252 or UTF-16 encoding. Every sitemap, feed and document that names the generation address (including `.xml.gz`) is rewritten to the CMS address.
  - **Unusual site names.** A name that contains `*/` or a line break cannot break the PHP file or add style.css header fields. Platform names with no Latin letters no longer crash the Sitecore profile.
- **Extra URLs the CMS adds (what a crawler finds beyond the answer key).** Checked 2026-10-30 by crawling a 30-page Ghost-profile news site from `/` on both CMSs. Besides the 30 answer-key pages, the crawler found:
  - links that the generated site has on any host: query-string variants such as `?sort=`, `?utm_source=` and `?s=`, plus links that are broken on purpose
  - WordPress: `/?p=<id>` shortlinks (301 to the page), a comment feed per post (`/<page>/feed/`), `/feed/`, `/comments/feed/`, `/search/feed/rss2/`, `/wp-json/` and REST page records, oEmbed endpoints, `/xmlrpc.php?rsd`, and section URLs without the trailing slash (301)
  - Drupal: `/node/<id>` shortlinks (200, same page), `/comment/<id>` and `/comment/reply/...` pages, and section URLs without the trailing slash (200, same page, as Drupal serves both)

  These are part of the CMS noise. They are not in the answer key and are not test-site pages. oEmbed links for detail pages used to return 404 on WordPress (custom post types have no rewrite rules); since 2026-10-30 they resolve to the post, and `/<page>/embed/` serves WordPress's embed view, as on a real site.
- **Sitemaps.**
  - WordPress serves its own `wp-sitemap.xml` (`/sitemap.xml` redirects there). The import trashes WordPress's untouched "Hello world!" and "Sample Page" and leaves author archives out of the sitemap, so the sitemap lists exactly the answer-key URLs (checked: 60 of 60, nothing extra).
  - Drupal serves the generated `sitemap.xml`, with its URLs rewritten to the Drupal site's own address.
- **Not covered.** Preview-only HTTP behaviour (transport rules, crawler-trap routes, themed 404s) belongs to the SiteForge preview server and is not reproduced inside the CMS. A CMS install serves every page normally, with status 200, even pages the answer key's `transport` section expects to fail or redirect on the preview. For CMS installs, generate the site with **Server responses** set to *Normal responses*, or ignore the `transport` expectations. The CMS serves its own 404 pages and robots.txt; WordPress also serves its own sitemap. A few absolute URLs inside platform scripts and attributes keep the generation address on previews and CMS installs: Wix's `wix-viewer-model` JSON, Ghost's `data-ghost` / `data-api`, Joomla's `rootFull`, and Squarespace's `authenticUrl` / `baseUrl`. They are part of the fingerprint, not links a crawler follows.

### Server realism (2026-10-23, later)

- **Themed 404.** Realistic-source previews answer missing pages (and blocked private paths) with HTTP 404 and the site's own header, navigation and footer, a "Page not found" heading and `noindex`, like a CMS. No private data is included. Clean sites keep the plain `Not found` text.
- **CMS robots.txt.** WordPress sites get WordPress's virtual robots rules (`Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php`). Drupal sites get Drupal's default file (core/profiles assets allowed; `/admin/`, `/user/login`, `/search/`, `/node/add/`, `/index.php/...` and the others disallowed). Every robots.txt keeps the `Sitemap:` line. The `robots-txt-traps` noise still replaces it when selected.
- **Server headers.** Realistic-source previews send `Server` (nginx for WordPress, Apache for Drupal, an object-store server for plain sites), `X-Cache` and `Age`.
- **Readable main content.** On realistic-source sites, block elements inside `main` start on their own lines, as CMS templates print them. Only whitespace between tags is added, so field values are unchanged. `npm run test:realistic-locations` checks every answer-key field and repeated-item location in a browser on realistic sites (as of 2026-10-23: 10 domains, 3 CMS profiles, 3 frameworks and 5 link modes, with 1,099 page fields and 898 repeated fields and 0 failures; see *Nine more platform profiles* for the current rotation).
- **User-agent behaviour** in `legacy-server`: `bot-prerender` and `user-agent-block` (see the table under *Legacy server responses*).

### Disk, speed and media improvements (2026-10-23)

- **No second copy on disk (macOS APFS, Btrfs, XFS).** The evaluator `handoff/` folder used to hold a full byte copy of every website. Its files are now copy-on-write clones (`COPYFILE_FICLONE`). They stay independent: editing one never changes the original, and the existing test checks that. They take no extra space until something is edited. `private/ground-truth.json` is cloned from `answer-key.json` the same way. On filesystems without cloning (for example ext4) this falls back to the previous byte copy.
- **Faster realistic source.** Shared page pieces (icon sprite, mega-menu, mobile menu, consent dialog, social links, footer site map, plugin lists) are built once per site; for root-relative, absolute and base-relative links the output is byte-identical to building them per page. Clutter randomness now uses a fast FNV-1a hash instead of SHA-256 (answer-key truth still uses `seedFor`). 1,000 realistic pages went from 12.8 s to 10.2 s here.
- **Compressed responses.** Previews of realistic-source sites send `Content-Encoding: gzip` with `Vary: Accept-Encoding` when the client accepts it, as production servers do. Pages decode to the exact stored bytes; clients that do not ask for gzip get the plain file. Planned transport faults (including `gzip-mismatch`) keep their exact behaviour.
- **Listing thumbnails.** Repeated items on listing pages of themed sites carry a lazy-loaded thumbnail from the site's media pool (portraits for people sections). The drawn placeholder covers are hidden when a real image is present. Repeated-item locations are unchanged.
- **Noise targets the page image.** `broken-image` and `image-missing-alt` now act on the page's own image (`aside.visual img`) and fall back to the first image only when there is none, so thumbnails never absorb those events.
- Measured sizes, realistic source, 1,000 pages: about 75 MB of website files plus the private answer files. The website can be served at about a fifth of that size over gzip. With clones, the evaluator folder adds nothing on APFS.

### Realistic page source and per-site variety (2026-10-22, second pass)

- **Page source like live sites** (`src/source-clutter.mjs`, Create form → *Page source* → *Realistic*, the default for new test sets; `site.sourceClutter: realistic` in configs). It is modeled on raw source downloaded from 30 real sites, for example theankler.com, nasa.gov, whitehouse.gov, rollingstone.com and techcrunch.com (WordPress), dmpl.org, lexpublib.org, sfpl.org, knoxcountylibrary.org, boston.gov, cam.ac.uk and rush.edu (Drupal), and npr.org, nyc.gov and redcross.org (other). Home pages run about 2,000–3,000 lines and inner pages 1,100–2,100. They include:
  - SEO plugin comment blocks (Yoast or Rank Math style), og:/twitter: meta and a pretty-printed JSON-LD `@graph`
  - dns-prefetch/preconnect hints to `.example` hosts, and seeded plugin stylesheets and scripts (Jetpack, Gravity Forms, The Events Calendar, Complianz and others for WordPress; webform, extlink, eu_cookie_compliance, library_calendar and others for Drupal), every one a real local file
  - the full set of Drupal core component stylesheets or aggregated files, theme favicons and a manifest
  - large `global-styles` and `core-block-supports` inline CSS (WordPress) or critical CSS (Drupal/custom)
  - localized `*-js-extra` data, tag-manager/consent bootstraps, session-recording and pixel queues (no network calls)
  - an SVG icon sprite, hidden mega-menu and off-canvas mobile menus, an accessibility toolbar, `<template>` elements
  - Drupal BigPipe placeholders and replacement scripts, and Twig debug comments on some sites
  - a newsletter band, promo strip, domain widgets (ad slots and paywall meter, translate and feedback, donate modal, portal login, docs search index), a hidden site-map footer
  - a downloadable PDF, a cookie banner and preferences dialog, a chat container, a site-state JSON blob and page-cache comments

  Crawler edge cases inside the clutter: tracking-parameter and filter duplicates of listing pages, a link without a trailing slash (308), fragment-only links, links inside `<noscript>`, `<template>`, hidden menus and JSON, `mailto:`/`tel:` links, external `.example` social links, `rel=nofollow` honeypot links to `/wp-admin/`, `/user/login` or `/admin/`, and a session-id search link. The answer key is identical with or without clutter.
- **Per-site look** (`src/site-look.mjs`): each site gets a seeded palette (hue, saturation, header/nav/utility/footer treatment), with every text pair checked to WCAG AA. It also gets a font pairing (8 system-font pairings, plus monospace for some docs sites), corner radii, letter case and brand size. On top of that come one of 5 header layouts, one of 4 footer layouts, seeded taglines, notices, calls to action and search wording, seeded section names and URLs (for example a library's *Books*, *Catalog*, *Browse* or *New Titles*), a seeded site description, and sector illustrations.
- **Front pages**: 6 arrangements × 6 block orders × 5 tile styles × 4 card styles, seeded headings, and optional plain-text hours, statistics and notice panels.
- **Inner pages** (`src/inner-layouts.mjs`): type-appropriate detail designs (catalog record, person, event, place, article, service, document, collection, docs), 4 layouts per family and 4 listing layouts with facets, result counts and sort controls, assigned per site.
- **Crawler traps**: see *Crawler Traps* (76 noise types in 8 scenarios, plus the `legacy-server` transport profile).
- Tests: `test/source-clutter.test.mjs`, `test/site-variety.test.mjs`, `test/inner-layouts.test.mjs`, `test/crawler-traps.test.mjs`, `test/site-realism.test.mjs`. `scripts/check-field-locations.mjs` now runs with every trap type active and still requires full markup-noise coverage.

### Site realism update (2026-10-22)

Requested fix: choosing WordPress or Drupal must be obvious in **View page source**, and site types other than library must not all look like the same website.

- **Readable CMS source.** Pages are now formatted across lines. WordPress pages carry the head that `wp_head()` produces on real sites: robots meta, `wp-img-auto-sizes-contain-inline-css`, `wp-block-library-css`, a per-site theme stylesheet (`/wp-content/themes/<site-slug>/style.css`), `global-styles-inline-css`, jQuery and jQuery Migrate from `/wp-includes/js/jquery/`, `<meta name="generator" content="WordPress 7.1.3">`, a `?p=<id>` shortlink and a footer `speculationrules` script. The header and navigation use classic-theme markup (`#masthead`, `#site-navigation`, `#primary-menu`, `menu-item-*`), or block-theme markup (`wp-block-template-part`, `wp-block-navigation`) for the Gutenberg profile. Drupal pages carry `Drupal 11` Generator/MobileOptimized/HandheldFriendly tags, hashed `/sites/default/files/css/css_*.css?delta=…&theme=…&include=…` aggregates, a footer `/sites/default/files/js/js_*.js` aggregate, a fuller `drupal-settings-json` (`path`, `ajaxPageState`, `user`), `block-<theme>-site-branding` and `block-<theme>-main-menu` blocks, `menu--level-1` / `menu__link` classes and `data-drupal-messages-fallback`. Every referenced CSS and JS file exists as a placeholder, so nothing 404s. The preview server also sends `X-Generator: Drupal 11 (https://www.drupal.org)` with `X-Drupal-Cache` for Drupal sites and `X-Powered-By: PHP/…` for WordPress sites, so header-based detectors agree with the source. `main` stays a direct child of `body`, and answer keys are unchanged by the CMS choice.
- **Each site type has its own identity.** Generated sites get realistic sector names (for example `Fairwater Regional Library`, `City of …`, `… State University`, `The … Daily News`). Before this change, every site was named after the test set. Each sector has its own utility bar, tagline, search box, call-to-action, footer, colors, type and image palette. The designs are patterned on real sites: library sites on Drupal public libraries such as dmpl.org and berkeleypubliclibrary.org; government sites on whitehouse.gov and U.S. Web Design System sites; city sites on boston.gov; university sites on ox.ac.uk and other Drupal university sites; museum sites on noguchi.org and Designmuseum Danmark; and news sites on rollingstone.com and nytco.com from the [WordPress showcase](https://wordpress.org/showcase/). The legacy appearance keeps its period look.
- **Sector-specific content.** Titles and text are written per content type, for example `Water Conservation Loan Fund`, `Introduction to Urban Design`, `Pediatrics`, `Council approves new … plan` and `Guide to the Budget Reports Records`. They replace the shared `Perspectives on <topic>: <city> 1` pattern. Short facts (specialty, material, course code, accession number, award amount, date range) are now short values. Place names are plausible fictional towns. Person records use the person's name as the title. Sites that use a supplied `contentPool` keep the earlier text generator.
- **Front pages differ by sector.** Home pages (conventional and modern appearance) use a sector layout: quick-link tiles with descriptions, a featured section (`New and noteworthy`, `Top stories`, `Popular right now`, …) and an about panel. Arrangements differ, for example a news front page with a lead story, a museum with a full-width artwork, docs with a sidebar, a city with a skyline banner and service boxes. Six featured records are linked from the home page.
- **Placeholders replaced.** The striped placeholder artwork is now a seeded flat illustration per sector (`src/illustrations.mjs`: bookshelves, capitol, skyline, campus, clinic, code editor, gallery wall, community, archive boxes, newspaper) with matching alt text. Kickers now show the tagline, site name or content type instead of `Welcome` / `Directory` / `Record`. Detail breadcrumbs include the section (`Home / Books / Title`). CMS asset files contain real-looking content (a WordPress theme header, small CSS and no-op JS) instead of a placeholder comment. The `.siteforge.test` hostnames in canonical URLs remain because they are the configured fixture base URL; the preview rewrites them to its own address. The footer still says the site is fictional.
- Regression coverage: `test/site-realism.test.mjs`, plus updated fingerprints in `test/cms-markup.test.mjs`.

## Start

Use Node 24 and the repository's pinned lockfile.

The production command `npm run build` uses Next's supported Webpack build option and then checks that deployment traces exclude private runtime data. Development and production use separate output directories. The local development server in this refinement was also started with `--webpack`.

```bash
npm ci
npm run siteforge
```

Open [the local generator](http://127.0.0.1:4400). The launcher reuses a healthy server for this workspace and reports the actual address. `npm run pagepilot` remains a compatibility alias.

The October 9 local production preview uses [localhost:4403](http://127.0.0.1:4403), with source synchronized to `/tmp/siteforge-deps-20261009.KHjaAE` and saved preview data at `/tmp/siteforge-production.b1hKZS/.fixture-lab`. This is a temporary local runtime, not a deployment. Old generated fixtures were deleted at the user's request; new sets are created explicitly. Primary-project dependencies remain installed. Dated evidence for this refinement is under `outputs/refinement-20261009/`.

The initial Create form is one 60-page library, legacy appearance, high markup noise, the legacy-clutter scenario, standard challenge, and randomness 50. Count and pages, Content and technology, and Appearance and CMS are visible groups. Noise and scenarios, Links and responses, and Repeatability expand separately. **New seed every run** is on under Repeatability. Turn it off to enter or reuse a seed; replay also requires the same other settings. **Generate test set** switches to the saved detail. Use **Preview**, then open or copy its public URL. **ZIP** downloads public website files; **JSON** downloads the private answer key. The set persists after refresh until explicitly deleted.

**Repeat test set** creates another saved set from the selected set's exact configuration and seed. It supports valid custom and catalog configurations and leaves the original set available. The browser regression compares the repeated answer JSON and every public file byte for byte within the same generator version. Cross-version replay is not guaranteed: changed renderers and random choice pools can change new output. Historical catalog requests with ignored custom overrides must omit those options before starting a new job; their saved outputs remain readable. Selecting a set updates the address, so refreshing or sharing that local link keeps the same selection. Failed loads show a Retry button.

Saved-list, selected-job and answer requests have 12-second timeouts. Changing the selected job or retrying aborts the obsolete request, and results/errors are tied to the current selection so a late response cannot replace it. A stalled running-job poll offers a retry without resubmitting generation. POST requests are not automatically retried. The mocked browser checks assert actual request cancellation, separately from real generation tests.

Both desktop and mobile use separate **Create** and **Saved test sets** views. Saved sets are searchable rows, with a dedicated detail view for Websites, Answer keys and Coverage. A saved job URL opens that detail directly. Switching views preserves draft settings; obsolete job and answer requests are cancelled. A deleted or unavailable job has a route back to the library or Create form. The main screen no longer places the full generator form beside the results.

**Delete** opens a keyboard-contained confirmation dialog and removes only that set's generated websites, private keys and handoff folders. It cannot delete application code or other sets. Running generation and live previews block deletion with a visible error; previews expire after 30 minutes. There is no automatic deletion of the user's saved sets. Deletion and preview startup share a filesystem lock, including across app processes, and unsafe job-directory symlinks are refused.

New batches save a private, versioned `plan.json` with every resolved site configuration before starting generation. Its request and plan hashes are referenced by `job.json`; the worker and audit verify that snapshot rather than selecting again from today's preset pools. Changing future random choices therefore cannot silently change a queued plan or make an intact saved plan fail merely because a preset changed. Historical jobs without a snapshot report `legacy-saved-config` provenance: their saved configuration, fixed request constraints, answer keys, metadata and file hashes are checked, but their original random choice mapping is not retroactively proven. Snapshot jobs report `saved-plan-snapshot`. Breaking future schema/validator changes will still require version-aware compatibility. Repeating old settings with newer generator code does not guarantee the old website bytes.

**Randomize settings** selects the random options in the form without starting a job; review the resulting controls and choose **Generate test set**. The number you type is the exact number of pages per site (5-100,000). Tick **Random page count per site** to make it a maximum instead: each site gets a seeded random size from 5 to that number, and all sites share 100,000 pages. The separate randomness factor controls content and structural variation. Each fresh run gets a new seed; a fixed seed, including zero, reproduces the same settings with the same code version. The older one-site `POST /api/fixtures/random` shortcut remains API-compatible, but is not a second competing generate button in the main interface. Its zero-randomness clean profile is distinct from setting the custom form's randomness to zero while retaining explicit markup noise.

When randomness is above zero, each new site also receives one of four seeded site structures: directory, archive, journal, or civic. Detail pages use four deterministic HTML arrangements and four generated bitmap variants, so pages in the same cluster can look different while retaining their known fields and expected cluster. Listing pages also vary between tables and richer repeated item cards. Their displayed item values are copied from the source model at construction time and validated against the linked detail records in the private answer key. The chosen structure appears in the website result row and in the private answer key. Zero randomness keeps a stable structure and asset set. Catalog case IDs and scenario definitions remain fixed; newly generated library cases include the optional cover schema. Existing saved artifacts are not rewritten.

Random means varied, seeded template-generated HTML and fictional records, not arbitrary executable code or an LLM service. The factor controls eligible variation; it does not promise that every obstacle appears on every page. Applied defects are recorded in each page's answer key. Missing optional fields remain members of their declared cluster, while field removal and other destructive effects are represented in the observed field states. Reusing the saved configuration reproduces the same logical content and answers with the same generator code and pinned dependencies. Replaying historical settings after a generator change is not guaranteed to reproduce the old bytes.

Preview servers bind to loopback, expire after 30 minutes, and have a five-preview cap. They are for Smartcite on this machine, not remotely hosted Smartcite. For a remote installation, deploy only the public ZIP to an approved test host. Never deploy `.fixture-lab`, `private/`, or the Next.js evaluator interface as public fixture content.

Preview URL rebasing changes URL attributes, not visible source text. Client-rendered HTML payloads are decoded and rebased by source offsets, then safely encoded again; malformed or unrelated payloads remain unchanged. A regression test catches the previous broad replacement that changed titles/body text containing the fictional origin. Independent browser checks follow real detail links across all three frameworks and five link modes, verify unchanged text and stored files, and check rendered images. This is a local-preview correction, not a rewrite of saved websites.

The batch form also has **Randomize settings**. Each visible configuration selector can independently choose Random; a batch resolves these choices per site from the saved seed. With **Random page count per site** ticked, the pages field is a per-site maximum. Each site draws a reproducible size from 5 to that maximum. If the draws would exceed the 100,000-page set budget, they are scaled down in proportion (never below 5), so sizes still vary. For example, 10 sites with a maximum of 100,000 and seed 48291 resolve to 11,703, 14,186, 3,780, 18,916, 1,988, 4,699, 4,059, 14,598, 18,688 and 7,377 pages (99,994 total). The separate randomness-factor slider controls variation within a generated site's content; it is not the same as randomizing the configuration selectors. This command keeps local preview HTTP; HTTPS remains available through the fixed catalog/API and historical saved settings, not a hidden randomized switch.

## Controls

### Local Storage

Generated sites are real files, not placeholders. A saved set includes public site files, private source records and the evaluator handoff folder; larger page counts consume more local disk. Start with the default 60 pages and use large scale runs only when needed. Use Saved test sets > Delete to remove a completed set after testing. The user-facing generator does not automatically discard saved sets.

The October 9 cleanup removed 147 old saved jobs, 1,028 standalone generated-site folders, 71 copied website/answer-key exports and 1,113 leaked test temporary directories. Old duplicate dev/build/dependency caches were also removed after their servers stopped. Application source, installed working dependencies and compact test reports/screenshots were retained. Available volume space rose from 7.9 GiB to about 75 GiB during cleanup; this is an observed filesystem change, not proof that SiteForge caused the entire earlier drop from 200 GB.

Fourteen temporary roots across seven Node-test files now have unconditional test teardown. A fresh 432-test run left none of the reviewed leak-prefix folders behind. Generator, catalog and random browser smoke checks delete only the jobs/downloads they created and stop their own preview. Use `SITEFORGE_KEEP_TEST_ARTIFACTS=1` only when intentionally retaining generated payloads for investigation. Reports and screenshots remain by default. Opt-in scale scripts still preserve their outputs and must not be run routinely; the previous large fixtures were deleted, not regenerated for this cleanup.

Separate temporary Desk Notes data was identified but not deleted. This cleanup does not authorize removing other applications' data, source projects or personal files.

### Generation Settings

| Setting | Implemented contract |
| --- | --- |
| Name | 1-80 characters; labels the set, not a shell command or filesystem path |
| Websites | 1-500 for custom sets; the fixed regression catalog generates 1,440; one active batch |
| Pages per site | Exactly the number entered (5-100,000), at most 100,000 total pages per set. With `randomPageCount: true` the number is a per-site maximum; seeded per-site sizes from 5 to it share the 100,000-page budget. Legacy API value `0` still means a random 5-200 per site |
| Randomness | Integer 0-100, default 50 in the UI; controls content length, layout, weighting, page size and optional-field variation. The retained random API also uses it to choose noise and other settings; manual markup noise is a separate control |
| Site type | Library, government, municipality, university, healthcare, documentation, museum, nonprofit, records, news, or mixed |
| Technology | Static HTML, real React client runtime, real Angular client runtime, or deterministic mixed assignments |
| CMS markup | None, WordPress, Drupal, Joomla, Squarespace, Webflow, HubSpot, Adobe Experience Manager, Sitecore, Wix, Shopify or Ghost style, or a seeded per-site choice. These are static HTML signatures, not installed CMS servers. For real WordPress or Drupal output, use the theme packages. |
| Page-builder markup | WordPress sites can use Gutenberg-style blocks, Elementor-style widgets/containers, Beaver Builder-style rows/columns/HTML modules, Divi-style sections/rows/columns/text modules (`et_pb_*`, `et_pb_text_inner`, Divi theme CSS/JS and body classes) or WPBakery-style rows/column containers/`wpb_wrapper` text columns (`js_composer` CSS/JS, `wpb-js-composer` body class). No builder plugin runs in the generated site. Random builder choices include Divi and WPBakery since 2026-10-30. |
| Link URLs | Root-relative legacy default, actual page-relative paths, fully qualified same-site URLs, seeded mixed links, or explicit document-base-relative paths; the answer key keeps normalized logical paths. Random uses the existing page-relative/fully-qualified/mixed pool |
| Appearance | Legacy, conventional, modern, or mixed |
| Field layout | Definition lists, tables, labeled paragraphs, or mixed |
| Markup noise | Clean, low, medium, high, or mixed; clean produces zero HTML/content mutations, independent of server response settings |
| Challenge level | Standard preserves existing profiles; hard samples eligible operators at 0.85 with severity 3 and a cap of 10 per page; extreme samples at 1 with severity 3 and all eligible selected operators. Clean always remains zero. This is available for custom and random generation; catalog cases keep fixed settings |
| Server responses | Normal, HTTP errors, redirects/loops, or mixed response obstacles; applies on the preview server, not in a static ZIP |
| Preview transport | Main-form jobs use HTTP. Saved settings, API and catalog retain HTTP/HTTPS compatibility; local HTTPS uses a self-signed test certificate |
| Optional field variation | On varies the last non-title scalar field and the library book's coverImage; Off keeps preset optional fields present. Random resolves On/Off per site. Baseline presence is seeded at 0.5 with bounded per-record variation. Explicit schema probabilities of 0 or 1 remain fixed |
| Seed | Unsigned 32-bit integer; same settings and pinned versions reproduce logical pages/answers. Omitted random seeds and custom requests with `freshSeed: true` avoid all previously saved job seeds |

The custom count limits are validation limits, not guarantees of hardware capacity. A 5-8 page site uses fewer content types so that home, listing and detail pages fit; references to omitted types are removed. Explicit oversized content-type configurations are rejected. The regression catalog exercises 1,440 small sites of 16 pages, not 1,440 large sites. The small-site slider remains 5-200 and is disabled when a larger count is entered in the numeric field.

Invalid names, website counts, page counts and explicit seeds show inline messages linked to their inputs; correcting them enables generation again. The legacy API page count `0` and explicit seed `0` remain valid. New custom API requests reject a random builder paired with an omitted, None or Drupal CMS, because that builder could never apply. Select WordPress or Random CMS instead. Historical requests remain readable; this validation affects new generation only.

The worker releases its generation lock before publishing a completed or failed state. This prevents an immediate next request from encountering a stale busy response after observing completion. A controlled test holds the release step and checks both success and failure; it is not a claim of distributed locking. If the worker crashes between unlock and the final status write, existing recovery conservatively marks the still-running record as failed and preserves its completed artifacts.

Library books now declare an optional `coverImage` field. The source model chooses its presence and local PNG URL before rendering and records `fieldStates.coverImage` plus `fieldSelectors.coverImage`. Present covers render as `img[data-field="coverImage"]`; absent covers do not render an image. Broken-cover noise keeps the original URL in `canonicalValues.coverImage` and records the missing URL in both observed `fields.coverImage` and `image.src`. Natural optional absence and deliberate removal are different cases. Other content types retain their existing decorative images; explicit schemas support one image-typed field per content type.

### Large Single Sites

Current single-site evidence: job `b46800b5-0c9f-4b92-a795-b484633fd416` generated a fresh 100,000-page legacy HTML library with WordPress/Gutenberg markup, high noise, mixed response conditions and generator 1.2.0 field locations. Core generation took 104,965 ms with 1,382,694,912 bytes peak RSS; copying the evaluator folder takes additional time. The audit checked every answer record, inspection chunk, 100,012 public files and 100,015 handoff files. Public and evaluator ZIPs were checked entry by entry against source digests, and the 297,730,117-byte JSON download matched the saved key. Three sitemap shards contained exactly 100,000 unique URLs. Evidence: `outputs/refinement-20261009/single-site-scale-result.json` and `single-site-scale-audit.json`.

The first combined export verifier ran out of V8 heap while retaining an in-memory ZIP. That run is not counted as a pass. The fixed verifier uses the [yauzl lazy-entry reader](https://github.com/thejoshwolfe/yauzl) to hash one entry at a time, including the large JSON, without buffering complete archives or answer files. It resumed the preserved site and passed in 256,358 ms with 1,216,806,912 bytes verifier peak RSS. This time excludes initial generation and the failed attempt. New verification runs require an empty evidence directory and record running/failed state, preventing an old success report from remaining beside replaced artifacts. Archive checks and exports have bounded deadlines. Historical generator 1.0.0 scale evidence remains under `outputs/completion-verification/`; neither run proves every profile at that size.

A separate bounded 1.3.0 check generated 20,000 legacy HTML pages with WordPress/Elementor markup, high noise, mixed links and responses, and randomness 100. It completed generation in 27,396 ms with 630,947,840 bytes worker peak RSS. The audit verified all 20,000 answer records, 20,009 public files and 20,012 handoff files. The key contains 770 listing pages, 19,229 repeated records and 57,687 repeated-field locations. The complete JSON is 69,110,703 bytes; compact repeated-location arrays contribute 12,217,851 serialized bytes, not an incremental-memory measurement. First/last paginated answers exactly matched the saved key. Evidence: `outputs/refinement-20261009/fourth-pass/scale-20000/`. This checks the added repeated-location contract at 20,000 pages without regenerating 100,000 pages; it does not extend the earlier scale result to every new configuration.

Generation writes large JSON records incrementally and reports page-level progress every 500 pages, followed by file verification. Answer inspection returns 25 records at a time, searches the complete private index, and uses full-site coverage totals. The full JSON remains downloadable separately. Private inspection indexes and 250-record chunks never enter the public website or ZIP; `audit:job` checks them against the full key, including a tampered-chunk negative test. Old saved jobs without these sidecars remain readable.

Public downloads use sequential streaming ZIP entries with ZIP64 support, and JSON downloads stream directly from disk. This follows the [zip-stream API](https://github.com/archiverjs/node-zip-stream). Sitemaps split at 45,000 URLs and the scale verifier checks every shard against the [sitemap protocol limits](https://www.sitemaps.org/protocol.html). No Smartcite run or Docker run is implied by these generator checks.

Run `node scripts/check-single-site-scale.mjs` to create **one new 100,000-page site**, audit source/answer records and both file copies, verify the three sitemap shards, export and verify both ZIP inventories, and compare downloaded JSON bytes. This is an opt-in scale test, not part of every unit-test run. Set `FIXTURE_LAB_DATA_DIR` and a new, empty `SCALE_EVIDENCE_DIR` on local storage with several GB free. `SCALE_JOB_ID=<saved-id>` rechecks an existing single-site 100,000-page job without regenerating it; the report records `reusedSavedJob: true`. Existing reports and exports are never overwritten. The generated site is preserved, with timing, memory and artifact sizes reported in `evidence.json`.

## Legacy Scenarios

| Scenario | Available noise families |
| --- | --- |
| All supported markup obstacles | All 28 eligible operators; HTML excludes JavaScript delay |
| Legacy markup & clutter | Extra/deep wrappers, class churn, inline styles, repeated boilerplate/navigation, malformed nesting, duplicate IDs, missing document landmarks/metadata, untitled frames, old color attributes, field reordering |
| Misleading content & metadata | Boilerplate, comments, hidden decoys, duplicate headings, conflicting metadata, query/fragment links, broken or unlabelled images, script-only links and controls |
| Damaged legacy structure | Wrappers, malformed nesting, duplicate IDs, nested layout tables, deprecated HTML, missing landmarks, untitled frames, old color attributes, reordered fields |
| All crawler traps / seven "Crawler traps: …" sub-scenarios | The crawler-trap operators below, by group; opt-in only (never chosen by Random, not part of the markup baseline) |
| Inconsistent fields | Missing fields, label variation, date formatting, field reordering |
| Delayed JavaScript content | Controlled React/Angular readiness delay; rejected for HTML and mixed technology |

Low/medium/high noise select eligible operations with probabilities 0.12/0.35/0.70, severities 1/2/3, and per-page caps 2/4/7. These are synthetic test settings, not measured frequencies on real sites. A probabilistic profile does not guarantee every enabled operation occurs on every page. Private answers contain actual per-page events. High boilerplate includes repeated archive links, a legacy layout table, deprecated font markup and a dated notice, with fictional text.

The obstacle scenario selects *eligible families*; it does not promise every family is applied to each page. Challenge changes density and severity only for non-clean custom sites. The custom baseline has 28 operators, with HTML excluding JavaScript delay and client frameworks excluding the missing-main mutation. Randomness changes fictional content and the random shortcut's seeded choices; markup noise and challenge are separate settings. HTTP responses are separate again and remain normal unless explicitly selected. An omitted challenge is backward compatible with saved configurations and the fixed 1,440-case catalog; explicit hard/extreme catalog requests are rejected.

Every supported operator has a direct observable-change regression for two seeds. Sixteen expanded operators additionally run across all three field layouts. All 351 pairs of the 27 non-delayed operators are exercised for repeatability and source integrity, with actual symptom assertions for the expanded operators; this is not all higher-order combinations. A regression checks conflicting metadata survives metadata removal at all three severities and both orders.

The Coverage tab reads the actual private answer key. Its page counts mean an obstacle was applied, not that Smartcite passed it. A zero count is shown as **Not applied**. The inventory is tested against the implementation to prevent advertising placeholder operators. Old saved runs remain readable, but do not gain new obstacles retroactively.

For compatibility, CLI configurations that omit `noise.types` retain the original 12-type family (11 for HTML). The UI's all-markup scenario explicitly selects the expanded family. The saved 1,440-case catalog and the adversarial CLI example retain their original 20-type inventory, so their IDs and historical expectations do not silently change. New operators are available to custom scenarios and new jobs, not retroactively added to old artifacts.

### Crawler Traps

There are 76 crawler-trap operators, grouped into seven opt-in scenarios (UI: "Crawler traps: …") plus `crawler-traps` for all of them. They reproduce documented ways real, especially old, websites confuse crawlers. They are kept out of the "All supported markup obstacles" baseline, and Random never picks them, because they enlarge the URL space; existing plans and the 1,440-case catalog are unchanged.

Each event's `details` object is computed from the source page before rendering (`src/crawler-traps.mjs`), written into `private/answer-key.json`, and re-derived by `validateAnswerKey`, so an altered or invented detail fails generation. Canonical fields, links, field locations and repeated-item locations never change.

Extra public files (frames, feed, copies, encoding documents, robots.txt, sitemaps) are declared as non-page `resources`, written by the generator and hashed in the manifest. They never use the name `index.html`, so the page inventory stays exact. Server-backed routes (`/cgi-bin/*.pl`, `/login`, `/m/`, session and default-document rewrites, case fallback) are enabled only when `private/config.json` lists the type. The static ZIP contains the HTML and the resources, not the dynamic routes.

The path prefixes `cgi-bin`, `intl`, `old-site`, `frames`, `feeds`, `login` and `m` are reserved content-type slugs. Only trap types may emit `<script>`, non-root-relative hrefs or non-HTTP schemes. The markup operators keep the original script-free, local-resource contract (`adversarial-html.test.mjs` runs all 378 markup pairs). `test/crawler-traps.test.mjs` covers:
- detail recomputation across 3 severities and 3 frameworks;
- markup-to-truth checks, including WHATWG resolution of relative, backslash, whitespace and entity-encoded hrefs;
- composition with neighbouring traps and markup operators;
- tamper rejection;
- bounded breadth-first crawls that match every `reachableUrls`;
- alias statuses and bodies;
- resource bytes (windows-1252, UTF-16, gzip);
- robots.txt semantics;
- preview rebasing;
- a clean fixture exposing no trap route.

**Old-site navigation (`old-site-navigation`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `select-navigation` | `<select onchange>` jump menu | `targets` |
| `postback-link` | ASP.NET `__doPostBack` anchor inside a POST form with `__VIEWSTATE` | `eventTarget`, `resolvesTo`, `followableByGet: false` |
| `image-map-navigation` | `<img usemap>` with `<area href>` | `targets` |
| `noscript-only-link` | A link that exists only in `<noscript>` | `targets` |
| `comment-only-link` | Commented-out links: a dead `/old-site/N.htm`, plus a real page from severity 2 | `links[].exists/expectedStatus`, `isHyperlink: false` |
| `document-write-menu` | Menu written by `document.write()` (escaped `<\/a>`) | `targets`, `revealedBy` |
| `dhtml-hover-menu` | Links in a `visibility:hidden` fly-out shown on `onmouseover` | `targets`, `linksInDom`, `hiddenUntil` |
| `frameset-navigation` | Link to `/frames/frameset.html` (nav frame and main frame, with a `<noframes>` fallback) | `resources`, `frames`, `navTargets` |
| `iframe-navigation` | `<iframe src="/frames/nav.html">` holding the section links | `frameSrc`, `navTargets`, `resources` |
| `window-open-popup` | `javascript:window.open(...)` href; from severity 2 an `onclick` pop-up with a real href and `target=_blank` | `links[].opens/crawlableHref` |
| `ie-conditional-links` | A link inside `<!--[if lt IE 9]>` (a comment to every other parser), plus a downlevel-revealed `<!--[if !IE]><!-->` link | `hiddenInConditionalComment`, `visibleOutsideIe` |
| `object-embed-fallback` | Flash `<object>`/`<embed>` to missing `.swf` files, with an HTML fallback link | `plugins[].expectedStatus` 404, `fallbackLinks` |
| `svg-links` | `<svg><a xlink:href>` and an SVG2 `href` link | `links[].attribute` |
| `form-get-navigation` | GET form with hidden inputs submitting to a section listing | `action`, `fields`, `submittedUrl`, `resolvesTo` |

**JavaScript-only links (`javascript-links`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `location-handlers` | `location=`, `location.assign()` and `self.location.replace()` handlers on button, span and div | `handlers[].form/href` |
| `js-string-links` | URLs only inside a script array | `targets`, `onlyInScript` |
| `json-blob-links` | URLs in `application/json`; from severity 2, absolute URLs in JSON-LD | `jsonTargets`, `jsonLdUrls` |
| `data-attribute-links` | `data-href`, `data-url` on an `<a>` without href, and `data-link` | `links[].attribute/href` |
| `js-redirect-page` | Link to `/cgi-bin/jump.pl?to=…`, a page with only `window.location.replace` | `href`, `redirectTo`, `htmlFallback: false` |
| `meta-refresh-link` | `/cgi-bin/redirect.pl?url=…`: HTTP 200 with a 0-second meta refresh | `href`, `refreshTo`, `refreshDelaySeconds` 0 |
| `meta-refresh-delayed` | The same with `&delay=5` | `refreshDelaySeconds` 5 |
| `noscript-meta-refresh` | `/cgi-bin/nojs.pl?url=…`: the meta refresh sits inside `<noscript>` | `refreshTo`, `refreshOnlyWithoutScript` |
| `shadow-dom-links` | Declarative shadow DOM `<template shadowrootmode="open">` holding a link | `targets`, `declarativeShadowRoot` |
| `web-component-slots` | A custom element with a slotted light-DOM link and a script-built shadow-only link | `slotted`, `shadowOnly` |
| `lazy-load-noscript` | `data-src` image with a `data:` placeholder and a `<noscript>` fallback; `data-bg` from severity 2 | `images[]` |
| `load-more-pagination` | A "Load more" button and `data-next-url` to `/cgi-bin/list.pl?offset=N` fragments with `rel=next` links | `entry`, `reachableUrls` 20, beyond the last offset: an empty 200 |

**URL duplication (`url-duplication`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `session-id-urls` | `;jsessionid=`, `?PHPSESSID=` and ASP.NET `/(S(token))/` self aliases (the server strips the path forms) | `aliases[]` |
| `duplicate-url-aliases` | `index.html`; from severity 2 UPPER-CASE (served, as on IIS) and no trailing slash (308); from severity 3 `%2D` and a double slash | `aliases[].kind/status/resolvesTo` |
| `tracking-params` | `utm_*`, `fbclid`, `gclid` self links | `aliases` |
| `print-duplicates` | `?print=1`, `?format=print` | `aliases` |
| `mobile-duplicates` | `/m/…` (the server strips the prefix) and `?mobile=1` | `aliases` |
| `faceted-navigation` | Every combination of `color`, `size` (and `sort` from severity 2): 15 or 47 URLs serving the same page | `variants`, `variantCount`, `declaredCanonical` |
| `sort-order-params` | `sort/order/orderby/dir` aliases, including reordered parameters | `aliases` |
| `default-document-aliases` | `default.asp`, `default.aspx`, `index.php`, `index.htm`, `index.shtml` (mapped by the server) | `aliases` |
| `mixed-case-extensions` | `INDEX.HTM`, `Index.Html`, `index.HTML` | `aliases` |
| `dot-segment-urls` | `/a/./b/`, `/a/b/../b/`, `#top` | `links[].resolvesTo`, `rawRequestStatus` |
| `relative-climb-links` | `../../../../../../x/` chains that climb above the root | `links[].resolvesTo` |
| `backslash-urls` | `\\books\\x\\` and mixed backslash hrefs (WHATWG treats `\\` as `/`; a literal request gets 400 or 404) | `links[].resolvesTo/rawRequestStatus` |
| `protocol-relative-links` | `//host/x/` to the same host (rebased in previews) | `links` |
| `cross-scheme-links` | The other scheme (`https:` for an http site) and an explicit default port | `links[].scheme/previewReachable` |
| `base-href-traps` | `<base href=".../intl/">` first, then an ignored second base; a relative `contact/` link becomes 404. Only on root-relative/absolute sites | `bases`, `effectiveBase`, `relativeLinks`, `fragmentLinksAffected` |
| `duplicate-section-content` | An exact copy at `/old-site/<section>/<slug>.html` | `copy.path/duplicateOf` |
| `near-duplicate-dated` | A copy differing only by an "Edition of DATE" line | `copy.date/differsBy` |
| `pagination-query-variants` | `?page=1`, `?page=2`, `?page=999` (beyond the last page, served 200), `?p=2&start=24`; `rel=next` from severity 2 | `variants[].servedAs` |
| `long-url-links` | A self link longer than 2,000 characters | `links[].length/status` |

**Infinite URL spaces (`infinite-spaces`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `calendar-trap` | `/cgi-bin/calendar.pl?month=YYYY-MM[&view=list]`, linking to the previous/next month and year | `reachableUrls` 480, 404 outside 1996-01..2015-12 |
| `day-calendar-trap` | `?date=YYYY-MM-DD`, linking to the previous/next day | `reachableUrls` 731 (2004-2005) |
| `path-info-trap` | `/cgi-bin/browse.pl/archive/` whose relative `media/` and `print/` links grow the path | `reachableUrls` 255, `maxSegments` 8 |
| `date-archive-trap` | `/cgi-bin/archive.pl/YYYY/MM/DD/` year, month and day pages | `reachableUrls` 757 |
| `search-tag-cloud` | Tag links to `/cgi-bin/search.pl?q=…`, each paginated to 5 pages | `terms`, `reachableUrls` |
| `login-wall-links` | `/login?next=…` whose "Forgot password" link nests `next` again | `reachableUrls` 3, `maxDepth` 2 |

**Indexing signals (`indexing-signals`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `misleading-canonical` | Canonical points to the home page; `og:url` to `?view=print` from severity 2 | `declaredCanonical`, `trueUrl` |
| `canonical-chain` | Canonical → `/cgi-bin/canonical.pl?hop=1` → `hop=2` → the page (the hop documents are copies) | `chain`, `finalCanonical` |
| `canonical-to-404` | Canonical points to a missing `/old-site/gone-N.htm` | `canonicalStatus` 404 |
| `canonical-cross-host` | Canonical on a different host and scheme | `declaredCanonical` |
| `multiple-canonical` | Two conflicting canonical tags | `canonicals` |
| `social-url-conflicts` | `og:url`, `twitter:url` and `itemprop=url` disagree | `ogUrl`, `twitterUrl`, `itempropUrl` |
| `hreflang-alternates` | Self, `x-default`, and `/intl/fr|de/…` alternates that return 404 | `alternates[].status` |
| `hreflang-cross-page` | `hreflang=es` pointing to a different English page; no return link guaranteed | `alternates` |
| `robots-noindex` | Meta `noindex, follow`; `noindex, nofollow` at severity 3 | `robots` |
| `meta-robots-variants` | `noarchive, nosnippet`, `googlebot: noindex`, `none` | `metas` |
| `rel-nofollow-links` | `rel=nofollow`, `ugc`, `sponsored noopener` with `target=_blank` | `links[].rel` |
| `rel-link-hints` | `<link rel=prefetch/next/prev/preload>` and a missing RSS alternate | `hints[].status` |
| `feed-links` | An RSS feed at `/feeds/news.rss` with absolute item links | `feed`, `resources` |
| `robots-txt-traps` | On the home event, `/robots.txt` is replaced: `Disallow: /cgi-bin/`, a longer `Allow`, `/*?print=`, `$`, `Crawl-delay: 5`, a Googlebot group, a wrong-host `Sitemap` | `content`, `expectations[]` (checked with robots-parser) |
| `sitemap-traps` | `<link rel=sitemap>` to a sitemap index, with a nested index, a gzip sitemap, and 404, 308, fragment and wrong-host entries | `resources`, `entries[].expectedStatus` |

**Server behaviour & gates (`server-behaviour`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `cookie-consent-wall` | A full-screen consent overlay; the content stays in the DOM | `overlay`, `contentInDom`, `links` |
| `age-gate` | An "18 or older" interstitial with a `?age_verified=1` confirmation and an external exit link | `confirmHref`, `exitHref` |

**Encoding & URL syntax (`encoding-and-markup`)**

| Operator | Public symptom | Answer-key `details` |
| --- | --- | --- |
| `charset-conflict` | Declares iso-8859-1; the header and bytes are UTF-8; a BOM from severity 2 | `declaredCharset`, `effectiveEncoding` |
| `windows-1252-documents` | Two `.htm` press releases in windows-1252 bytes: one declared correctly, one declared UTF-8 (mojibake/U+FFFD) | `resources[].expectedText/decodesCorrectly` |
| `utf16-document` | A UTF-16LE document with a BOM | `resources` |
| `space-unicode-urls` | `/old-site/Annual Report 2004.htm` and `café-menü.htm`, linked both raw and percent-encoded | `resources[].hrefs` |
| `entity-encoded-hrefs` | `&#47;`, `&#x2F;` and `&amp;` in the raw href source | `links[].raw/resolvesTo` |
| `whitespace-hrefs` | Leading/trailing spaces, newlines and an embedded tab | `links[].resolvesTo` |
| `non-http-schemes` | `mailto:`, `tel:`, `sms:`, `ftp:`, `file:`, `data:` | `links[].crawlable: false` |
| `css-links` | `@import` of a missing stylesheet, `background-image`, an IE `behavior:url()`, and a page URL in an inline style | `imports`, `urls[].expectedStatus` |

**Legacy server responses.** The separate transport profile `legacy-server` (UI: "Legacy server behaviour"; opt-in, never random) plans 16 detail-page rules:

| Rule | Behaviour | Expected retrieval |
| --- | --- | --- |
| `bot-prerender` | Dynamic rendering: user agents matching `bot|crawl|spider|slurp|smartcite` get server-rendered HTML (React/Angular shells replaced by their main content) with `X-Prerender: 1`; browsers get the normal page | Available (content differs by user agent) |
| `user-agent-block` | Firewall: empty, curl, wget, Python, Java, Go, libwww, Scrapy and similar clients get a 403 "Access denied" page; browsers and named crawlers get the page | Available to browsers and named crawlers |
| `redirect-status-chain` | 301 → 302 → 303 → 307 → 308 → `/` | Home available |
| `redirect-case-variant` | 301 to the UPPER-CASE path, which returns 404 even when case fallback is on | Unavailable |
| `redirect-external` | 302 to `http://moved.siteforge.invalid/…` | Unavailable (off-site) |
| `intermittent-503` | 503 with `Retry-After: 1` for the first 2 requests per server process, then 200 | Available |
| `http-503-retry-after` / `http-500` | 503 with `Retry-After: 120` / 500 | Unavailable |
| `slow-drip` | 6 body chunks 80 ms apart | Available |
| `truncated-body` | Full `Content-Length`, half the body, socket closed | Unavailable |
| `missing-content-type` / `gzip-mismatch` | No `Content-Type` / `Content-Encoding: gzip` on a plain body | Available / unavailable |
| `x-robots-tag` / `link-header-canonical` | `X-Robots-Tag: noindex, nofollow` / `Link: </>; rel="canonical"` | Available, signals recorded |
| `cookie-required` | 302 to itself with `Set-Cookie` until the cookie is sent | Available with a cookie jar |
| `soft-404-navigation` | 200 with the real header and navigation but a "Page not found" main | Unavailable |

`mixed` remains the fixed 10-rule profile, and `TRANSPORT_CATALOG` still equals it. `LEGACY_SERVER_CATALOG` lists the new rules, and the Coverage tab shows both.

Sources: [Google link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable), [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [faceted navigation](https://developers.google.com/crawling/docs/faceted-navigation), [canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure), [redirects and meta refresh](https://developers.google.com/search/docs/crawling-indexing/301-redirects), [robots meta / X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions), [pagination and incremental loading](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading), [Archive-It crawler traps](https://support.archive-it.org/hc/en-us/articles/208332943-Identify-and-avoid-crawler-traps-), [Heritrix PathologicalPathDecideRule](https://archive-crawler.sourceforge.net/xref/org/archive/crawler/deciderules/PathologicalPathDecideRule.html), [Heritrix: avoiding too much dynamic content](https://github.com/internetarchive/heritrix3/wiki/Avoiding-Too-Much-Dynamic-Content), [Nutch regex-normalize](https://apache.googlesource.com/nutch/+/2.x/conf/regex-normalize.xml.template), [Portent spider-trap field guide](https://portent.com/blog/seo/field-guide-to-spider-traps-an-seo-companion.htm), [Wikipedia: spider trap](https://en.wikipedia.org/wiki/Spider_trap), [WHATWG encoding sniffing](https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding), [WHATWG URL parsing](https://url.spec.whatwg.org/).

Not implemented, with the reason:
- An HTTP and HTTPS pair served from two listeners: previews run one listener. The cross-scheme alias is declared instead.
- A true redirect to a URL whose case differs and that then resolves: on a case-sensitive host it breaks, which is what is modelled.
- PDFs: they need a PDF writer. Print versions are covered by `print-duplicates`.
- Cloaking by user agent: out of scope for a fixture.

### HTTP Obstacles

| Condition | Actual preview behavior | Expected retrieval |
| --- | --- | --- |
| 403 / 404 / 410 | Fixed forbidden / missing / gone response | Original source record unavailable |
| 429 | Rate-limit response with `Retry-After: 1` | Unavailable; repeated requests still return 429 |
| 503 | Fixed unavailable response | Unavailable; no automatic recovery simulation |
| Soft 404 | HTTP 200 with an error document | Error document, not the original record |
| Wrong content type | Original HTML delivered as `text/plain; charset=utf-8` | Bytes available; interpretation is the candidate's responsibility |
| Slow response | Original HTML after 300 ms | Available after a bounded delay, not an actual network timeout |
| Redirect chain | Source 302, two intermediate local 302 hops, then `/` | Final home record available; the original detail is not returned |
| Redirect loop | Source and one virtual local path redirect to each other | No final document; candidate must terminate at its own redirect budget |

Profiles plan up to 0/6/2/10 distinct detail paths for `none/errors/redirects/mixed`, capped by the number of eligible detail pages. A small fixture may omit conditions; Coverage shows which ones. The 60-page example has all ten. Home, listings and assets stay healthy. Every rule is planned from source records before rendering, never inferred by crawling. GET and HEAD are tested, as are invalid manifests and private-path protection. The server rejects unsafe redirect paths, arbitrary header extensions and delays over 300 ms.

HTTP behavior requires `src/server.mjs`, invoked by previews or the CLI `serve` command. A static ZIP contains the original HTML files and cannot reproduce status codes, delays or redirects. The private answer key includes `transport`; do not use that file as public web content. Score retrieval behavior separately from extraction: do not count an intentionally unavailable source record as an extraction miss, or a redirect-to-home as the original detail record. No Smartcite scoring adapter is claimed here.

### HTTPS Previews

Select an HTTPS catalog case, use the API's `previewProtocol` setting, or reopen a saved HTTPS job. The main generator form intentionally has no protocol control. The preview worker uses local `openssl` to create a 30-day localhost certificate with localhost, 127.0.0.1 and ::1 names. The private key remains under `private/tls/key.pem` with mode 0600. The separate certificate download returns only `cert.pem`, never the key. Neither file is in the website ZIP or public preview. No operating-system trust store is changed and TLS verification is not disabled globally.

A browser or client that does not trust the certificate should reject it; that is an intentional test condition. A test client can explicitly use its downloaded public certificate, for example `curl --cacert site-test-certificate.pem https://127.0.0.1:<preview-port>/`. Trust applies to that request, not all sites. The low-level CLI `serve` command remains HTTP by default; use the application preview to apply stored HTTPS settings. Certificate bytes and timestamps are not deterministic content artifacts.

Expired certificates matching the local helper's validated profile are renewed on preview start; test clients must download the replacement public certificate. Incomplete, malformed or insecure credentials are preserved and rejected. Renewal uses a bounded owner lock and recoverable directory swap; interrupted dead-owner locks are recoverable while live-owner locks are not taken over. Browser verification releases only the previews it creates; user-created previews retain their normal 30-minute lifetime.

### Regression Catalog

Open [Case catalog](http://127.0.0.1:4400/cases). Search/filter by domain, framework, field layout, HTTP/HTTPS and obstacle profile. Generate one selected case or the complete matrix:

**10 domains x 3 frameworks x 4 layouts x 2 protocols x 6 profiles = 1,440 distinct configurations**, with 16 pages each: **23,040 HTML pages**. There are 720 HTTP and 720 HTTPS cases. These are scenario combinations, not 1,440 independent bug families, downloaded upstream tests, or all possible website failures. Behavior uniqueness excludes names, URLs and seeds. All sites use the legacy appearance, and mixed field layout is a real per-record assignment.

| Profile | Deliberate conditions |
| --- | --- |
| Clean control | No markup mutations or HTTP faults |
| Legacy structure | Wrappers, classes/styles, field order, malformed nesting, duplicate IDs, layout tables and obsolete markup |
| Extraction decoys | Boilerplate, comments, hidden content, duplicate headings, conflicting/missing metadata |
| Field variations | Missing fields, alternate labels, date formats and field ordering |
| Resources and rendering | Link variants, broken images, plus delayed content for React/Angular |
| HTTP faults | All eligible markup operators and all ten response conditions |

Non-clean catalog profiles set probability 1, severity 3 and a cap equal to their eligible operator count. Individual fields may still make an operator inapplicable. Evidence records configured versus observed coverage rather than inventing events.

New catalog requests reject `cmsProfile`, `builderProfile`, `linkMode` and `randomness`, including explicitly supplied default values, because catalog plans have fixed settings and would ignore those overrides. The API returns field-specific HTTP 400 errors before starting a job. Use a custom test set for those choices. Existing saved configurations, snapshots and artifacts retain their historical read/audit behavior.

```bash
npm run catalog:run
# Or verify an existing completed full-catalog job:
npm run test:catalog -- --job <job-uuid>
```

`catalog:run` creates a saved job, waits for generation, and verifies every artifact. `outputs/case-catalog/evidence.json` contains per-case outcomes, SHA checks, exact page inventories, deterministic source/noise/render replay and profile coverage. The checker rejects missing/duplicate cases, configuration mismatch and wrong protocol distribution. It does not run Smartcite or make 1,440 live TLS connections. Separate real-loopback tests cover HTTP/HTTPS behavior and explicit-certificate trust. Browser checks exercise catalog filters/pagination, selected-case generation, random generation, JSON/ZIP downloads, actual pages and seed replay.

### Reference Research

Real pages are inspiration only; no real records, branding or source HTML are copied into fixtures.

| Reference | Observed pattern | Coverage and distinction |
| --- | --- | --- |
| [CERN WWW project](https://info.cern.ch/hypertext/WWW/TheProject.html) | Sparse legacy headings and definition-list navigation | Definition-list fields and metadata-removal stressors; not a replica |
| [GNU Coreutils manual](https://www.gnu.org/software/coreutils/manual/html_node/index.html) | Dense nested contents and manual navigation | Documentation preset/listings exist; equivalent deep nested contents are still a gap |
| [National Archives resources](https://www.archives.gov/research/alic/reference/archives-resources.html) | Repeated global navigation and a content-heavy archive directory | Records preset, distinct landing/listing/detail types and repeated boilerplate; not identical architecture |
| [Books to Scrape](https://books.toscrape.com/catalogue/page-1.html) | Dense linked product listings, 8 pages sampled | Repeated fictional listing records now carry detail values, not just links; a focused recheck detects all 20 cards on the first page |
| [Quotes to Scrape](https://quotes.toscrape.com/) | Repeated quotes and separate author pages, 8 pages sampled | The focused recheck sees 10 microdata quote records on the first page; author details remain a different observed structure |
| [Seattle Municipal Archives](https://archives.seattle.gov/digital-collections/index.php/Detail/objects/37288) | Detail pages with named fields, duplicate IDs and click navigation, 5 pages sampled | Structured fields, duplicate-ID and click-navigation fixtures; source values are not copied |
| [San Diego Digital Archives](https://www.sandiego.gov/digitalarchives/historicalocd/minutes) | Deep wrapper trees, malformed HTML, many script-only links, 6 pages sampled | Separate deep-wrapper and JavaScript-only-link operators now appear in source-first high-noise studies |

Class churn, malformed tags, reordered fields and duplicate IDs are deliberately constructed adversarial cases. The bounded analyzer reports observable signals, not a full HTML or accessibility conformance audit; these samples cannot establish how common any defect is across a whole site.

The bounded comparison at `outputs/sample-comparison-20261007/comparison.html` covers eight public-site attempts, 34 analyzed pages, and 13 observed issue categories. The RFC index timed out and an older Brea hostname failed certificate validation, so those attempts have zero analyzed pages and are not counted as successful crawls. The report includes robots state, crawl limits, DOM depth and issue-to-operator mappings, not copied page prose. A mapping means a corresponding fictional test setting exists; it does not mean the real HTML was reconstructed or its true page clusters are known. Run `node scripts/reference-comparison.mjs` to rebuild it from saved bounded crawl evidence. The current [San Diego study](outputs/reference-study-sandiego-targeted/report.html) has clean, high and targeted fictional variants with the same canonical hash. Its targeted answer key records all four mapped operator types; the report distinguishes configured from actually applied operators. The study command is `node scripts/site-study.mjs --url <public-url> --out <new-directory> --skip-contrast`. It obeys robots and tight page/time limits.

Two follow-up scans exercised the analyzer against different listing conventions: the [book-card recheck](outputs/reference-study-books-cards-v3/report.html) detected 20 sibling product cards and recovered a full title from a link attribute, while the [quote recheck](outputs/reference-study-quotes-cards/report.html) detected 10 explicit microdata records. These are observations, not verified live-site answer keys. The generator still constructs its fictional records and private answers before rendering.

The generator interface follows clear hierarchy, familiar controls, restrained surfaces and responsive organization from [Apple's design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) and [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout). Generated legacy sites intentionally do not follow the clean dashboard aesthetic.

### Open-Source Test Research

GitHub star counts were checked through the GitHub REST API on 2026-09-30, with Faker and fast-check rechecked on 2026-10-01; they change over time. Popularity is a discovery filter, not proof of coverage. Only ideas were adapted into independently authored fictional cases: no upstream fixture corpus, real website content or remote scripts were copied or executed.

| Repository | Stars / license | Relevant evidence and application |
| --- | --- | --- |
| [parse5](https://github.com/inikulin/parse5) | 3,937 / MIT | Already used as the HTML parser; [html5lib parsing tests](https://github.com/html5lib/html5lib-tests) inform malformed/nested HTML checks. html5lib-tests itself has 262 stars and is MIT; it is a specialist exception to the 500-star preference. |
| [Mozilla Readability](https://github.com/mozilla/readability) | 11,473 / Apache-2.0 | [Extraction regression tests](https://github.com/mozilla/readability/blob/main/test/test-readability.js) informed hidden boilerplate, competing metadata, repeated navigation and title decoys. This generator does not run or claim to pass the Readability corpus. |
| [Web Platform Tests](https://github.com/web-platform-tests/wpt) | 6,202 / BSD-3-Clause per repository LICENSE.md | [Ambiguous ampersands](https://github.com/web-platform-tests/wpt/blob/master/html/syntax/parsing/ambiguous-ampersand.html) inform text/entity boundaries. No browser-conformance claim; GitHub's license metadata returned NOASSERTION. |
| [httpbin](https://github.com/postmanlabs/httpbin) | 13,635 / ISC | [HTTP endpoint implementation](https://github.com/postmanlabs/httpbin/blob/master/httpbin/core.py) informed local status, delay, MIME and redirect fixtures. Tests do not call public httpbin. |
| [badssl.com](https://github.com/chromium/badssl.com) | 3,050 / Apache-2.0 | HTTPS/certificate test reference. This project implements local self-signed preview trust/rejection only, not the full badssl matrix. No upstream certificate authority is installed or trusted. |
| [fast-check](https://github.com/dubzzz/fast-check) | 5,166 / MIT | Installed and pinned for 1,500 generated random-site property cases spanning page count, seed, randomness, framework, protocol and challenge. Its [string boundary guidance](https://fast-check.dev/docs/core-blocks/arbitraries/primitives/string/) also informed six fixed text cases. The property runner reports a replay seed and shrink path on failure. |
| [Faker](https://github.com/faker-js/faker) | 15,502 / MIT | Existing seeded fictional-record generator; [usage guidance](https://fakerjs.dev/guide/usage.html) calls for pinned versions and fixed reference dates for reproducibility. This project pins Faker and uses deterministic source dates. |
| [old-coder](https://github.com/amazingang/old-coder) | 745 / MIT | Evidence-first workflow informs reproducible checks, recorded failures and explicit limits; this is not a full protocol-compliance claim. |

**Second research pass (2026-11-02): what could make SiteForge better.** Star counts were read from the GitHub pages that day; they change.

| Source | What it does | What SiteForge could take from it | Status |
| --- | --- | --- | --- |
| [Sitebulb crawler test site](https://crawler-test-site.uk.sitebulb.com/) | About 30 groups of crawler fixtures, each with an expected result in a machine-readable `/manifest.json` | SiteForge already covered most groups (76 crawler traps, ten response conditions; `rel="next"`/`rel="prev"` hints were already in `rel-link-hints`). Four gaps are now traps (generator 1.8.0): infinite scroll that updates the address with `pushState`, extra `<title>` elements, structured data that contradicts the page, and right-to-left text. Still open: "canonical to page 1" on paginated listings and title-less pages | Mostly added |
| [trafilatura](https://github.com/adbar/trafilatura) evaluation (about 7,000 stars, Apache-2.0) | Scores main-text extraction with "must include" and "must not include" text snippets per page (menus, footers, social links) | An optional per-page list of boilerplate text that a migration must *not* carry over (cookie banner, menus, newsletter box, hidden boilerplate). Today the answer key says what must be extracted, not what must be left out | Proposed; changes the answer key, so it waits for the Smartcite comparison (requirement 27) |
| [scrapinghub article-extraction-benchmark](https://github.com/scrapinghub/article-extraction-benchmark) (378 stars, MIT, archived) | One `ground-truth.json` keyed by page, with precision, recall and F1 computed by a small dependency-free `evaluate.py` | SiteForge already had this: `node src/cli.mjs evaluate` scores coverage, clusters, content types, fields and relationships. It now also scores listing records | Done (see *Scoring a tool's output*) |
| [WebMainBench](https://huggingface.co/datasets/opendatalab/WebMainBench) (Apache-2.0) | 7,809 human-labelled pages, each tagged Simple, Mid or Hard by DOM complexity, text sparsity and link density | A difficulty tag per page from the noise plan, so results can be reported by difficulty | Proposed |
| [WordPress theme test data](https://github.com/WordPress/theme-test-data) (667 stars) | The official WordPress import files of awkward content (long titles, nested lists, alignment, blocks) used to test themes | Ideas for more edge-case records; SiteForge already has boundary text values | Reference |
| [WordPress Importer](https://github.com/WordPress/wordpress-importer) (89 stars, GPL-2.0) | Imports WordPress export files (WXR): posts, pages, custom types, comments, terms, authors | A WXR export of a site would let migration tools that read WordPress export files be tested directly | Not built (decided 2026-11-02): Smartcite crawls websites, it does not read export files, and the official importer runs post content through WordPress's filters, so the generated `<main>` would no longer match the answer key. The theme package already gives a real WordPress install with exact content |
| [Web Scraper test sites](https://webscraper.io/blog/best-web-scraping-test-sites) and [toscrape](https://books.toscrape.com/) | Practice sites for link pagination, load-more buttons, infinite scroll and login walls | Already covered by SiteForge's listing pagination and the `load-more-pagination` and `login-wall-links` traps | Covered |

Crawler behavior references: [Scrapy's link extractors](https://docs.scrapy.org/en/latest/topics/link-extractors.html) document link filtering and duplicate handling, [Crawlee's relative-link example](https://crawlee.dev/js/docs/3.15/examples/crawl-relative-links) shows same-hostname traversal, and [Google Search Central](https://developers.google.com/search/docs/crawling-indexing/canonicalization) describes duplicate URL signals. These informed the generated site's alternate links and a local discovery test. The test does not claim to reproduce a search engine's indexing decisions.

An October 9 comparison with [Scrapy's link-extraction tests](https://raw.githubusercontent.com/scrapy/scrapy/master/tests/test_linkextractors.py) checked the relevance of relative/absolute URLs, JavaScript navigation, duplicates, base elements, encoded paths and `nofollow`. SiteForge independently tests real JavaScript-only navigation across its three frameworks and five link modes, including the opt-in document-base mode; generated `nofollow` annotations remain a gap. [WPT URL vectors](https://raw.githubusercontent.com/web-platform-tests/wpt/master/url/resources/urltestdata.json) remain a reference, not an imported or executed corpus. The [html5lib-tests README](https://github.com/html5lib/html5lib-tests) now points to WPT as the maintained home of HTML tree-construction tests. These sources do not establish that SiteForge passes their suites.

CMS signatures were checked against [WordPress block markup](https://developer.wordpress.org/block-editor/getting-started/fundamentals/markup-representation-block/), [WordPress post classes](https://developer.wordpress.org/reference/functions/get_post_class/), [Elementor widget wrappers](https://developers.elementor.com/docs/widgets/widget-inner-wrapper.html), and the [Drupal node template](https://api.drupal.org/api/drupal/core!themes!stable9!templates!content!node.html.twig/main). They are representative HTML patterns, not pixel-perfect or version-complete emulations. The Elementor fixture deliberately keeps the older inner wrapper; [Elementor's 3.26 guidance](https://developers.elementor.com/elementor-3-26-developers-update/) describes a newer optimized form without it. CMS markup should not accidentally violate the [HTML main-element ancestor rules](https://html.spec.whatwg.org/multipage/grouping-content.html#the-main-element); malformed markup is a separate selected noise condition. [Google's faceted-navigation guidance](https://developers.google.com/crawling/docs/faceted-navigation) and [canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/canonicalization) inform URL-variant tests; canonical tags are signals rather than a guaranteed crawler decision.

The Beaver Builder profile follows its documented [layout grid hierarchy](https://docs.wpbeaverbuilder.com/beaver-builder/developer/how-to-tips/html-css-and-javascript-reference/), [default div wrappers and node attributes](https://docs.wpbeaverbuilder.com/beaver-builder/layouts/advanced-tab/html-element/), and [HTML module](https://docs.wpbeaverbuilder.com/beaver-builder/layouts/modules/html/). It represents a conventional single-column grid with invented content, not newer Box layouts, every module/version, generated plugin CSS/JavaScript or an installed WordPress database. A distinct DOM structure is the test input; the logical source fields and clusters remain independent of the builder.

Literal markup and instruction-like text remain escaped source data, not executable scripts or generator instructions. Unicode spelling is retained except for the documented source normalization of HTML line endings, NUL and lone surrogates. These are fixed bounded examples, not all Unicode sequences or malformed byte encodings.

## Artifacts and Privacy

```text
.fixture-lab/jobs/<job-id>/
  job.json                         parameters, state, completed site counts
  plan.json                        private resolved plans and request hash (new jobs)
  handoff/<site-id>.siteforge.test/ private evaluator copy, not a public web root
    index.html                     redirects to ./website/index.html
    answer-key.json                complete private expected results
    metadata.json                  resolved configuration, coverage and provenance
    website/                       copy of public website files
  sites/<site-id>/
    index.html                      local launcher into public/index.html
    public/                        HTML, CSS, local images/bundles, sitemap
    private/
      config.json                  resolved per-site settings
      metadata.json                resolved profiles, counts, and provenance
      canonical.json               source records before noise
      answer-key.json              validated source-first page inventory and expected answers
      ground-truth.json            byte-identical compatibility alias for saved consumers
      transport.json               private source-defined HTTP response plan
      manifest.json                hashes and version provenance
      run.json                     generation status/timing
      tls/                         lazily created local certificate and private key
```

The answer key keeps the existing JSON shape: `site`, `schemas`, `schemaDefinitions`, and exactly one entry in `pages` for each source URL. Every page includes `pageId`, `url`, `contentType`, `expectedCluster`, observed `fields`, original `canonicalValues`, `fieldStates`, `relationships`, links, and actual `noiseEvents`. `transport` records preview-only retrieval overrides. The generator validates uniqueness, count, schema/cluster membership, states, local references, canonical identity, recorded defects and transport targets before writing one JSON serialization to both private filenames. It rejects inconsistent answers instead of exporting them. `fields` describes the rendered source HTML, while `canonicalValues` retains pre-noise values; a removed field is marked absent. The `/answers` inspector and `download?kind=answers` retain their JSON response contract, with the download named `*.answer-key.json`. Old jobs with only `ground-truth.json` remain downloadable.

For an external Smartcite check, keep the private JSON on the fixture-owner side and send Smartcite only the public preview URL or ZIP. Join Smartcite's returned page URLs to `pages[].url` after accounting for the preview origin. Compare extracted records against observed `fields` only when `fieldStates[field]` is `present`; compare grouping to `expectedCluster`; compare links/relations to local URLs. Use `transport.rules[].expected` to classify intentionally unavailable or redirected pages before scoring extraction. For example, a `missing-field` event leaves its canonical value in `canonicalValues` but marks the observed field `absent`, so a candidate should not be penalized for omitting that field. No Smartcite accuracy result is claimed by generating a fixture.

Public ZIPs contain only `public/`. New core-generator private directories and answer-inspection chunks use owner-only POSIX permissions (`0700` directories and `0600` files), including configuration, metadata and retained failure diagnostics. A subprocess regression verifies completed and interrupted generation even with a permissive process umask; Windows skips this POSIX-only assertion. Existing saved files are not changed. Preview servers serve only the public realpath and deny private/traversal/symlink escapes. Preview canonical URLs, sitemap locations and robots sitemap declarations are rebased in memory to the preview origin; stored artifacts and private source data remain unchanged. Intentional malformed source markup must survive that rebasing. Production tracing explicitly excludes saved runtime data; `npm run build` fails if any deployment trace still contains it. This guard was observed failing against the prior leaking build before the exclusion was added, and its unit test rejects known private-data paths.

**Download test set** exports the whole batch as a private evaluator ZIP, using the `handoff/` domain-folder structure above. It intentionally includes answer keys and must not be hosted as a public web root or supplied to the tool being evaluated. Share only `website/` or the public-only ZIP with Smartcite. The ZIP is streamed from original runtime sources, not potentially edited handoff copies. Saved older jobs receive the same ZIP layout without altering their on-disk artifacts. New handoff files are copies, not hard links, so editing them cannot alter the original answer key. The audit reports any divergence in these copies. A packaging failure preserves access to completed source sites and their individual downloads, while the batch remains failed.

`metadata.json` now includes the full resolved `configuration` and actual `coverage.counts`/`coverage.affectedPages`. The local-folder disclosure gives the saved evaluator path. Opening `index.html` directly may not support fully qualified links or JavaScript module bundles; the public preview is the supported browser test path. Private previews do not require system hostname configuration.

Generated batch sites use stable `<site-id>.siteforge.test` origins in their saved files. Downloaded ZIPs retain those synthetic origins; point a consumer at a running preview or gateway instead of treating the hostname as a public internet endpoint. A CLI config can still set `site.baseUrl` for a separately deployed fixture.

### Excluded Host Setup

No `/etc`, hosts-file or system DNS setup is part of the current workflow. The old gateway utility, container configuration and legacy saved hosts download remain for backward compatibility, but are not invoked by generation or advertised as required setup. Docker execution and permanent remote hosting remain unverified and outside this request.

Jobs are isolated by UUID. Existing generated directories are never overwritten. Worker failures retain completed sites and report failure; a crash is not relabeled successful. Requests validate types/budgets and require the local application origin for state changes. No AI credentials or paid generation service are used.

## API

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/fixtures` | Validated config; optional boolean `freshSeed` chooses a seed absent from saved jobs; 202 with `{job}`; 409 if another batch owns the lock |
| GET | `/api/fixtures` | `{jobs}` with saved generation states |
| POST | `/api/fixtures/random` | Optional seed and challenge, 5-100,000 pages, optional `randomPageCount` (the pages value becomes a maximum), or legacy 0 for random 5-200, 0-100 randomness, framework and protocol; omitted seed is fresh, explicit seed replays; creates one source website and answer key |
| GET | `/api/fixtures/catalog` | Paginated/filterable 3,120-case metadata registry (1,440 core + 1,680 real-world; `set` filter); no answer keys |
| POST | `/api/fixtures/catalog` | `{mode:"all"}` or `{mode:"single",caseId:"case-0008"}`; optional name/seed; 202 with saved job |
| GET | `/api/fixtures/<id>` | `{job}` and actual site counts |
| GET | `/api/fixtures/<id>/download` | Private evaluator ZIP for a completed batch; domain folders, website copies, answers and metadata |
| GET | `/api/fixtures/<id>/download?kind=wordpress` or `kind=drupal` | One ZIP with every website's WordPress theme or Drupal package (each inner ZIP installs on its own), streamed without temporary files; no answer keys. Websites over 100,000 pages are listed in its README.txt instead. A website that cannot be packaged becomes a `<name>.ERROR.txt` note rather than a truncated ZIP, and 409 is returned when no website fits |
| GET | `/api/fixtures/<id>/hosts` | Legacy saved-file compatibility only; new jobs return 404 |
| POST | `/api/fixtures/<id>/sites/<siteId>/preview` | `{url}` for an isolated public-only origin |
| GET | `/api/fixtures/<id>/sites/<siteId>/answers` | Full streamed private JSON; add `?offset=0&limit=25&q=book` for bounded inspection, schema definitions and full-site coverage; legacy-file fallback retained |
| GET | `/api/fixtures/<id>/sites/<siteId>/download?kind=public` | Public website ZIP |
| GET | `/api/fixtures/<id>/sites/<siteId>/download?kind=answers` | Separate private `*.answer-key.json` attachment |
| GET | `/api/fixtures/<id>/sites/<siteId>/download?kind=wordpress` or `kind=drupal` | `*-wordpress-theme.zip` / `*-drupal-theme.zip`, which installs the site into a real CMS; public content only, no answer key. 413 for websites over 100,000 pages (the app hides these buttons for such websites) |
| POST | `/api/fixtures/<id>/sites/<siteId>/score` | Scores a tool's output for that website (body: the output JSON, or `{actual, options}`; up to 50 MB) and returns `{report}`; 400 with the reason when the output does not match the format. The answer key is not returned (2026-11-02) |
| GET | `/api/fixtures/<id>/sites/<siteId>/certificate` | Public test certificate only, after starting that site's HTTPS preview |

The UI maps mixed settings to concrete, stable per-site plans on the server. Answer keys are built from those plans, never extracted from a preview or crawler.

## CLI

```bash
node src/cli.mjs validate examples/library.yaml
node src/cli.mjs generate examples/library.yaml --out outputs/library-clean
node src/cli.mjs pair examples/library.yaml --noise high --out outputs/library-pair
node src/cli.mjs serve outputs/library-clean --port 4310
node src/cli.mjs cms-theme outputs/library-clean --cms wordpress --out outputs/library-wordpress.zip
node src/cli.mjs batch examples/suite.yaml --out outputs/fixture-suite
node src/cli.mjs generate examples/adversarial-library.yaml --out outputs/adversarial-library
node src/cli.mjs serve outputs/adversarial-library --port 4310
```

Use new output directories for each run. Core generation accepts 5-100,000 pages per site and explicit content schemas; the UI also enforces a 100,000-page aggregate batch budget. These validation limits are not guarantees of hardware capacity. The retained crawler, evaluation utilities, PagePilot code and WordPress API are legacy experiments and are not invoked by the generator workflow.

For a completed UI/API batch, audit the saved source plans, answer keys, metadata, manifests and SHA-256 of every public and handoff file. Historical hosts mappings are checked only when present:

```bash
npm run audit:job -- <job-id>
```

The command writes `outputs/job-audits/<job-id>.json`, exits nonzero on any discrepancy, and never treats a generated completion label as an accuracy score for Smartcite. A negative test changes one generated HTML file and confirms the audit rejects it.

## Scoring a tool's output (2026-11-02)

**The output format.** A crawler or migration tool such as Smartcite reports one JSON file per website. `examples/smartcite-output.schema.json` defines it, and `examples/smartcite-output.example.json` shows one:

```json
{ "version": 1, "tool": "smartcite 1.0",
  "pages": [
    { "url": "/books/", "cluster": "listing-a",
      "repeatedItems": [{ "url": "/books/000001-meadow-and-map/", "fields": { "title": "Meadow and Map" } }] },
    { "url": "/books/000001-meadow-and-map/", "cluster": "group-7", "contentType": "book",
      "fields": { "title": "Meadow and Map", "author": "Rogers Predovic" },
      "relationships": [{ "type": "author", "targetUrl": "/authors/000001-rogers-predovic/" }] } ] }
```

- `url` and `cluster` are required for each page. Cluster labels are free text: scoring checks which pages share a label, not what it says.
- `contentType`, `fields`, `relationships` and `repeatedItems` (records listed on a listing page) are optional. Each is scored when present and reported as "unavailable" when missing, never as zero.
- URLs can be absolute or relative to the site; fragments are ignored and query strings count. Values are compared after Unicode NFC, trimming and collapsing whitespace.
- Different names are mapped with an options file (`contentTypeMap`, `fieldNameMap`, `fieldNormalizers`, `dateFields`, `dropQueryParams`); `examples/normalization.json` is a sample.

This is the format the scorer already accepted before 2026-11-02; only `repeatedItems` is new. It was chosen because it matches what the answer key can check. If Smartcite's real output differs, a small adapter converts it rather than changing the answer key.

**Scoring in the app.** In **Saved test sets**, each website has a **Score** button. Choose the tool's output file for that website, and a summary appears under it: pages found, extra URLs, cluster F1, content type, field F1, relationship F1 and listing records F1. A link downloads the full report. The answer key never leaves the app's server; only the report comes back. `npm run test:score-upload` checks this in a browser at 1440 and 390 px:
- a perfect result scores 100%
- a half result shows 50% coverage
- a non-JSON file and malformed output show clear messages
- no accessibility violations or overflow

**Scoring from the command line.** `node src/cli.mjs evaluate --truth <site>/private/answer-key.json --actual <output.json> --out <dir> [--options <file>]` writes `report.json`, `report.csv` and `report.html`. It reports:
- coverage: answer-key pages found, plus extra URLs reported
- clustering: pairwise precision/recall/F1 and adjusted Rand index
- content-type accuracy
- field presence and field-value F1
- relationship F1
- listing records: records found and their field-value F1 (new 2026-11-02). Records reported on pages that list none in the answer key count as false positives (and are also counted on their own). A record without a link pairs with an expected record only if at least one value matches. Listing pages reached without any records reported count as missed records
- breakdowns by noise type and diagnostics for the first mismatches

**Offline baseline benchmark.** `npm run benchmark:baseline -- <site-dir> [...] [--crawler pagepilot|http|browser] [--cms-url <url>] [--out <dir>]` runs one of SiteForge's own bundled crawlers on each generated site and scores it exactly as a Smartcite result would be scored. Everything stays on this machine:
- each site is served on a loopback preview (links rewritten to the preview address, as in the app), or a WordPress/Drupal install with `--cms-url`
- the answer key is read only after crawling finishes
- each site gets `predictions.json` (in the output format above), the reports and a crawl summary; the run gets `summary.md`
- these crawlers are simple reference points, not competitors for Smartcite. The *pagepilot* and *http* crawlers do not run JavaScript; *browser* renders pages in Chromium first. All stop at 500 pages

**First baseline results (2026-11-02).** Twenty generated sites were scored, averaged by group below:
- the 12 sites from the profile matrix: plain HTML, 30 pages, medium noise, one per markup profile
- the 8 sites from the random sweep

The *pagepilot* crawler was also run on WordPress and Drupal installs of three of them.

| Crawler | Sites | Coverage | Cluster F1 | Field F1 | Listing records F1 |
| --- | --- | --- | --- | --- | --- |
| pagepilot | Plain HTML, 12 markup profiles | 100% | 75% | 91% | n/a (not reported) |
| pagepilot | Random HTML sites (3) | 69% | 35% | 84% | n/a |
| pagepilot | Random React/Angular sites (5) | 20% | 0% | 4% | n/a |
| http | Plain HTML, 12 markup profiles | 100% | 28% | 70% | 95% |
| http | Random HTML sites (3) | 88% | 31% | 54% | 100% |
| http | Random React/Angular sites (5) | 20% | 0% | 0% | 0% |
| browser | Plain HTML, 12 markup profiles | 100% | 28% | 70% | 95% |
| browser | Random HTML sites (3) | 83% | 34% | 54% | 100% |
| browser | Random React/Angular sites (5) | 73% | 20% | 55% | 95% |

What the numbers show:
- **Answer keys and scorer work end to end.** Scores move the way the sites' difficulty says they should.
- **Clustering by structure beats clustering by field names.** pagepilot clusters plain HTML sites well (75% F1). The simple crawlers group pages by field names only (28%).
- **Markup profiles change clustering.** AEM, Ghost, Webflow, HubSpot and Sitecore markup lowered pagepilot's cluster F1 to 56–67%; plain markup scored 88%.
- **JavaScript sites need a browser.** Without one, React and Angular sites expose only about a fifth of their pages; with the browser crawler, coverage rises to 73%.
- **Response conditions bite.** One random site's server-error condition made pagepilot stop politely at a 429 response after 24 requests, having reached 6 of the site's 25 pages (24% coverage). The simple crawlers do not follow redirects, so trailing-slash redirects show up as failed URLs.
- **Listing records are easy for a heuristic, with some false positives.** The simple crawlers found every record on the listing pages they reached. Their scores fall to 95% because they also report record-like blocks on pages that list none, such as home-page features. Without a browser, React and Angular listings show no records at all (0%).
- **CMS installs:**
  - On WordPress and Drupal installs of the plain site, pagepilot scored the same as on the preview (100% / 88% / 89%).
  - A high-noise HTML site scored 100% coverage on both CMSs against 92% on the preview, but its cluster F1 stayed low (15–17%).
  - A React site rendered in the CMS stayed at 20–40% coverage without a browser.

These are SiteForge's simple reference crawlers, measured to show the scoring works. They say nothing about how Smartcite will score.

## Test Strategy

BDD scenarios are executable Gherkin under `features/`; Cucumber JS runs them. Scenarios tagged `@planned` remain a backlog, not passing evidence. The Test lab at `/test-lab` separates executable scenarios from planned specifications.

```gherkin
Scenario: Optional fields do not split a known book structure
  Given a fixture request with scenario "legacy-clutter" and framework "html"
  When the fixture source model includes optional fields
  Then book pages with and without their optional summary share one expected cluster
  And book pages with and without their optional cover share one expected cluster
```

| Layer | Acceptance checks |
| --- | --- |
| Source model | Exact page count and unique URLs; fields/clusters exist before rendering; optional absence keeps schema membership |
| Extraction locations | Private source-planned page and repeated-item selectors, exact read methods, optional absence, table/list representations, preserved whitespace, tamper rejection and older-key compatibility |
| Single-site scale | One actual 100,000-page site; exact answer inventory, 100,012 public-file and ZIP hashes, three sitemap shards, full JSON export, paginated answer inspection and bounded progress |
| Noise | Each of 28 operators alone, two seeds; expanded operators in three layouts; 351 non-delayed pairs; event caps; clean zero-mutation behavior; no false field-list wrapper events on rich listings or after last-field removal |
| CMS signatures | Six CMS/builder profiles across HTML/React/Angular; main landmark hierarchy, explicit clean-source div closures, unchanged source truth, exact page/repeated-item extraction and optional absence; representative markup rather than actual CMS installations |
| Text boundaries | Six fixed entity, normalization, international, whitespace, literal markup and instruction-like strings in three renderers and three layouts (54 combinations); no script execution or truth rewriting |
| HTTP | Ten local conditions, GET/HEAD, bounded delay/retry metadata, finite chain and loop, malformed manifests, healthy home, private answers never served |
| HTTPS | Certificate SANs/permissions, untrusted rejection, explicit-CA success, HTTPS response rules/rebasing/privacy and preview reuse |
| Catalog | Exactly 1,440 unique behavior configurations and 23,040 actual pages; artifact digests, deterministic replay and configured/observed coverage |
| Random generation | 5/200 smoke cases, 100,000-page boundary acceptance, invalid 4/100001 and factor rejection, seed-zero replay, fresh-seed uniqueness, 1,500 property cases for inventory/links/fields/cluster/noise contracts, bounded replay/DOM checks, actual public HTML and separate persistent JSON download |
| Harder fixtures | 16 selected three-operator interactions, including parser recovery with heading/metadata decoys; 5/200-page boundaries across all 10 domains; clean/hard/extreme semantics; 12 injected invalid-answer controls; private answer alias and legacy fallback |
| Site variety and discovery | All four seeded site structures, four detail arrangements, richer repeated listing records and image variants; a 60-page local HTTP crawl from home using same-origin links and alternate URLs; public assets and answer-key privacy; zero-randomness compatibility |
| Determinism | Repeat resolved plan, source model and generation; compare logical URLs, answers and canonical hashes excluding timestamps |
| Privacy | Public ZIP/bundles/preview contain no answer keys; private and traversal requests return not found |
| Job API | Strict parameters and aggregate budget; same-origin requirements; ownership checks; concurrent starts reject; orphan recovery retains results |
| Preview | Real page/assets/deep link, correct canonical and sitemap origin, unchanged disk artifacts, raw malformed markup preserved |
| Browser UI | Actual 60-page/all-response generation, saved progress, ZIP/answer download, inspector/search, Coverage counts, real error responses, reload persistence, mobile/desktop overflow and axe scans |
| Frameworks | HTML with source-visible content, actual React/Angular bundles and browser-ready content; no-JS differences disclosed |
| Regression | Existing Node, API, engine, evaluation, BDD and legacy layout tests remain runnable |
| Mutation | Separate Stryker targets for the reference structure engine, page-field planner and repeated-item planner; not generator/API/whole-app coverage |

Run `npm run verify` after starting the local server. It runs all configured layers, saves logs/screenshots and checks a source-tree hash before and after. It selects cached Node 24 here when the shell uses unsupported Node 23. For a clean machine, install Node 24 explicitly.

**UI and storage refinement, October 9:** Create and Saved test sets now have separate desktop/mobile views, grouped settings and a confirmed Delete action. Fresh checks passed 432 Node tests, 119 Cucumber scenarios/714 steps, eight API tests, TypeScript and the production build's 27 privacy traces. Four-width browser checks cover navigation, invalid inputs, request recovery and modal keyboard behavior. Real browser runs verified a 60-page site and exact replay, all ten response conditions, public/private ZIP and JSON separation, catalog generation, seeded random API compatibility, a 200-page boundary and extreme noise. Real UI cancel/delete was also verified against two owned five-page sets. The tests removed their own generated jobs and downloads, and the live saved list was empty afterward. Evidence: `outputs/refinement-20261009/ui-redesign/`. Initial failures in two outdated browser scripts (redirect response-body capture and missing same-origin headers) were corrected and retained alongside passing reruns. No new scale corpus, mutation run, remote CI execution or Smartcite accuracy result is claimed here.

Run `npm run test:cms-markup` for the bounded CMS browser matrix alone. It checks 18 framework/profile combinations against source-defined page and repeated-item locations, captures representative desktop/mobile fixtures, and records evidence under `outputs/cms-browser/` (override with `SITEFORGE_CMS_OUTPUT`). This check is included in local verification and the GitHub workflow; the workflow has not been run remotely during this refinement. The real generator UI regression now selects Beaver Builder by default; `SITEFORGE_TEST_BUILDER=elementor npm run test:generator-ui` retains the alternate Elementor check.

**Eighth refinement, October 19 (review session):** All tests and test helpers now locate files with `fileURLToPath`. Before this fix, `new URL(...).pathname` turned the space in this project's folder name ("Siteforge files") into `%20`, so three Node tests failed and `src/contrast-audit.mjs` pointed at a nonexistent browser folder. Generator 1.6.0 adds the CMS fingerprints described above, with two new regression tests in `test/cms-markup.test.mjs`. Fresh verification in a Linux VM on this machine: TypeScript passed, 434/434 Node tests, 8/8 generator API tests and 119 BDD scenarios/714 steps. The CMS browser matrix passed 18 combinations, 162 pages, 324 page fields and 1,062 repeated fields. Also passed: the all-noise field-location matrix (78 pages), the JavaScript-only link matrix (15 combinations) and the preview-rebase check. Not rerun: the Next.js UI browser check, Stryker, scale runs, and anything requiring hosts or Docker. Pre-edit copies of the changed files are in `.claude-review-backup/2026-10-19/`. Follow-up the same day: the Pages per site field now means exactly that many pages. A new **Random page count per site** checkbox (`randomPageCount` in the API) turns it into a maximum, with sizes up to 100,000 that share the set's 100,000-page budget. **Randomize settings** ticks it. New tests are in `test/random-page-count.test.mjs`. A 4-site random job generated and passed the full job audit. After this change: 439/439 Node tests, 8/8 API tests, 119 BDD scenarios and TypeScript passed.

**Seventh refinement, October 9:** The generator remains 1.5.0; this pass changes validation and job lifecycle, not fixture content. Fresh checks passed 422 Node tests with no skips, 119 BDD scenarios/714 steps, seven API checks, TypeScript and 27 production privacy traces. Controlled success/failure regressions reproduced terminal status being published while the old generation lock was still held, then passed after the ordering fix. Invalid-input feedback and recovery passed at 320, 390, 760 and 1440 pixels; separate browser recovery checks passed request cancellation, retries and stale-response masking. A real 60-page generation and replay passed JSON/ZIP downloads, all ten response conditions, privacy, answer inspection and desktop/mobile checks. New and preserved sixth-pass jobs passed full artifact audits. Production API checks rejected all three impossible random-builder/CMS combinations. Evidence: `outputs/refinement-20261009/seventh-pass/`. The original intermittent API 409, initial test-helper import mistake and cloud-backed baseline timeout are retained alongside the corrected deterministic RED/GREEN checks. The earlier CMS matrices, scale and mutation scores are not represented as fresh runs in this pass.

**Sixth refinement, October 9:** Generator 1.5.0 adds the Beaver Builder profile and rejects ignored fixed-catalog overrides at the new-job boundary, without changing historical read/audit parsing. Fresh verification passed 419 Node tests with no skips, 116 BDD scenarios/699 steps, seven API checks, TypeScript and 27 production privacy traces. The CMS browser matrix passed 18 combinations, 162 pages, 324 page fields and 1,062 repeated fields. The independent all-noise matrix again passed 78 pages, 185 page fields, 618 repeated fields and 128 boundary values. Pre-existing explicit CMS profiles produced byte-identical HTML on 135 sampled pages compared with the 1.4.0 renderer. The real UI generated a 60-page WordPress/Beaver Builder site with document-base-relative links, verified the private evaluator ZIP and public website ZIP, all ten response conditions, exact same-version replay, answer inspection and desktop/mobile accessibility checks. New 1.5.0 and preserved 1.4.0 jobs passed full artifact audits. Eight unsupported catalog requests also returned field-specific errors against the production app. Evidence: `outputs/refinement-20261009/sixth-pass/`. A source-level regression caught an initially missing closing div; a noisy-class assertion and BDD type narrowing were corrected before final passing checks. The isolated worker's initial full-suite run lacked its copied workflow fixture; the integrated suite includes it and passed. Earlier scale and mutation reports remain historical, not reruns for this version; installed CMS, remote CI and Smartcite accuracy are still unverified.

**Fifth refinement, October 9:** Generator 1.4.0 passed 411 Node tests with no skips, 112 BDD scenarios/678 steps, six API checks, TypeScript and the production build's 27 privacy traces. The CMS browser matrix checked 135 pages, 270 page fields and 885 repeated fields across 15 combinations; all seven configured noise types and optional presence/absence were observed. The independent all-noise location matrix passed 78 pages, 185 page fields, 618 repeated fields and 128 boundary values, observing all 28 operators across its profiles. Non-CMS rendering remained byte-identical to the previous renderer on 90 sampled pages. Actual UI generation with WordPress/Elementor and Document base relative selected passed downloads, private/public separation, exact replay, all ten response conditions and desktop/mobile checks. New 1.4.0 and preserved 1.3.1 artifacts passed full audits. Evidence: `outputs/refinement-20261009/fifth-pass/`, including failing pre-fix CMS/noise baselines and successful regression tests. Initial test-authoring errors in a BDD expectation/type narrowing and the new UI selector were corrected and rerun; their logs remain available. No new scale or Stryker run, installed CMS comparison, remote CI execution or Smartcite accuracy result is claimed for this version.

**Fourth refinement, October 9:** 407 Node tests passed with no skips, 104 BDD scenarios/631 steps passed, six generator API checks passed, and TypeScript plus the production build's 27 privacy-trace checks passed. Real UI generation and byte-exact replay passed with Document base relative selected, including private/public ZIP contents, answer inspection, all ten response conditions and mobile/desktop accessibility/layout checks. New 1.3.1 and preserved 1.3.0 jobs passed complete artifact audits. Both link-navigation and preview-text checks passed all 15 framework/link-mode combinations. The focused base-relative browser check independently verifies nested source edges, declared cover-image extraction, CSS/images, same-page skip behavior, related-page clicks and React/Angular hydration. The new repeated-planner Stryker result is 107/110; the 20,000-page 1.3.0 measurement above is separate. The private-permission regression has a recorded failing baseline and passing fix. Evidence: `outputs/refinement-20261009/fourth-pass/`. No new 100,000-page run, remote CI execution or Smartcite result is claimed.

Previous completion checks (2026-10-09, third refinement): 393 Node tests passed with no skips using `node --test --test-concurrency=4 test/*.test.mjs`; 101 executable Cucumber scenarios and 615 steps passed; all six generator API tests passed. TypeScript and the production build's 27 private-data trace checks passed. The Node suite includes 1,500 sampled property cases, not exhaustive input coverage. Real desktop/mobile tests verified 60-page generation and exact replay, evaluator/public ZIP contents, private JSON downloads, repeated-item inspection, all ten response conditions, pagination and axe checks. Independent browser checks matched 185 page-field and 618 repeated-item locations on 78 pages across nine framework/layout combinations, including both listing representations, optional absence, 128 literal boundary-text values and all 28 supported noise types across the matrix. Separate preview rebasing checks passed all 12 framework/link-mode combinations with real navigation, literal source-origin text, rendered images and unchanged saved HTML. Mocked recovery checks proved list/job/answer timeouts, actual browser cancellation and retry; navigation checks passed at 320/390/760/1440px. New 1.3.0 and unchanged 1.2.1 jobs passed full file audits. Evidence is under `outputs/refinement-20261009/third-pass/`; it also preserves the original preview regression failure and the intermediate validation-order test failure corrected before the final passing suite. The earlier 100,000-page result used generator 1.2.0 and was not regenerated for 1.3.0. These are generator checks, not proof that Smartcite passes or that every real-world website is covered. Docker, permanent hosting and system hosts/DNS setup remain excluded.

`npm run test:mutation:generator` targets the actual source-location planner with seven independent expected-output cases. Stryker caught 117 of 118 mutations (99.15%), with no timeouts or errors; the remaining regex mutation is equivalent for valid field names that begin with a letter. The separate `npm run test:mutation` rerun caught 85 of 86 mutations (98.84%) in the reference structure engine. `npm run test:mutation:repeated` uses eight independent exact-output/guard tests and caught 107 of 110 mutations (97.27%), with no timeouts or errors. Its three survivors are a regex change affecting a leading newline (not a valid configured field name) and two changes to a scalar-position guard unreachable for ordinary validated string field names. No mutants were excluded to improve the score. Both planner checks have a 90% regression threshold. No generator-wide or whole-application mutation score is claimed. All three checks are wired into GitHub Actions; the workflow was not executed remotely during this local refinement.

Useful focused commands: `npm test`, `npm run test:generator-api`, `npm run test:generator-ui`, `npm run test:bdd`, `npm run test:mutation`, `npm run typecheck`, `npm run build`. The random property runner uses 1,500 cases by default with suite seed `20261001`; set `FC_SEED` and `FC_PATH` from a fast-check failure to replay its shrunk case. Each case checks the source and observed contract; 70 full replays and 45 rendered markup checks are bounded subsets in the fixed suite. This is sampling, not proof over all 32-bit seeds or all combinations. `test:pagepilot-ui` now aliases the generator browser check; the previous migration dashboard is no longer the root screen.

Historical batch evidence: `npm test` passed 354/354 Node cases; `npm run test:bdd` passed 92/92 executable scenarios and 553/553 steps; the fixed fast-check suite passed 1,500 cases. A core-generator 500-site, 100,000-page benchmark completed in 106 seconds with 294 MB peak RSS on Node 24/arm64. Separately, an app/API job generated 500 randomized sites and exactly 100,000 pages. `npm run audit:job -- b5e60e11-6fde-472e-854d-ece6ba7e43dd` verified all 500 site plans, 100,000 answer pages and 104,837 public-file hashes in 27 seconds. The local hostname gateway returned distinct sites under their own Host headers and denied a private answer request. These are batch-scale results, not proof that one 100,000-page site is supported or that Smartcite can process the batch. `npm run test:catalog -- --job 3a0af408-0876-4996-b1c8-71753678c867` rechecked all 1,440 saved catalog sites and 23,040 pages without changing their corpus. `node scripts/check-harder-demo.mjs` created a fresh, normal-transport, 200-page extreme legacy HTML job through the API and verified its public ZIP, private answer key, every preview URL, and private-path denial. That script creates another saved job when run again. The full `npm run verify` report records each layer, logs, and a frozen source hash under `outputs/verification/`.

The previous refinement checks passed all 354 Node tests, 92 BDD scenarios, five generator API tests, the TypeScript check, and desktop/mobile browser tests. Browser checks include exact replayed answer JSON and public-file bytes, all ten declared response conditions, private-path denial, accessibility scans and recovery from a saved-job load failure. Stryker detected 85 of 86 mutants (98.84%) in `src/engine/structure.ts`; this is not mutation coverage of the whole generator. Stryker now uses an isolated temporary sandbox. Each full-verification layer has a five-minute deadline and records timeout/termination evidence instead of waiting indefinitely.

Some local source, dependency and saved-job files had become cloud placeholders in macOS Documents. Their downloads were requested, and the previously unreadable job records are available again. The catalog page and package manifest were recovered from matching local snapshots with the originals preserved under `.cache/source-recovery-20261007/`. Builds in the original cloud-backed folder still hit the bounded timeout during this pass; two API cases also timed out during source retrieval. The same source in `/tmp/siteforge-production.b1hKZS`, with dependencies installed from the pinned lockfile, passed the production Webpack build, all 26 production privacy traces and all five API tests. This isolates the verified application behavior from the intermittent local filesystem issue. A live Docker container run and an actual Smartcite ingest/score run have not been completed here.

GitHub Actions use pinned actions, Node 24, automated tests and evidence uploads. The manual `catalog` option adds full 1,440-site generation and verification; matrix configuration tests and random/catalog UI checks run in the regular workflow. Public-site samples remain opt-in historical tests; no live crawl is required to generate fixtures. A local passing run does not mean GitHub-hosted CI was executed.

### Evidence-First Boundaries

The [old-coder workflow](https://github.com/amazingang/old-coder) informed the executable specification, negative controls and fresh-run evidence. Formal pre-implementation human SPEC approval was not obtained in this autonomous increment. The fixture-obstacles integration tests were observed failing against the missing scenario/transport implementation before it was added. Not every new test has a recorded RED run. No full compliance claim or independent old-coder verifier-protocol claim is made.

Current increment evidence: `outputs/refinement-20261009/`, including `handoff-browser/evidence.json`, `generator-mutation-verified/` and `single-site-scale-result.json`. `outputs/verification/latest.json` and the separate random/catalog/full-corpus evidence are historical unless their own timestamps indicate a later run. The harder 200-page demonstration and answer JSON are under `outputs/harder-demo/`. Earlier PagePilot evidence must not be cited as proof for the generator UI. No changed-line coverage, lint/complexity gate or randomized test-order runner is configured.

Dependency history: `adm-zip@0.6.1` is pinned for archive-reading tests and the retained legacy export code. Public generator ZIP creation now uses `zip-stream@7.0.5`. The earlier three-moderate-advisory result is historical; see the dated requirement review above for the current dependency audit. No automatic force-update was applied.

## Scrum Delivery

| Increment | Demonstration and definition of done |
| --- | --- |
| 1. Controlled source | Generate one 60-page legacy library; every page has a pre-render answer, cluster and fields; optional absence is explicit |
| 2. Realistic variation | Exercise each supported obstacle, mixed layouts and clean/noisy same-source comparisons; record actual mutations |
| 3. Usable local workspace | Form-to-generation-to-preview/ZIP/answer inspection passes browser checks; privacy and concurrent-start tests pass |
| 4. Candidate integration | Obtain Smartcite output format; review an adapter; hand-check small perfect/wrong outputs against untouched truth |
| 5. Expanded corpus | Twenty-nine bounded markup operators and ten local response conditions implemented; agree further attachment/navigation extensions, holdout data, scale budgets and accuracy thresholds |

At review, show the generated page, its private source answer and relevant test evidence together. Do not demo a baseline crawler score as Smartcite's result. A generator defect invalidates that fixture; a valid fixture that Smartcite handles incorrectly is a candidate-tool defect.

## Known Gaps

No finite suite covers every real-world obstacle. Current fixtures cover the explicit HTML/data/client-delay, ten HTTP conditions and self-signed HTTPS previews above. They do not yet simulate real authentication sessions (a fixed 403 is not a login flow), CAPTCHA/proof-of-work, HTTP 401 challenges, other TLS failures or DNS failures, actual fixture-server network timeouts or transient retry recovery, downloadable PDFs/OCR, complex frame trees, third-party APIs, encoding corruption, arbitrary SPA routing, browser-engine differences, or every deeply nested navigation design. Dashboard request timeout/retry checks are separate from generating those server conditions for Smartcite.

Those conditions need explicit fixture contracts and private expected outcomes before implementation. They must not be quietly introduced as unrecorded junk. Real website references are not reproduced comprehensively.

`rel=nofollow` is not yet a generated edge annotation. It must not be treated as an automatic navigation failure: Scrapy exposes it as [link metadata](https://docs.scrapy.org/en/latest/topics/link-extractors.html), while the candidate crawler's policy determines whether it follows that edge. A future annotation fixture needs its own source-first edge expectation without silently changing page or cluster counts.

Content is generated using templates and seeded Faker data, not a live LLM. AI-assisted template/content proposals, Smartcite integration, automated accuracy scoring in this UI, remote hosting and scale acceptance beyond the measured profiles remain unverified. Page-level and repeated-item locators have focused mutation tests; generator-wide mutation coverage remains open. Accessibility scans supplement, not replace, manual testing. The 74-case table below includes future/external candidate behavior as a backlog; it does not expand the generator into a migration tool.


## Acceptance plan: 74 planned cases

All cases below start **Not Run**. `P0` blocks trust/release; `P1` covers core promised behavior; `P2` covers an approved extension. These are planned acceptance cases, not a statement that every case is automated or has passed. Optional behavior becomes required only once it is claimed. Store status and evidence in run artifacts, separate from this plan.

<details>
<summary><strong>References, configuration, and data: REF-01..03, GEN-01..06, DATA-01..04</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| REF-01 | P1 | Review references for density, modern/legacy spread, directory/detail structure. | Notes map structures to fictional templates; transaction-only sites are not the main corpus. |
| REF-02 | P0 | Inspect names, text, images, branding, and URLs against reference-use policy. | No copied real records/branding; synthetic provenance is recorded. |
| REF-03 | P1 | Review every noise rationale with a concrete example. | Source/example supports mechanism; prevalence is not invented. |
| GEN-01 | P0 | Submit valid/invalid framework, count, seed, noise, field/type, and output settings. | Valid config accepted; unknown/conflicting values fail before misleading output. |
| GEN-02 | P0 | Generate 20, 200, and 2,000 page profiles including auxiliary pages. | Exact HTML count; unique IDs/normalized URLs; assets counted separately. |
| GEN-03 | P1 | Generate long/short records, optional fields, repeated records, and several types. | Meaningful distinguishing content; no empty/filler or identical records masking defects. |
| GEN-04 | P0 | Repeat locked versions/config/seed. | Canonical records, URLs, truth, and noise decisions match; stable hashes aside from declared volatile metadata. |
| GEN-05 | P1 | Change only seed, then noise, then renderer. | Seed changes intended data; noise retains canonical identity; renderer retains logical content contract. |
| GEN-06 | P0 | Target existing output, interrupt generation, and induce write failure. | Evidence is not overwritten; partial output is incomplete; rerun/resume policy is explicit. |
| DATA-01 | P1 | Review ten configs and representative pages. | Domain/framework/era/template/complexity matrix is met. |
| DATA-02 | P1 | Traverse clean pilot against its discoverable inventory. | Intended crawlable pages, navigation, lists, and cross-links are consistent. |
| DATA-03 | P1 | Compare balanced and heavily skewed type distributions. | Reports expose rare-type failures and reconcile totals. |
| DATA-04 | P1 | Evaluate frozen holdout after tuning elsewhere. | No holdout-label/score-driven tuning; split is in manifest. |
</details>

<details>
<summary><strong>Private answer keys: GOLD-01..07</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| GOLD-01 | P0 | Trace a small source model with renderer/crawler independently disabled. | Membership and source fields exist before rendering; crawler output never creates gold. |
| GOLD-02 | P0 | Validate truth against complete inventory. | Each page, including home/listing, has one primary cluster; no duplicates/orphans. |
| GOLD-03 | P0 | Return deliberately wrong memberships/values. | Gold remains unchanged and mismatch is visible. |
| GOLD-04 | P0 | Compare clean/noisy variants of one model. | Canonical digest, logical URLs, and membership match; only declared observable states/events differ. |
| GOLD-05 | P0 | Remove a field and render equivalent date representation. | Canonical value retained privately; absence and normalization are explicit. |
| GOLD-06 | P1 | Check relationships and optional fields. | Targets/cardinality/type are valid; optional absence differs from extraction failure. |
| GOLD-07 | P0 | Independently inspect every pilot page and declared stratified sample. | Gold matches observable fixture; mismatch invalidates fixture rather than rewriting gold. |
</details>

<details>
<summary><strong>Rendering and legacy behavior: WEB-01..06</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| WEB-01 | P1 | Fetch/navigate static HTML with JS disabled. | Intended content and links are available. |
| WEB-02 | P1 | Load React/Angular equivalents with JS on/off and inspect runtime evidence. | Genuine framework; rendered mode works; JS-off limitations are explicit. |
| WEB-03 | P1 | Refresh deep URLs, follow pagination and cross-links. | Stable expected content/URLs; no hidden home-first dependency. |
| WEB-04 | P1 | Compare source and browser DOM for malformed/table/wrapper variants. | Fields remain observable or declared loss is modeled; recovered-DOM evidence retained. |
| WEB-05 | P1 | Inspect desktop/narrow mobile clean layouts and intentional overflow. | Clean usable; intentional defects occur as specified; screenshots/measurements retained. |
| WEB-06 | P1 | Render readable, poor-contrast, and needs-review backgrounds. | Browser findings distinguish pass/fail/incomplete; failed browser launch is unavailable. |
</details>

<details>
<summary><strong>Noise controls: NOISE-01..08</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| NOISE-01 | P0 | Generate clean with operators otherwise available. | No intentional/undeclared noise mutations. |
| NOISE-02 | P0 | Apply one semantics-preserving operator to a fixed record. | Type/fields unchanged; mutation and rendered invariant independently verified. |
| NOISE-03 | P0 | Apply destructive missing-field operator. | Only documented observable state changes; evaluator does not require removed value. |
| NOISE-04 | P1 | Run low/medium/high with fixed seed, policy, compatible operators. | Selection, severity, caps match policy; realized counts reported. |
| NOISE-05 | P1 | Enable wrappers/classes only at probability zero and one. | Only selected operations apply; zero never applies and one applies to eligible pages within caps. |
| NOISE-06 | P1 | Combine wrappers+reorder, malformed+missing, delay+boilerplate. | Composition preserves contract or fails clearly; each event attributable. |
| NOISE-07 | P1 | Apply unsupported operator/framework combinations. | Reject or explicitly mark inapplicable; no silent ignore. |
| NOISE-08 | P0 | Rebuild pair and inspect mutation manifest. | Reproducible page/operator/version/parameters/effect data. |
</details>

<details>
<summary><strong>Crawling and product integration: CRAWL-01..07, ADAPT-01..04</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| CRAWL-01 | P0 | Crawl owned clean fixture from agreed seed. | Expected discoverable inventory accounted for; omissions reported. |
| CRAWL-02 | P1 | Include duplicates, fragments, query variants, loops, aliases. | URL policy prevents endless/double count without merging distinct pages. |
| CRAWL-03 | P1 | Include broken link and simulated timeout/error. | Failed request stays distinct from missing/unattempted; no fabricated success. |
| CRAWL-04 | P1 | Test delayed content before/after readiness deadline. | Mode/wait/timeout explain result; HTTP is not passed off as browser rendering. |
| CRAWL-05 | P0 | On owned endpoints, test robots and redirects to disallowed/external/private targets. | No forbidden request; denial/unavailable policy explicit. |
| CRAWL-06 | P0 | Exceed page/depth/time/byte/frontier limits; simulate 429/503. | Limits/backoff/stop enforced; all terminal states retained. |
| CRAWL-07 | P2 | If claimed, exercise frames, JS navigation, or meta refresh. | Only documented behavior accepted; unsupported navigation visible. |
| ADAPT-01 | P0 | Map one real candidate-tool output sample. | Reviewed URL/cluster/capability mapping; no gold fills predictions. |
| ADAPT-02 | P0 | Supply malformed exports, duplicates, missing capabilities, empty payloads. | Reject invalid data or report capability coverage explicitly. |
| ADAPT-03 | P0 | Run product from public entry URLs with restricted artifacts. | Candidate cannot access private truth; raw output preserved. |
| ADAPT-04 | P1 | Hand-compare adapter output to raw records. | Faithful transformation; logged mapping/normalization; no silent drops. |
</details>

<details>
<summary><strong>Evaluator correctness: EVAL-01..08</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| EVAL-01 | P0 | Score perfect predictions after renaming predicted clusters. | Same perfect score; labels do not decide correctness. |
| EVAL-02 | P0 | Split one gold group and merge two different groups. | Split lowers recall, merge lowers precision; exact pair counts verified. |
| EVAL-03 | P0 | Omit expected pages; add unexpected/duplicate URLs. | Coverage shows omissions/extras; duplicates rejected/resolved; no inflation. |
| EVAL-04 | P0 | Score empty, singleton, all-one, all-singleton cases. | Degenerate conventions/undefined denominators explicit; no false 100%. |
| EVAL-05 | P0 | Predict missing, extra, wrong, and deliberately removed fields. | Observable truth applied; errors lower precision/recall; unsupported extras penalized. |
| EVAL-06 | P0 | Test aliases, whitespace/Unicode, valid dates, ambiguous dates. | Versioned approved normalization only; ambiguity not guessed; collisions rejected. |
| EVAL-07 | P1 | Test schemas/relationships with correct/extra/missing/duplicate items. | Appropriate scores and capability coverage; scalar/repeated capability distinct. |
| EVAL-08 | P0 | Independently recalculate small examples and compare totals/per-type. | Hand calculation matches; counts reconcile; observed-only cannot hide misses. |
</details>

<details>
<summary><strong>AI assistance, reliability, and scale: AI-01..04, RUN-01..04, SCALE-01..05</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| AI-01 | P1 | If AI proposes a model/template, test valid, malformed, contradictory output. | Schema/semantic validation gates generation; invalid result fails or enters bounded review. |
| AI-02 | P0 | Replay frozen AI artifact; repeat live prompt separately. | Frozen artifact reproduces; live output is not promised byte-identical; provenance/hashes recorded. |
| AI-03 | P0 | Put instruction-like text in owned reference page. | Treated as untrusted data; cannot alter scope or expose truth/secrets. |
| AI-04 | P1 | Simulate timeout/rate limit and API budget where AI is enabled. | Explicit incomplete failure; bounded retry/budget; no silent paid fallback. |
| RUN-01 | P0 | Execute in clean documented, pinned environment. | Another tester can reproduce without hidden files/credentials/manual edits. |
| RUN-02 | P1 | Repeat matched trials and approved seeds. | Deterministic artifacts match; paired per-seed variation reported. |
| RUN-03 | P0 | Interrupt during generation/crawl/evaluation. | Finished artifacts retained; run incomplete; restart cannot mix incompatible work. |
| RUN-04 | P1 | Introduce invalid fixture and product failure separately. | Invalid fixture visibly excluded; valid product failure remains reported. |
| SCALE-01 | P1 | Generate 20/200/2,000-page profiles under approved budget. | Count/time/peak memory/disk recorded independently. |
| SCALE-02 | P1 | Run a 500-site/100,000-total-page batch. | Per-site/grand totals reconcile; no silent truncation/overwrite/false completion. |
| SCALE-03 | P1 | Crawl, cluster, and evaluate approved large corpus separately. | Stage throughput/memory/time/failures measured; generation does not substitute. |
| SCALE-04 | P1 | Simulate disk/resource limit or failed site. | Predictable stop/isolation, bounded logs, visible partial state. |
| SCALE-05 | P1 | Repeat fixed-hardware/version performance profile. | Comparable measurements; unsupported capacity is blocked/failed, not bypassed. |
</details>

<details>
<summary><strong>Security and reports: SEC-01..04, REPORT-01..04</strong></summary>

| ID | Pri | Procedure | Expected evidence |
| --- | --- | --- | --- |
| SEC-01 | P0 | Request private paths, encoded traversal, symlink escape; inspect bundles/maps. | No private truth/config/outside files served; negative evidence retained. |
| SEC-02 | P0 | Test hostname/address changes and redirects on controlled endpoints. | Network policy blocks private-address access, including re-resolution/redirect. |
| SEC-03 | P0 | Put synthetic script/HTML strings in fields/report labels. | Context-safe handling; reports do not execute untrusted markup. |
| SEC-04 | P1 | Review dependencies, artifact contents, reference-data retention. | Advisories/licenses/retention documented; no credentials/unnecessary real personal data. |
| REPORT-01 | P0 | Review a mixed result. | Coverage, clustering, extraction, capability separate; no unsupported single accuracy. |
| REPORT-02 | P1 | Compare clean/noisy by site/type/framework/operator/severity. | Same-source comparison; overlap disclosed; representative errors linked. |
| REPORT-03 | P0 | Trace a selected score through provenance/raw artifacts. | Config/hashes/product/raw/adapter/evaluator versions are traceable. |
| REPORT-04 | P0 | Mark skipped/blocked and browser audit unavailable. | Explicit status; neither counts as pass; reference and product scores distinct. |
</details>

## Gates, evidence, and defects

The benchmark system can be accepted only when applicable P0 cases pass, P1 cases pass or have a written approved exception, no critical truth-leakage/data-integrity/safety issue remains, and artifacts support reproduction. Product acceptance additionally requires thresholds agreed *before* holdout/product scoring.

Keep a new run directory with logical artifacts such as:

```text
run-manifest.json        versions, seeds, conditions, budgets, capability/status
config/                  approved site and noise settings
public/                  only candidate-accessible generated files
private/                 canonical data, expected answers, mutation audit
validation/              inventory and rendered fixture checks
candidate/raw/           preserved product output
candidate/normalized/    reviewed adapter output and mapping version
reports/                 metrics, denominators, failures, paired comparisons
evidence/                logs, request outcomes, screenshots, timing/memory
```

Classify a failure before changing product behavior: generator/fixture defect, ground-truth defect, evaluator/adapter defect, candidate product defect, environment failure, or unsupported scope. Record run/test IDs, page IDs, configuration/seed, product/version, expected vs. actual, logs/screenshots, owner, and retest result. Do not discard inconvenient failed runs.

## Guide Ownership

This README is the single current product guide and test plan. `AGENTS.md` and `CLAUDE.md` remain repository instructions. Historical documentation stays in `docs/archive/legacy-docs.zip`; it is not part of current setup.
