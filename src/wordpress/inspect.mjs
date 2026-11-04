// "Interrogates" a WordPress site through the SiteForge Importer plugin: which content types (post types and
// taxonomies) it has, which theme and builder render them, and which SiteForge content types would reuse an
// existing post type instead of getting a new one.
import { PRESETS } from '../site/presets.mjs';
import { slug } from '../site/util.mjs';
import { humanize } from './push.mjs';

/** Every SiteForge preset content type (first occurrence of each name), as the plugin's /match expects them. */
export function presetTypes() {
  const seen = new Map();
  for (const preset of Object.values(PRESETS)) {
    for (const type of preset.types) {
      if (!seen.has(type.name)) seen.set(type.name, { name: type.name, label: type.label, singular: humanize(type.name), slug: slug(type.label), fields: [] });
    }
  }
  return [...seen.values()];
}

const listing = values => values.length ? values.join(', ') : 'none';

/**
 * @param {ReturnType<import('./client.mjs').wordpressClient>} client
 * @param {{ siteTypes?: Array<{ name: string, label: string, singular?: string, slug?: string }>, reuseExisting?: boolean }} options
 */
export async function inspectWordPress(client, { siteTypes, reuseExisting = true } = {}) {
  const [status, types] = await Promise.all([client.status(), client.types()]);
  const candidates = (siteTypes ?? presetTypes()).map(({ name, label, singular, slug: section }) => ({ name, label, singular, slug: section, fields: [] }));
  const { matches } = await client.match(candidates, { reuseExisting });
  // Content types an editor works with: public or shown in the admin, without WordPress's internal ones.
  const internal = new Set(['attachment', 'revision', 'nav_menu_item', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face']);
  const contentTypes = types.postTypes.filter(type => !internal.has(type.name) && (type.public || type.showUi)).map(type => ({
    name: type.name, label: type.label, singular: type.singular, registeredBy: type.registeredBy, published: type.published,
    archiveUrl: type.archiveUrl, rewriteSlug: type.rewriteSlug, restBase: type.restBase, taxonomies: type.taxonomies,
    metaKeys: type.metaKeys.filter(key => !key.startsWith('_')), supports: type.supports,
  }));
  const taxonomies = types.taxonomies.filter(taxonomy => taxonomy.public && !['post_format', 'nav_menu', 'link_category', 'wp_theme', 'wp_template_part_area', 'wp_pattern_category'].includes(taxonomy.name))
    .map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label, objectTypes: taxonomy.objectTypes, terms: taxonomy.terms, registeredBy: taxonomy.builtin ? 'wordpress' : 'other' }));
  const sites = status.sites ?? [];
  const lines = [
    `WordPress ${status.wordpress.version} at ${status.wordpress.home} (PHP ${status.wordpress.php}, permalinks ${status.wordpress.permalinkStructure || 'plain'}, ${status.wordpress.postsPerPage} posts per page)`,
    `Theme: ${status.theme.name} ${status.theme.version}${status.theme.is_block_theme ? ' (block theme)' : ' (classic theme)'}`,
    `Elementor: ${status.elementor.active ? `${status.elementor.version}${status.elementor.containers ? ' with containers' : ''}` : 'not active'}`,
    `Active plugins: ${listing(status.plugins.map(plugin => `${plugin.name} ${plugin.version}`))}`,
    '',
    'Content types:',
    ...contentTypes.map(type => `  ${type.name} (${type.label}) — ${type.published} published${type.archiveUrl ? `, archive ${type.archiveUrl}` : ''}${type.metaKeys.length ? `, fields ${listing(type.metaKeys)}` : ''} [${type.registeredBy === 'siteforge' ? 'SiteForge' : type.registeredBy === 'wordpress' ? 'WordPress' : 'theme/plugin'}]`),
    'Taxonomies:',
    ...taxonomies.map(taxonomy => `  ${taxonomy.name} (${taxonomy.label}) — ${taxonomy.terms} terms, for ${listing(taxonomy.objectTypes)}`),
    '',
    `SiteForge types${siteTypes ? '' : ' (all presets)'}:`,
    ...matches.map(match => `  ${match.name} (${match.label}) → ${match.postType} ${match.reused ? `reuses the existing type (${match.reason})` : match.reason === 'previous import' ? '(SiteForge type from an earlier import)' : '(new SiteForge type)'}`),
    ...(sites.length ? ['', 'Imported sites:', ...sites.map(site => `  ${site.siteId} (${site.name}): ${site.records} items, ${site.media} images${Object.keys(site.counts).length ? ` — ${Object.entries(site.counts).map(([type, count]) => `${type} ${count}`).join(', ')}` : ''}`)] : []),
  ];
  return {
    url: status.wordpress.home,
    adminUrl: status.wordpress.admin,
    wordpress: status.wordpress,
    theme: status.theme,
    elementor: status.elementor,
    plugins: status.plugins,
    contentTypes,
    taxonomies,
    matches,
    sites,
    text: lines.join('\n'),
  };
}
