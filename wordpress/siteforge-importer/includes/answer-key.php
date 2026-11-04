<?php
/**
 * The answer key of an imported site, built from what WordPress serves: real permalinks, the post type of every
 * record (its cluster), the field values as written into the content, the related records and, for every archive
 * page (/books/, /books/page/2/ …), the records WordPress lists there with its own posts_per_page and ordering.
 *
 * The shape follows SiteForge's answer key (src/answers/answer-key.mjs), so src/answers/evaluator.mjs can score a
 * crawl of the WordPress site against it.
 *
 * @package SiteForgeImporter
 */

defined( 'ABSPATH' ) || exit;

/** A title as WordPress displays it (the_title filters applied), as plain text. */
function siteforge_importer_display_title( int $post_id ): string {
	return trim( html_entity_decode( wp_strip_all_tags( get_the_title( $post_id ) ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
}

/** The heading WordPress shows on a post type archive (get_the_archive_title() for that archive). */
function siteforge_importer_archive_title( string $post_type ): string {
	$object = get_post_type_object( $post_type );
	if ( ! $object ) {
		return $post_type;
	}
	// The same steps as get_the_archive_title() on is_post_type_archive(); the filters let themes change them.
	$title          = apply_filters( 'post_type_archive_title', $object->labels->name, $post_type );
	$original_title = $title;
	$prefix         = apply_filters( 'get_the_archive_title_prefix', _x( 'Archives:', 'post type archive title prefix' ) );
	if ( $prefix ) {
		/* translators: 1: Title prefix. 2: Title. */
		$title = sprintf( _x( '%1$s %2$s', 'archive title' ), $prefix, '<span>' . $title . '</span>' );
	}
	$title = apply_filters( 'get_the_archive_title', $title, $original_title, $prefix );
	return trim( html_entity_decode( wp_strip_all_tags( (string) $title ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
}

/** URL of page $n of a post type archive (pretty permalinks: /books/page/2/, plain: ?post_type=book&paged=2). */
function siteforge_importer_archive_url( string $post_type, int $n ): ?string {
	global $wp_rewrite;
	$link = get_post_type_archive_link( $post_type );
	if ( ! $link ) {
		return null;
	}
	if ( $n <= 1 ) {
		return $link;
	}
	if ( $wp_rewrite->using_permalinks() ) {
		return user_trailingslashit( trailingslashit( $link ) . $wp_rewrite->pagination_base . '/' . $n, 'paged' );
	}
	return add_query_arg( 'paged', $n, $link );
}

/** Posts per archive page, as the main query uses it. */
function siteforge_importer_posts_per_page(): int {
	$per_page = (int) get_option( 'posts_per_page', 10 );
	return $per_page > 0 ? $per_page : PHP_INT_MAX;
}

/**
 * Archive pages of a site's post types, in type order: [{ postType, n }] (types with no published posts have none).
 *
 * @return array<int, array{postType: string, n: int}>
 */
function siteforge_importer_archive_plan( array $site ): array {
	$plan     = array();
	$per_page = siteforge_importer_posts_per_page();
	foreach ( array_unique( array_values( $site['types'] ?? array() ) ) as $post_type ) {
		$object = get_post_type_object( $post_type );
		if ( ! $object || ! $object->has_archive || ! get_post_type_archive_link( $post_type ) ) {
			continue;
		}
		$published = (int) ( wp_count_posts( $post_type )->publish ?? 0 );
		$pages     = $published > 0 ? (int) ceil( $published / $per_page ) : 0;
		for ( $n = 1; $n <= $pages; $n++ ) {
			$plan[] = array( 'postType' => $post_type, 'n' => $n );
		}
	}
	return $plan;
}

/** Answer-key entry of one imported record. */
function siteforge_importer_record_entry( int $post_id, string $site_id, array $known ): ?array {
	$def = siteforge_importer_definition( (string) get_post_type( $post_id ) );
	if ( ! $def ) {
		return null;
	}
	$type    = (string) get_post_meta( $post_id, '_siteforge_type', true );
	$written = json_decode( (string) get_post_meta( $post_id, '_siteforge_fields', true ), true );
	$written = is_array( $written ) ? $written : array();
	$title   = siteforge_importer_display_title( $post_id );
	$fields  = array( 'title' => $title );
	$states  = array( 'title' => 'present' );
	foreach ( $def['fields'] as $field ) {
		$present                   = isset( $written[ $field['name'] ] ) && '' !== $written[ $field['name'] ];
		$states[ $field['name'] ] = $present ? 'present' : 'absent';
		if ( $present ) {
			$fields[ $field['name'] ] = (string) $written[ $field['name'] ];
		}
	}
	// Only fields of this site's type: a post type shared by several sites may have more fields.
	$relationships = json_decode( (string) get_post_meta( $post_id, '_siteforge_relationships', true ), true );
	$related       = siteforge_importer_resolve_related( $site_id, is_array( $relationships ) ? $relationships : array(), $known );
	$builder       = get_post_meta( $post_id, '_elementor_data', true ) ? 'elementor' : 'blocks';
	return array(
		'pageId'          => (string) get_post_meta( $post_id, '_siteforge_external_id', true ),
		'url'             => siteforge_importer_relative_url( (string) get_permalink( $post_id ) ),
		'kind'            => 'detail',
		'contentType'     => '' !== $type ? $type : (string) get_post_type( $post_id ),
		'expectedCluster' => (string) get_post_type( $post_id ),
		'postType'        => (string) get_post_type( $post_id ),
		'postId'          => $post_id,
		'sourceUrl'       => (string) get_post_meta( $post_id, '_siteforge_source_path', true ),
		'builder'         => $builder,
		'title'           => $title,
		'fields'          => $fields,
		'canonicalValues' => array( 'title' => html_entity_decode( (string) get_post_field( 'post_title', $post_id, 'raw' ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) + array_diff_key( $fields, array( 'title' => true ) ),
		'fieldStates'     => $states,
		'relationships'   => array_map( static fn( $item ) => array( 'type' => $item['type'], 'targetUrl' => siteforge_importer_relative_url( $item['url'] ) ), $related ),
		'noiseEvents'     => array(),
	);
}

/** Answer-key entry of one archive page, listing the records WordPress shows there. */
function siteforge_importer_archive_entry( string $post_type, int $n ): ?array {
	$url = siteforge_importer_archive_url( $post_type, $n );
	if ( ! $url ) {
		return null;
	}
	$query = new WP_Query(
		array(
			'post_type'           => $post_type,
			'post_status'         => 'publish',
			'posts_per_page'      => (int) get_option( 'posts_per_page', 10 ),
			'paged'               => $n,
			'orderby'             => 'date',
			'order'               => 'DESC',
			'ignore_sticky_posts' => true,
			'no_found_rows'       => true,
			'fields'              => 'ids',
		)
	);
	$items = array();
	foreach ( $query->posts as $id ) {
		$external = (string) get_post_meta( (int) $id, '_siteforge_external_id', true );
		$items[]  = array(
			'pageId' => '' !== $external ? $external : 'wp-' . (int) $id,
			'url'    => siteforge_importer_relative_url( (string) get_permalink( (int) $id ) ),
			'fields' => array( 'title' => siteforge_importer_display_title( (int) $id ) ),
		);
	}
	$title = siteforge_importer_archive_title( $post_type );
	return array(
		'pageId'          => 'archive-' . $post_type . '-' . $n,
		'url'             => siteforge_importer_relative_url( $url ),
		'kind'            => 'listing',
		'contentType'     => 'listing',
		'expectedCluster' => 'listing',
		'postType'        => $post_type,
		'title'           => $title,
		'fields'          => array( 'title' => $title ),
		'canonicalValues' => array( 'title' => $title ),
		'fieldStates'     => array( 'title' => 'present' ),
		'relationships'   => array(),
		'repeatedItems'   => $items,
		'noiseEvents'     => array(),
	);
}

/** Answer-key entry of the site's Home page. */
function siteforge_importer_home_entry( int $page_id ): array {
	$fields  = json_decode( (string) get_post_meta( $page_id, '_siteforge_fields', true ), true );
	$summary = is_array( $fields ) ? (string) ( $fields['summary'] ?? '' ) : '';
	$title   = siteforge_importer_display_title( $page_id );
	$values  = array( 'title' => $title ) + ( '' !== $summary ? array( 'summary' => $summary ) : array() );
	return array(
		'pageId'          => 'home',
		'url'             => siteforge_importer_relative_url( (string) get_permalink( $page_id ) ),
		'kind'            => 'home',
		'contentType'     => 'home',
		'expectedCluster' => 'page',
		'postType'        => 'page',
		'postId'          => $page_id,
		'title'           => $title,
		'fields'          => $values,
		'canonicalValues' => $values,
		'fieldStates'     => array( 'title' => 'present', 'summary' => '' !== $summary ? 'present' : 'absent' ),
		'relationships'   => array(),
		'noiseEvents'     => array(),
	);
}

/**
 * The answer key, or the slice [$offset, $offset + $limit) of its pages ($limit 0: all). Pages are ordered: Home page
 * (when created), records in import order, then archive pages.
 *
 * @return array|WP_Error
 */
function siteforge_importer_answer_key( string $site_id, int $offset, int $limit ) {
	$spec = siteforge_importer_get_spec();
	$site = $spec['sites'][ $site_id ] ?? null;
	if ( ! $site ) {
		return new WP_Error( 'siteforge_unknown_site', sprintf( 'Site %s has not been imported.', $site_id ), array( 'status' => 404 ) );
	}
	$home_id = (int) ( $site['homePageId'] ?? 0 );
	$home_id = $home_id && 'publish' === get_post_status( $home_id ) ? $home_id : 0;
	$records = siteforge_importer_record_count( $site_id, true );
	$plan    = siteforge_importer_archive_plan( $site );
	$total   = ( $home_id ? 1 : 0 ) + $records + count( $plan );
	$end     = $limit > 0 ? min( $total, $offset + $limit ) : $total;
	$pages   = array();
	$index   = $offset;
	if ( $home_id && 0 === $index && $index < $end ) {
		$pages[] = siteforge_importer_home_entry( $home_id );
		++$index;
	}
	$record_start = $index - ( $home_id ? 1 : 0 );
	$record_end   = min( $records, $end - ( $home_id ? 1 : 0 ) );
	if ( $record_start < $record_end ) {
		$ids     = siteforge_importer_record_ids( $site_id, $record_start, $record_end - $record_start, true );
		$targets = array();
		foreach ( $ids as $id ) {
			$relationships = json_decode( (string) get_post_meta( $id, '_siteforge_relationships', true ), true );
			$targets       = array_merge( $targets, array_column( is_array( $relationships ) ? $relationships : array(), 'targetExternalId' ) );
		}
		$known = siteforge_importer_find_posts( $site_id, $targets );
		foreach ( $ids as $id ) {
			$entry = siteforge_importer_record_entry( $id, $site_id, $known );
			if ( $entry ) {
				$pages[] = $entry;
			}
			++$index;
		}
	}
	$archive_start = max( 0, $index - ( $home_id ? 1 : 0 ) - $records );
	$archive_end   = $end - ( $home_id ? 1 : 0 ) - $records;
	for ( $i = $archive_start; $i < $archive_end; $i++ ) {
		$entry = siteforge_importer_archive_entry( $plan[ $i ]['postType'], $plan[ $i ]['n'] );
		if ( $entry ) {
			$pages[] = $entry;
		}
	}
	$home    = home_url( '/' );
	$parts   = wp_parse_url( $home );
	$origin  = ( $parts['scheme'] ?? 'http' ) . '://' . ( $parts['host'] ?? 'localhost' ) . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
	$schemas = array();
	$types   = array();
	foreach ( $site['types'] as $name => $post_type ) {
		$def              = $spec['postTypes'][ $post_type ] ?? array( 'fields' => array() );
		$schemas[ $name ] = array_merge( array( 'title' ), array_column( $def['fields'], 'name' ) );
		$types[ $name ]   = array( 'postType' => $post_type, 'reused' => ! empty( $def['reused'] ), 'label' => $def['label'] ?? $name, 'archiveUrl' => siteforge_importer_relative_url( (string) get_post_type_archive_link( $post_type ) ) );
	}
	$schemas['home']    = array( 'title', 'summary' );
	$schemas['listing'] = array( 'title' );
	$theme              = wp_get_theme();
	return array(
		'version'      => 1,
		'source'       => 'wordpress',
		'generator'    => 'siteforge-importer ' . SITEFORGE_IMPORTER_VERSION,
		'generatedAt'  => gmdate( 'c' ),
		'site'         => array(
			'id'                 => $site_id,
			'name'               => (string) ( $site['name'] ?? $site_id ),
			'baseUrl'            => $origin,
			'homeUrl'            => $home,
			'framework'          => 'html',
			'rendering'          => 'server',
			'cms'                => 'wordpress',
			'wordpressVersion'   => get_bloginfo( 'version' ),
			'theme'              => array( 'name' => $theme->get( 'Name' ), 'stylesheet' => get_stylesheet(), 'isBlockTheme' => function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() ),
			'builder'            => (string) ( $site['builder'] ?? 'blocks' ),
			'elementor'          => siteforge_importer_elementor_active() ? ELEMENTOR_VERSION : null,
			'postsPerPage'       => (int) get_option( 'posts_per_page', 10 ),
			'permalinkStructure' => (string) get_option( 'permalink_structure' ),
			'noise'              => array( 'level' => 'clean', 'probability' => 0, 'severity' => 1, 'maxPerPage' => 0, 'types' => array(), 'overrides' => (object) array() ),
		),
		'contentTypes' => $types,
		'schemas'      => $schemas,
		'total'        => $total,
		'offset'       => $offset,
		'limit'        => $limit,
		'nextOffset'   => $end < $total ? $end : null,
		'pages'        => $pages,
	);
}
