<?php
/**
 * REST API (namespace siteforge/v1). Every route requires the X-SiteForge-Token header.
 *
 *   GET  /status        plugin, WordPress, theme, plugins, Elementor and imported counts per site
 *   GET  /types         every post type and taxonomy of the site (the "interrogate the site" step)
 *   POST /match         which existing post types a list of SiteForge types would use (changes nothing)
 *   POST /import        creates or updates a batch of records (idempotent)
 *   POST /relationships resolves relationships of a slice of records into meta and "Related" links
 *   POST /pages         creates the site's Home page, optionally as the static front page
 *   POST /reset         deletes what the import created for a site (in slices)
 *   GET  /answer-key    expected content with the real WordPress URLs (optionally in slices)
 *
 * @package SiteForgeImporter
 */

defined( 'ABSPATH' ) || exit;

const SITEFORGE_IMPORTER_FIELD_TYPES = array( 'title', 'text', 'person', 'date', 'place', 'address', 'isbn', 'image', 'number', 'url' );

add_action(
	'rest_api_init',
	static function () {
		$routes = array(
			'/status'        => array( 'GET', 'siteforge_importer_rest_status' ),
			'/types'         => array( 'GET', 'siteforge_importer_rest_types' ),
			'/match'         => array( 'POST', 'siteforge_importer_rest_match' ),
			'/import'        => array( 'POST', 'siteforge_importer_rest_import' ),
			'/relationships' => array( 'POST', 'siteforge_importer_rest_relationships' ),
			'/pages'         => array( 'POST', 'siteforge_importer_rest_pages' ),
			'/reset'         => array( 'POST', 'siteforge_importer_rest_reset' ),
			'/answer-key'    => array( 'GET', 'siteforge_importer_rest_answer_key' ),
		);
		foreach ( $routes as $route => [ $method, $callback ] ) {
			register_rest_route(
				'siteforge/v1',
				$route,
				array(
					'methods'             => $method,
					'callback'            => $callback,
					'permission_callback' => 'siteforge_importer_rest_permission',
				)
			);
		}
	}
);

/**
 * Checks the X-SiteForge-Token header (constant-time). A valid token acts as the first administrator, so imported
 * posts get an author and content is saved like an administrator's.
 *
 * @return true|WP_Error
 */
function siteforge_importer_rest_permission( WP_REST_Request $request ) {
	$given    = (string) $request->get_header( 'X-SiteForge-Token' );
	$expected = siteforge_importer_token();
	if ( '' === $given || '' === $expected || ! hash_equals( $expected, $given ) ) {
		return new WP_Error( 'siteforge_forbidden', 'Missing or invalid X-SiteForge-Token header. Copy the token from Settings → SiteForge Importer.', array( 'status' => 401 ) );
	}
	$author = siteforge_importer_author_id();
	if ( $author && ! get_current_user_id() ) {
		wp_set_current_user( $author );
	}
	return true;
}

/** A 400 error for invalid input. */
function siteforge_importer_invalid( string $message ): WP_Error {
	return new WP_Error( 'siteforge_invalid', $message, array( 'status' => 400 ) );
}

/** Validates a site ID (the generator's format). */
function siteforge_importer_site_id( $value ) {
	return is_string( $value ) && preg_match( '/^[a-z][a-z0-9-]{0,63}$/', $value ) ? $value : null;
}

/** Plain single-line text, at most $max characters. */
function siteforge_importer_line( $value, int $max = 200 ): string {
	return mb_substr( sanitize_text_field( is_scalar( $value ) ? (string) $value : '' ), 0, $max );
}

/* -------------------------------------------------------------------------------------------------------------- */

/** GET /status */
function siteforge_importer_rest_status(): WP_REST_Response {
	$theme   = wp_get_theme();
	$plugins = array();
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$all = get_plugins();
	foreach ( (array) get_option( 'active_plugins', array() ) as $file ) {
		$plugins[] = array( 'file' => $file, 'name' => $all[ $file ]['Name'] ?? $file, 'version' => $all[ $file ]['Version'] ?? '' );
	}
	$counts = array();
	foreach ( siteforge_importer_site_counts() as $site ) {
		$counts[] = $site;
	}
	return rest_ensure_response(
		array(
			'plugin'     => array( 'name' => 'SiteForge Importer', 'version' => SITEFORGE_IMPORTER_VERSION, 'tokenSource' => siteforge_importer_token_is_constant() ? 'constant' : 'option' ),
			'wordpress'  => array( 'version' => get_bloginfo( 'version' ), 'php' => PHP_VERSION, 'home' => home_url( '/' ), 'admin' => admin_url(), 'permalinkStructure' => (string) get_option( 'permalink_structure' ), 'postsPerPage' => (int) get_option( 'posts_per_page', 10 ), 'showOnFront' => get_option( 'show_on_front' ), 'pageOnFront' => (int) get_option( 'page_on_front' ) ),
			'theme'      => array( 'name' => $theme->get( 'Name' ), 'version' => $theme->get( 'Version' ), 'stylesheet' => get_stylesheet(), 'template' => get_template(), 'is_block_theme' => function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() ),
			'plugins'    => $plugins,
			'elementor'  => array( 'active' => siteforge_importer_elementor_active(), 'version' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null, 'containers' => siteforge_importer_elementor_containers(), 'postTypes' => get_option( 'elementor_cpt_support', array( 'post', 'page' ) ) ),
			'sites'      => $counts,
		)
	);
}

/** GET /types: every post type and taxonomy, with labels, REST base, supports, registered meta, archive and rewrite slug. */
function siteforge_importer_rest_types(): WP_REST_Response {
	$own        = siteforge_importer_own_post_types();
	$post_types = array();
	foreach ( get_post_types( array(), 'objects' ) as $object ) {
		$counts       = wp_count_posts( $object->name );
		$archive      = $object->has_archive ? get_post_type_archive_link( $object->name ) : false;
		$post_types[] = array(
			'name'         => $object->name,
			'label'        => $object->labels->name,
			'singular'     => $object->labels->singular_name,
			'description'  => $object->description,
			'public'       => (bool) $object->public,
			'showUi'       => (bool) $object->show_ui,
			'builtin'      => (bool) $object->_builtin,
			'hierarchical' => (bool) $object->hierarchical,
			'registeredBy' => in_array( $object->name, $own, true ) ? 'siteforge' : ( $object->_builtin ? 'wordpress' : 'other' ),
			'restBase'     => $object->show_in_rest ? ( $object->rest_base ? $object->rest_base : $object->name ) : null,
			'supports'     => array_keys( get_all_post_type_supports( $object->name ) ),
			'taxonomies'   => get_object_taxonomies( $object->name ),
			'metaKeys'     => array_keys( get_registered_meta_keys( 'post', $object->name ) ),
			'hasArchive'   => is_string( $object->has_archive ) ? $object->has_archive : (bool) $object->has_archive,
			'archiveUrl'   => $archive ? $archive : null,
			'rewriteSlug'  => is_array( $object->rewrite ) ? ( $object->rewrite['slug'] ?? null ) : null,
			'menuIcon'     => $object->menu_icon,
			'published'    => (int) ( $counts->publish ?? 0 ),
		);
	}
	$taxonomies = array();
	foreach ( get_taxonomies( array(), 'objects' ) as $taxonomy ) {
		$taxonomies[] = array(
			'name'         => $taxonomy->name,
			'label'        => $taxonomy->labels->name,
			'singular'     => $taxonomy->labels->singular_name,
			'public'       => (bool) $taxonomy->public,
			'builtin'      => (bool) $taxonomy->_builtin,
			'hierarchical' => (bool) $taxonomy->hierarchical,
			'objectTypes'  => array_values( (array) $taxonomy->object_type ),
			'restBase'     => $taxonomy->show_in_rest ? ( $taxonomy->rest_base ? $taxonomy->rest_base : $taxonomy->name ) : null,
			'rewriteSlug'  => is_array( $taxonomy->rewrite ) ? ( $taxonomy->rewrite['slug'] ?? null ) : null,
			'terms'        => (int) wp_count_terms( array( 'taxonomy' => $taxonomy->name, 'hide_empty' => false ) ),
		);
	}
	return rest_ensure_response( array( 'postTypes' => $post_types, 'taxonomies' => $taxonomies, 'siteforge' => siteforge_importer_get_spec() ) );
}

/**
 * Validates the `types` of an import or match request.
 *
 * @return array|WP_Error
 */
function siteforge_importer_parse_types( $types, int $max = 30 ) {
	if ( ! is_array( $types ) || ! $types || count( $types ) > $max ) {
		return siteforge_importer_invalid( "types must be a list of 1 to $max content types." );
	}
	$parsed = array();
	foreach ( array_values( $types ) as $i => $type ) {
		$name = is_array( $type ) ? ( $type['name'] ?? null ) : null;
		if ( ! is_string( $name ) || ! preg_match( '/^[A-Za-z][A-Za-z0-9_]{0,48}$/', $name ) ) {
			return siteforge_importer_invalid( "types[$i].name must be a SiteForge type name." );
		}
		$label    = siteforge_importer_line( $type['label'] ?? $name, 100 );
		$singular = siteforge_importer_line( $type['singular'] ?? $label, 100 );
		$slug     = implode( '/', array_filter( array_map( 'sanitize_title', explode( '/', (string) ( $type['slug'] ?? $label ) ) ) ) );
		$fields   = array();
		foreach ( array_values( is_array( $type['fields'] ?? null ) ? $type['fields'] : array() ) as $j => $field ) {
			$field_name = is_array( $field ) ? ( $field['name'] ?? null ) : null;
			if ( ! is_string( $field_name ) || ! preg_match( '/^[A-Za-z][A-Za-z0-9_]{0,48}$/', $field_name ) || 'title' === $field_name ) {
				return siteforge_importer_invalid( "types[$i].fields[$j].name must be a field name other than title." );
			}
			$field_type = in_array( $field['type'] ?? 'text', SITEFORGE_IMPORTER_FIELD_TYPES, true ) ? $field['type'] ?? 'text' : 'text';
			$display    = in_array( $field['display'] ?? '', array( 'row', 'text', 'image' ), true ) ? $field['display'] : ( 'image' === $field_type ? 'image' : ( 'text' === $field_type ? 'text' : 'row' ) );
			$fields[]   = array( 'name' => $field_name, 'type' => $field_type, 'label' => siteforge_importer_line( $field['label'] ?? $field_name, 100 ), 'display' => $display );
		}
		if ( count( $fields ) > 40 ) {
			return siteforge_importer_invalid( "types[$i] has more than 40 fields." );
		}
		$icon     = is_string( $type['icon'] ?? null ) && preg_match( '/^dashicons-[a-z0-9-]+$/', $type['icon'] ) ? $type['icon'] : null;
		$parsed[] = array_filter(
			array( 'name' => $name, 'label' => '' !== $label ? $label : $name, 'singular' => '' !== $singular ? $singular : $label, 'slug' => '' !== $slug ? $slug : sanitize_title( $name ), 'fields' => $fields, 'icon' => $icon, 'postType' => is_string( $type['postType'] ?? null ) ? sanitize_key( $type['postType'] ) : null ),
			static fn( $value ) => null !== $value
		);
	}
	return $parsed;
}

/** POST /match: the post type each SiteForge type would use; nothing is changed. */
function siteforge_importer_rest_match( WP_REST_Request $request ) {
	$body  = (array) $request->get_json_params();
	$types = siteforge_importer_parse_types( $body['types'] ?? null, 100 );
	if ( is_wp_error( $types ) ) {
		return $types;
	}
	$spec    = siteforge_importer_get_spec();
	$reuse   = ! isset( $body['reuseExisting'] ) || false !== $body['reuseExisting'];
	$matches = array();
	foreach ( $types as $type ) {
		$matches[] = array( 'name' => $type['name'], 'label' => $type['label'] ) + siteforge_importer_match_type( $type, $spec, $reuse );
	}
	return rest_ensure_response( array( 'matches' => $matches ) );
}

/**
 * Validates one record of an import request.
 *
 * @return array|WP_Error
 */
function siteforge_importer_parse_record( $record, int $i, array $type_names ) {
	if ( ! is_array( $record ) ) {
		return siteforge_importer_invalid( "records[$i] must be an object." );
	}
	$external = $record['externalId'] ?? null;
	if ( ! is_string( $external ) || ! preg_match( '/^[A-Za-z0-9_.:-]{1,120}$/', $external ) ) {
		return siteforge_importer_invalid( "records[$i].externalId must be 1 to 120 letters, digits, dots, colons, dashes or underscores." );
	}
	if ( ! in_array( $record['type'] ?? null, $type_names, true ) ) {
		return siteforge_importer_invalid( "records[$i].type must be one of the types sent with the request." );
	}
	$title = trim( siteforge_importer_clean_text( (string) ( $record['title'] ?? '' ) ) );
	if ( '' === $title || mb_strlen( $title ) > 1000 ) {
		return siteforge_importer_invalid( "records[$i].title must be 1 to 1000 characters." );
	}
	$slug = sanitize_title( (string) ( $record['slug'] ?? $title ) );
	$time = strtotime( (string) ( $record['date'] ?? '' ) . ( preg_match( '/Z|[+-]\d\d:?\d\d$/', (string) ( $record['date'] ?? '' ) ) ? '' : ' UTC' ) );
	if ( false === $time || $time > time() ) {
		return siteforge_importer_invalid( "records[$i].date must be a past date (UTC)." );
	}
	$fields = array();
	foreach ( (array) ( $record['fields'] ?? array() ) as $name => $value ) {
		if ( ! is_string( $name ) || ! preg_match( '/^[A-Za-z][A-Za-z0-9_]{0,48}$/', $name ) || ! is_scalar( $value ) || strlen( (string) $value ) > 100000 ) {
			return siteforge_importer_invalid( "records[$i].fields must map field names to text under 100 KB." );
		}
		$fields[ $name ] = siteforge_importer_clean_text( (string) $value );
	}
	$relationships = array();
	foreach ( array_slice( (array) ( $record['relationships'] ?? array() ), 0, 100 ) as $relationship ) {
		$target = is_array( $relationship ) ? ( $relationship['targetExternalId'] ?? null ) : null;
		if ( is_string( $target ) && preg_match( '/^[A-Za-z0-9_.:-]{1,120}$/', $target ) ) {
			$relationships[] = array( 'type' => siteforge_importer_line( $relationship['type'] ?? 'related', 60 ) ?: 'related', 'targetExternalId' => $target );
		}
	}
	$image = null;
	if ( is_array( $record['image'] ?? null ) && ! empty( $record['image']['filename'] ) ) {
		$image = array(
			'filename' => (string) $record['image']['filename'],
			'source'   => siteforge_importer_line( $record['image']['source'] ?? $record['image']['filename'], 300 ),
			'alt'      => siteforge_importer_line( $record['image']['alt'] ?? '', 300 ),
			'field'    => is_string( $record['image']['field'] ?? null ) ? $record['image']['field'] : '',
			'base64'   => is_string( $record['image']['base64'] ?? null ) ? $record['image']['base64'] : '',
		);
	}
	$terms = array();
	foreach ( array_slice( (array) ( $record['terms']['topic'] ?? array() ), 0, 20 ) as $term ) {
		$term = siteforge_importer_line( $term, 100 );
		if ( '' !== $term ) {
			$terms[] = $term;
		}
	}
	return array(
		'externalId'    => $external,
		'type'          => $record['type'],
		'title'         => $title,
		'slug'          => '' !== $slug ? $slug : sanitize_title( $external ),
		'path'          => siteforge_importer_line( $record['path'] ?? '', 500 ),
		'date'          => gmdate( 'Y-m-d H:i:s', $time ),
		'order'         => max( 0, min( 2147483647, (int) ( $record['order'] ?? 0 ) ) ),
		'fields'        => $fields,
		'relationships' => $relationships,
		'image'         => $image,
		'terms'         => $terms,
	);
}

/** POST /import: creates or updates a batch of records (at most 200). Safe to repeat: posts are matched by external ID. */
function siteforge_importer_rest_import( WP_REST_Request $request ) {
	$body    = (array) $request->get_json_params();
	$site_id = siteforge_importer_site_id( $body['site']['id'] ?? null );
	if ( ! $site_id ) {
		return siteforge_importer_invalid( 'site.id must be a SiteForge site ID (lowercase letters, digits and dashes).' );
	}
	$site_name = siteforge_importer_line( $body['site']['name'] ?? $site_id, 150 );
	$builder   = 'elementor' === ( $body['builder'] ?? 'blocks' ) ? 'elementor' : 'blocks';
	$types     = siteforge_importer_parse_types( $body['types'] ?? null );
	if ( is_wp_error( $types ) ) {
		return $types;
	}
	$records = $body['records'] ?? array();
	if ( ! is_array( $records ) || count( $records ) > 200 ) {
		return siteforge_importer_invalid( 'records must be a list of at most 200 records.' );
	}
	$parsed = array();
	foreach ( array_values( $records ) as $i => $record ) {
		$item = siteforge_importer_parse_record( $record, $i, array_column( $types, 'name' ) );
		if ( is_wp_error( $item ) ) {
			return $item;
		}
		$parsed[] = $item;
	}
	if ( function_exists( 'set_time_limit' ) ) {
		@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- not allowed on every host.
	}
	$applied = siteforge_importer_apply_types( $site_id, $site_name, $builder, $types, ! isset( $body['reuseExisting'] ) || false !== $body['reuseExisting'] );
	$elementor_used = 'elementor' === $builder && siteforge_importer_elementor_active();
	if ( $elementor_used ) {
		siteforge_importer_elementor_support( array_values( $applied['map'] ) );
	}
	$targets = array();
	foreach ( $parsed as $record ) {
		$targets = array_merge( $targets, array( $record['externalId'] ), array_column( $record['relationships'], 'targetExternalId' ) );
	}
	$context = array(
		'siteId'   => $site_id,
		'map'      => $applied['map'],
		'builder'  => $builder,
		'author'   => siteforge_importer_author_id(),
		'taxonomy' => siteforge_importer_get_spec()['taxonomy'],
		'known'    => siteforge_importer_find_posts( $site_id, $targets ),
	);
	global $wpdb;
	$results = array();
	$counts  = array( 'created' => 0, 'updated' => 0, 'unchanged' => 0, 'failed' => 0 );
	// One transaction per batch: much faster on SQLite, and a batch that dies half-way leaves no partial rows.
	$wpdb->query( 'START TRANSACTION' );
	wp_defer_term_counting( true );
	try {
		foreach ( $parsed as $record ) {
			$result = siteforge_importer_import_record( $record, $context );
			++$counts[ $result['status'] ];
			$results[] = $result;
		}
	} finally {
		wp_defer_term_counting( false );
		$wpdb->query( 'COMMIT' );
	}
	return rest_ensure_response(
		array(
			'siteId'    => $site_id,
			'builder'   => $builder,
			'elementor' => $elementor_used,
			'types'     => $applied['types'],
			'results'   => $results,
		) + $counts
	);
}

/** POST /relationships {siteId, offset?, limit?}: resolves relationships for a slice of records. */
function siteforge_importer_rest_relationships( WP_REST_Request $request ) {
	$body    = (array) $request->get_json_params();
	$site_id = siteforge_importer_site_id( $body['siteId'] ?? null );
	if ( ! $site_id || ! isset( siteforge_importer_get_spec()['sites'][ $site_id ] ) ) {
		return new WP_Error( 'siteforge_unknown_site', 'siteId must name an imported site.', array( 'status' => 404 ) );
	}
	global $wpdb;
	$wpdb->query( 'START TRANSACTION' );
	try {
		$result = siteforge_importer_resolve_site_relationships( $site_id, max( 0, (int) ( $body['offset'] ?? 0 ) ), max( 1, min( 1000, (int) ( $body['limit'] ?? 200 ) ) ) );
	} finally {
		$wpdb->query( 'COMMIT' );
	}
	return rest_ensure_response( $result );
}

/** POST /pages {siteId, title?, intro?, setFrontPage?}: the Home page with links to each type's archive. */
function siteforge_importer_rest_pages( WP_REST_Request $request ) {
	$body    = (array) $request->get_json_params();
	$site_id = siteforge_importer_site_id( $body['siteId'] ?? null );
	$spec    = siteforge_importer_get_spec();
	if ( ! $site_id || ! isset( $spec['sites'][ $site_id ] ) ) {
		return new WP_Error( 'siteforge_unknown_site', 'siteId must name an imported site.', array( 'status' => 404 ) );
	}
	$title  = siteforge_importer_line( $body['title'] ?? 'Home', 200 );
	$intro  = trim( siteforge_importer_clean_text( (string) ( $body['intro'] ?? '' ) ) );
	$result = siteforge_importer_home_page( $site_id, '' !== $title ? $title : 'Home', mb_substr( $intro, 0, 5000 ), ! empty( $body['setFrontPage'] ) );
	if ( isset( $result['error'] ) ) {
		return new WP_Error( 'siteforge_page', $result['error'], array( 'status' => 500 ) );
	}
	return rest_ensure_response( $result );
}

/** POST /reset {siteId, limit?}: deletes up to `limit` items per call; repeat until done is true. */
function siteforge_importer_rest_reset( WP_REST_Request $request ) {
	$body    = (array) $request->get_json_params();
	$site_id = siteforge_importer_site_id( $body['siteId'] ?? null );
	if ( ! $site_id ) {
		return siteforge_importer_invalid( 'siteId must be a SiteForge site ID.' );
	}
	global $wpdb;
	$wpdb->query( 'START TRANSACTION' );
	try {
		$result = siteforge_importer_reset_site( $site_id, max( 1, min( 1000, (int) ( $body['limit'] ?? 200 ) ) ) );
	} finally {
		$wpdb->query( 'COMMIT' );
	}
	return rest_ensure_response( $result + array( 'siteId' => $site_id ) );
}

/** GET /answer-key?siteId=&offset=&limit= : the answer key (limit 0 or absent: every page). */
function siteforge_importer_rest_answer_key( WP_REST_Request $request ) {
	$site_id = siteforge_importer_site_id( $request->get_param( 'siteId' ) );
	if ( ! $site_id ) {
		return siteforge_importer_invalid( 'siteId must be a SiteForge site ID.' );
	}
	$key = siteforge_importer_answer_key( $site_id, max( 0, (int) $request->get_param( 'offset' ) ), max( 0, min( 5000, (int) $request->get_param( 'limit' ) ) ) );
	if ( is_wp_error( $key ) ) {
		return $key;
	}
	$response = rest_ensure_response( $key );
	$response->header( 'Cache-Control', 'no-store' );
	return $response;
}
