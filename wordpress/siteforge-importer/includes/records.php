<?php
/**
 * Creating, updating and deleting the posts of an imported SiteForge site.
 *
 * Every imported post carries _siteforge_site_id, _siteforge_external_id and _siteforge_key (site:external ID), so a
 * second import of the same site updates the same posts. Its field values are stored as post meta (one key per
 * field) and as _siteforge_fields (the values exactly as written into the content), from which the content can be
 * rebuilt when relationships are resolved.
 *
 * @package SiteForgeImporter
 */

defined( 'ABSPATH' ) || exit;

/** First administrator, used as the author of imported posts (0 when the site has none). */
function siteforge_importer_author_id(): int {
	$users = get_users( array( 'role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ID' ) );
	return $users ? (int) $users[0] : 0;
}

/**
 * Adds a site's types to the spec, choosing for each one an existing or a new post type. Registers new types in the
 * current request and rebuilds the rewrite rules once when the registration changed.
 *
 * @return array{map: array<string,string>, types: array}
 */
function siteforge_importer_apply_types( string $site_id, string $site_name, string $builder, array $types, bool $reuse ): array {
	$spec             = siteforge_importer_get_spec();
	$spec['taxonomy'] = siteforge_importer_topic_taxonomy( $spec );
	$site             = $spec['sites'][ $site_id ] ?? array( 'id' => $site_id, 'types' => array(), 'homePageId' => 0 );
	$map              = array();
	$summary          = array();
	foreach ( $types as $type ) {
		$name = $type['name'];
		if ( isset( $site['types'][ $name ] ) && isset( $spec['postTypes'][ $site['types'][ $name ] ] ) ) {
			$key   = $site['types'][ $name ];
			$match = array( 'postType' => $key, 'reused' => ! empty( $spec['postTypes'][ $key ]['reused'] ), 'reason' => 'previous import' );
		} else {
			$match = siteforge_importer_match_type( $type, $spec, $reuse );
			$key   = $match['postType'];
		}
		$def    = $spec['postTypes'][ $key ] ?? array( 'key' => $key, 'fields' => array(), 'sites' => array() );
		$object = $match['reused'] ? get_post_type_object( $key ) : null;
		$def    = array_merge(
			$def,
			array(
				'key'      => $key,
				'label'    => $object ? (string) $object->labels->name : $type['label'],
				'singular' => $object ? (string) $object->labels->singular_name : $type['singular'],
				'slug'     => $object && is_array( $object->rewrite ) ? (string) ( $object->rewrite['slug'] ?? $key ) : $type['slug'],
				'icon'     => $type['icon'] ?? siteforge_importer_icon( $name, $type['label'] ),
				'reused'   => (bool) $match['reused'],
			)
		);
		// Fields of every site that uses the post type (by name; the latest label and display win).
		$fields = array();
		foreach ( $def['fields'] as $field ) {
			$fields[ $field['name'] ] = $field;
		}
		foreach ( $type['fields'] as $field ) {
			$fields[ $field['name'] ] = array(
				'name'    => $field['name'],
				'metaKey' => siteforge_importer_meta_key( $field['name'] ),
				'label'   => $field['label'],
				'type'    => $field['type'],
				'display' => $field['display'],
			);
		}
		$def['fields']            = array_values( $fields );
		$def['sites'][ $site_id ] = $name;
		$spec['postTypes'][ $key ] = $def;
		$map[ $name ]             = $key;
		$summary[]                = array( 'name' => $name, 'postType' => $key, 'reused' => (bool) $match['reused'], 'reason' => $match['reason'], 'label' => $def['label'], 'slug' => $def['slug'] );
	}
	$site['name']             = $site_name;
	$site['builder']          = $builder;
	$site['types']            = array_merge( $site['types'], $map );
	$site['order']            = array_keys( $site['types'] );
	$spec['sites'][ $site_id ] = $site;
	if ( siteforge_importer_save_spec( $spec ) ) {
		// Own types whose registration changed are registered again with the new settings.
		foreach ( $spec['postTypes'] as $key => $def ) {
			$object = get_post_type_object( $key );
			if ( empty( $def['reused'] ) && $object && ( ( $object->rewrite['slug'] ?? '' ) !== $def['slug'] || $object->labels->name !== $def['label'] ) ) {
				unregister_post_type( $key );
			}
		}
		siteforge_importer_register_all( $spec );
		flush_rewrite_rules( false );
		update_option( SITEFORGE_IMPORTER_FLUSH_OPTION, siteforge_importer_spec_hash( $spec ), true );
	}
	foreach ( $summary as &$item ) {
		$link                = get_post_type_archive_link( $item['postType'] );
		$item['archiveUrl'] = $link ? $link : null;
	}
	return array( 'map' => $map, 'types' => $summary );
}

/**
 * Post IDs of imported records, by external ID, for one site.
 *
 * @return array<string,int>
 */
function siteforge_importer_find_posts( string $site_id, array $external_ids ): array {
	global $wpdb;
	$external_ids = array_values( array_unique( array_filter( array_map( 'strval', $external_ids ), 'strlen' ) ) );
	if ( ! $external_ids ) {
		return array();
	}
	$found = array();
	foreach ( array_chunk( $external_ids, 500 ) as $chunk ) {
		$keys         = array_map( static fn( $id ) => $site_id . ':' . $id, $chunk );
		$placeholders = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholders are generated above.
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT m.post_id, m.meta_value FROM {$wpdb->postmeta} m INNER JOIN {$wpdb->posts} p ON p.ID = m.post_id WHERE m.meta_key = '_siteforge_key' AND m.meta_value IN ($placeholders) ORDER BY m.post_id", $keys ) );
		foreach ( $rows as $row ) {
			$external = substr( $row->meta_value, strlen( $site_id ) + 1 );
			if ( ! isset( $found[ $external ] ) ) {
				$found[ $external ] = (int) $row->post_id;
			}
		}
	}
	return $found;
}

/**
 * Related records that exist and are published: [{ type, externalId, postId, url, title }].
 *
 * @param array<string,int> $known Post IDs already looked up, by external ID.
 */
function siteforge_importer_resolve_related( string $site_id, array $relationships, array $known = array() ): array {
	$missing = array_diff( array_column( $relationships, 'targetExternalId' ), array_keys( $known ) );
	if ( $missing ) {
		$known += siteforge_importer_find_posts( $site_id, $missing );
	}
	$related = array();
	foreach ( $relationships as $relationship ) {
		$post_id = $known[ $relationship['targetExternalId'] ] ?? 0;
		if ( ! $post_id || 'publish' !== get_post_status( $post_id ) ) {
			continue;
		}
		$related[] = array(
			'type'       => $relationship['type'],
			'externalId' => $relationship['targetExternalId'],
			'postId'     => $post_id,
			'url'        => (string) get_permalink( $post_id ),
			'title'      => html_entity_decode( (string) get_post_field( 'post_title', $post_id, 'raw' ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ),
		);
	}
	return $related;
}

/** The post type definition from the spec for a post type key. */
function siteforge_importer_definition( string $post_type ): ?array {
	$spec = siteforge_importer_get_spec();
	return $spec['postTypes'][ $post_type ] ?? null;
}

/** First sentence-sized piece of the first long text field, as a plain-text excerpt (30 words). */
function siteforge_importer_excerpt( array $def, array $written ): string {
	foreach ( $def['fields'] as $field ) {
		if ( 'text' === ( $field['display'] ?? '' ) && ! empty( $written[ $field['name'] ] ) ) {
			$words = preg_split( '/\s+/', trim( $written[ $field['name'] ] ) );
			$text  = implode( ' ', array_slice( $words, 0, 30 ) ) . ( count( $words ) > 30 ? '…' : '' );
			return esc_html( $text );
		}
	}
	return '';
}

/**
 * Writes content (and Elementor data) for a record from its stored meta and the related records that exist now.
 * Returns true when anything changed.
 */
function siteforge_importer_render_record( int $post_id, array $def, string $builder, array $related ): bool {
	$written  = json_decode( (string) get_post_meta( $post_id, '_siteforge_fields', true ), true );
	$image    = json_decode( (string) get_post_meta( $post_id, '_siteforge_image', true ), true );
	$written  = is_array( $written ) ? $written : array();
	$image    = is_array( $image ) ? $image : null;
	$external = (string) get_post_meta( $post_id, '_siteforge_external_id', true );
	$content  = siteforge_importer_blocks_content( $def, $written, $image, $related );
	$document = 'elementor' === $builder && siteforge_importer_elementor_active() ? siteforge_importer_elementor_document( $def, $external, $written, $image, $related, siteforge_importer_elementor_containers() ) : null;
	$hash     = md5( (string) wp_json_encode( array( SITEFORGE_IMPORTER_VERSION, $content, $document, defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '' ) ) );
	if ( get_post_meta( $post_id, '_siteforge_content_hash', true ) === $hash ) {
		return false;
	}
	$result = wp_update_post( wp_slash( array( 'ID' => $post_id, 'post_content' => $content ) ), true );
	if ( is_wp_error( $result ) ) {
		return false;
	}
	siteforge_importer_write_elementor( $post_id, $document, 'page' === get_post_type( $post_id ) ? 'wp-page' : 'wp-post' );
	update_post_meta( $post_id, '_siteforge_related', wp_slash( (string) wp_json_encode( array_map( static fn( $item ) => array( 'type' => $item['type'], 'externalId' => $item['externalId'], 'postId' => $item['postId'] ), $related ) ) ) );
	update_post_meta( $post_id, '_siteforge_content_hash', $hash );
	return true;
}

/**
 * Creates or updates one record. $context: siteId, map (type → post type), builder, author, taxonomy, known (post IDs
 * by external ID for this batch and its relationship targets).
 *
 * @return array{externalId: string, postId?: int, url?: string, status: string, warnings?: array, error?: string}
 */
function siteforge_importer_import_record( array $record, array &$context ): array {
	$external_id = $record['externalId'];
	$post_type   = $context['map'][ $record['type'] ] ?? '';
	$def         = $post_type ? siteforge_importer_definition( $post_type ) : null;
	if ( ! $def ) {
		return array( 'externalId' => $external_id, 'status' => 'failed', 'error' => sprintf( 'Unknown content type %s; send it in types.', $record['type'] ) );
	}
	$site_id  = $context['siteId'];
	$warnings = array();
	$post_id  = $context['known'][ $external_id ] ?? 0;

	// The image: uploaded once per source path, then reused; it becomes the featured image.
	$image = siteforge_importer_attachment( $site_id, $record['image'] );
	if ( is_wp_error( $image ) ) {
		$warnings[] = $image->get_error_message();
		$image      = null;
	}

	// Values exactly as written into the content (the image field holds the media library URL path).
	$written = array();
	foreach ( $def['fields'] as $field ) {
		if ( 'image' === ( $field['display'] ?? '' ) ) {
			if ( $image && $image['field'] === $field['name'] ) {
				$written[ $field['name'] ] = $image['path'];
			}
		} elseif ( isset( $record['fields'][ $field['name'] ] ) && '' !== $record['fields'][ $field['name'] ] ) {
			$written[ $field['name'] ] = $record['fields'][ $field['name'] ];
		}
	}
	$terms    = array_values( array_unique( $record['terms'] ) );
	$related  = siteforge_importer_resolve_related( $site_id, $record['relationships'], $context['known'] );
	$builder  = $context['builder'];
	$elements = 'elementor' === $builder && siteforge_importer_elementor_active();
	// Hash of the inputs only: related links are kept up to date by the relationships pass (POST /relationships).
	$hash     = md5( (string) wp_json_encode( array( SITEFORGE_IMPORTER_VERSION, $post_type, $record['title'], $record['slug'], $record['date'], $record['order'], $record['path'], $written, $record['relationships'], $image, $terms, $builder, $elements, $def['fields'] ) ) );

	if ( $post_id && get_post_meta( $post_id, '_siteforge_hash', true ) === $hash && 'publish' === get_post_status( $post_id ) && get_post_type( $post_id ) === $post_type ) {
		return array( 'externalId' => $external_id, 'postId' => $post_id, 'url' => (string) get_permalink( $post_id ), 'status' => 'unchanged' ) + ( $warnings ? array( 'warnings' => $warnings ) : array() );
	}

	$postarr = array(
		'post_type'      => $post_type,
		'post_status'    => 'publish',
		'post_title'     => $record['title'],
		'post_name'      => $record['slug'],
		'post_date_gmt'  => $record['date'],
		'post_date'      => get_date_from_gmt( $record['date'] ),
		'post_excerpt'   => siteforge_importer_excerpt( $def, $written ),
		'post_author'    => $context['author'],
		'menu_order'     => $record['order'],
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
		'edit_date'      => true,
	);
	if ( $post_id ) {
		$postarr['ID'] = $post_id;
		$result        = wp_update_post( wp_slash( $postarr ), true );
	} else {
		$result = wp_insert_post( wp_slash( $postarr ), true );
	}
	if ( is_wp_error( $result ) ) {
		return array( 'externalId' => $external_id, 'status' => 'failed', 'error' => $result->get_error_message() );
	}
	$created = ! $post_id;
	$post_id = (int) $result;
	$context['known'][ $external_id ] = $post_id;

	update_post_meta( $post_id, '_siteforge_site_id', $site_id );
	update_post_meta( $post_id, '_siteforge_external_id', $external_id );
	update_post_meta( $post_id, '_siteforge_key', $site_id . ':' . $external_id );
	update_post_meta( $post_id, '_siteforge_type', $record['type'] );
	update_post_meta( $post_id, '_siteforge_source_path', $record['path'] );
	update_post_meta( $post_id, '_siteforge_fields', wp_slash( (string) wp_json_encode( $written, JSON_UNESCAPED_UNICODE ) ) );
	update_post_meta( $post_id, '_siteforge_relationships', wp_slash( (string) wp_json_encode( $record['relationships'] ) ) );
	foreach ( $def['fields'] as $field ) {
		if ( isset( $written[ $field['name'] ] ) ) {
			update_post_meta( $post_id, $field['metaKey'], wp_slash( $written[ $field['name'] ] ) );
		} else {
			delete_post_meta( $post_id, $field['metaKey'] );
		}
	}
	if ( $image ) {
		update_post_meta( $post_id, '_siteforge_image', wp_slash( (string) wp_json_encode( $image ) ) );
		set_post_thumbnail( $post_id, $image['id'] );
	} else {
		delete_post_meta( $post_id, '_siteforge_image' );
		delete_post_thumbnail( $post_id );
	}
	if ( $terms && taxonomy_exists( $context['taxonomy'] ) ) {
		foreach ( $terms as $term ) {
			if ( ! term_exists( $term, $context['taxonomy'] ) ) {
				$inserted = wp_insert_term( $term, $context['taxonomy'] );
				if ( ! is_wp_error( $inserted ) ) {
					add_term_meta( (int) $inserted['term_id'], '_siteforge_created', $site_id, true );
				}
			}
		}
		wp_set_object_terms( $post_id, $terms, $context['taxonomy'] );
	}
	siteforge_importer_render_record( $post_id, $def, $builder, $related );
	update_post_meta( $post_id, '_siteforge_hash', $hash );
	return array( 'externalId' => $external_id, 'postId' => $post_id, 'url' => (string) get_permalink( $post_id ), 'status' => $created ? 'created' : 'updated' ) + ( $warnings ? array( 'warnings' => $warnings ) : array() );
}

/**
 * IDs of a site's imported records (not its media or home page), in import order.
 *
 * @return int[]
 */
function siteforge_importer_record_ids( string $site_id, int $offset = 0, int $limit = 0, bool $published_only = false ): array {
	global $wpdb;
	$status = $published_only ? "AND p.post_status = 'publish'" : '';
	$range  = $limit > 0 ? $wpdb->prepare( 'LIMIT %d OFFSET %d', $limit, $offset ) : '';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $status and $range are fixed or prepared fragments.
	return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT p.ID FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} s ON s.post_id = p.ID AND s.meta_key = '_siteforge_site_id' AND s.meta_value = %s INNER JOIN {$wpdb->postmeta} k ON k.post_id = p.ID AND k.meta_key = '_siteforge_key' WHERE p.post_type <> 'attachment' $status ORDER BY p.menu_order ASC, p.ID ASC $range", $site_id ) ) );
}

/** Number of a site's imported records. */
function siteforge_importer_record_count( string $site_id, bool $published_only = false ): int {
	global $wpdb;
	$status = $published_only ? "AND p.post_status = 'publish'" : '';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $status is a fixed fragment.
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} s ON s.post_id = p.ID AND s.meta_key = '_siteforge_site_id' AND s.meta_value = %s INNER JOIN {$wpdb->postmeta} k ON k.post_id = p.ID AND k.meta_key = '_siteforge_key' WHERE p.post_type <> 'attachment' $status", $site_id ) );
}

/**
 * Resolves the relationships of up to $limit records (from $offset): stores the related post IDs as meta
 * (_siteforge_rel_<post type> = post ID) and rebuilds the content with a "Related" list of real links.
 *
 * @return array{processed: int, updated: int, total: int, nextOffset: int|null}
 */
function siteforge_importer_resolve_site_relationships( string $site_id, int $offset, int $limit ): array {
	$spec    = siteforge_importer_get_spec();
	$builder = $spec['sites'][ $site_id ]['builder'] ?? 'blocks';
	$ids     = siteforge_importer_record_ids( $site_id, $offset, $limit );
	$updated = 0;
	$records = array();
	$targets = array();
	foreach ( $ids as $post_id ) {
		$relationships = json_decode( (string) get_post_meta( $post_id, '_siteforge_relationships', true ), true );
		$relationships = is_array( $relationships ) ? $relationships : array();
		$records[]     = array( $post_id, $relationships );
		$targets       = array_merge( $targets, array_column( $relationships, 'targetExternalId' ) );
	}
	$known = siteforge_importer_find_posts( $site_id, $targets );
	foreach ( $records as [ $post_id, $relationships ] ) {
		$def = siteforge_importer_definition( (string) get_post_type( $post_id ) );
		if ( ! $def ) {
			continue;
		}
		$related = siteforge_importer_resolve_related( $site_id, $relationships, $known );
		// One meta key per related post type, e.g. _siteforge_rel_sf_author on a book.
		$by_type = array();
		foreach ( $related as $item ) {
			$by_type[ '_siteforge_rel_' . get_post_type( $item['postId'] ) ][] = $item['postId'];
		}
		foreach ( array_keys( get_post_meta( $post_id ) ) as $key ) {
			if ( str_starts_with( $key, '_siteforge_rel_' ) && ! isset( $by_type[ $key ] ) ) {
				delete_post_meta( $post_id, $key );
			}
		}
		foreach ( $by_type as $key => $values ) {
			$current = array_map( 'intval', get_post_meta( $post_id, $key ) );
			if ( $current !== $values ) {
				delete_post_meta( $post_id, $key );
				foreach ( $values as $value ) {
					add_post_meta( $post_id, $key, $value );
				}
			}
		}
		if ( siteforge_importer_render_record( $post_id, $def, $builder, $related ) ) {
			++$updated;
		}
	}
	$total = siteforge_importer_record_count( $site_id );
	$next  = $offset + count( $ids );
	return array( 'processed' => count( $ids ), 'updated' => $updated, 'total' => $total, 'nextOffset' => count( $ids ) === $limit && $next < $total ? $next : null );
}

/**
 * Creates or updates the site's "Home" page: intro text and links to each content type's archive. Optionally makes
 * it the static front page (the previous front page settings are kept and restored on reset).
 */
function siteforge_importer_home_page( string $site_id, string $title, string $intro, bool $front_page ): array {
	$spec = siteforge_importer_get_spec();
	$site = $spec['sites'][ $site_id ];
	$links = array();
	foreach ( $site['types'] as $post_type ) {
		$object = get_post_type_object( $post_type );
		$link   = get_post_type_archive_link( $post_type );
		if ( $object && $link ) {
			$links[] = array( 'title' => (string) $object->labels->name, 'url' => (string) $link );
		}
	}
	$blocks = array();
	if ( '' !== $intro ) {
		$blocks[] = siteforge_importer_block( 'paragraph', array(), '<p>' . siteforge_importer_inline( $intro ) . '</p>' );
	}
	$blocks[] = siteforge_importer_block( 'heading', array(), '<h2 class="wp-block-heading">' . esc_html__( 'Browse', 'siteforge-importer' ) . '</h2>' );
	$items    = '';
	foreach ( $links as $link ) {
		$items .= "<!-- wp:list-item -->\n" . sprintf( '<li><a href="%s">%s</a></li>', esc_url( $link['url'] ), siteforge_importer_text( $link['title'] ) ) . "\n<!-- /wp:list-item -->";
	}
	$blocks[] = siteforge_importer_block( 'list', array( 'className' => 'section-links' ), '<ul class="wp-block-list section-links">' . $items . '</ul>' );
	$postarr  = array(
		'post_type'      => 'page',
		'post_status'    => 'publish',
		'post_title'     => $title,
		'post_content'   => implode( "\n\n", $blocks ),
		'post_author'    => siteforge_importer_author_id(),
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
	);
	$page_id  = (int) ( $site['homePageId'] ?? 0 );
	if ( $page_id && get_post( $page_id ) && 'page' === get_post_type( $page_id ) ) {
		$postarr['ID'] = $page_id;
		$result        = wp_update_post( wp_slash( $postarr ), true );
	} else {
		$postarr['post_name'] = sanitize_title( $title );
		$result               = wp_insert_post( wp_slash( $postarr ), true );
	}
	if ( is_wp_error( $result ) ) {
		return array( 'error' => $result->get_error_message() );
	}
	$page_id = (int) $result;
	update_post_meta( $page_id, '_siteforge_site_id', $site_id );
	update_post_meta( $page_id, '_siteforge_home', '1' );
	update_post_meta( $page_id, '_siteforge_fields', wp_slash( (string) wp_json_encode( array( 'summary' => $intro ), JSON_UNESCAPED_UNICODE ) ) );
	if ( 'elementor' === ( $site['builder'] ?? '' ) && siteforge_importer_elementor_active() ) {
		$def = array( 'fields' => array( array( 'name' => 'summary', 'label' => '', 'display' => 'text' ) ) );
		$doc = siteforge_importer_elementor_document( $def, 'home-' . $site_id, '' !== $intro ? array( 'summary' => $intro ) : array(), null, array_map( static fn( $link ) => $link + array( 'type' => 'section', 'externalId' => '', 'postId' => 0 ), $links ), siteforge_importer_elementor_containers() );
		siteforge_importer_write_elementor( $page_id, $doc, 'wp-page' );
		siteforge_importer_elementor_support( array( 'page' ) );
	} else {
		siteforge_importer_write_elementor( $page_id, null, 'wp-page' );
	}
	if ( $front_page ) {
		if ( ! isset( $site['previousFront'] ) ) {
			$site['previousFront'] = array( 'show_on_front' => get_option( 'show_on_front' ), 'page_on_front' => (int) get_option( 'page_on_front' ) );
		}
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $page_id );
	}
	$site['homePageId']        = $page_id;
	$site['homeIsFront']       = $front_page || ( 'page' === get_option( 'show_on_front' ) && (int) get_option( 'page_on_front' ) === $page_id );
	$spec['sites'][ $site_id ] = $site;
	siteforge_importer_save_spec( $spec );
	return array( 'pageId' => $page_id, 'url' => (string) get_permalink( $page_id ), 'frontPage' => $site['homeIsFront'], 'links' => count( $links ) );
}

/**
 * Deletes up to $limit posts and media created for a site. When nothing is left, also removes the terms it
 * created, its types from the spec (types still holding other posts are kept), Elementor post type settings and the
 * static front page setting it made.
 *
 * @return array{deleted: int, remaining: int, done: bool}
 */
function siteforge_importer_reset_site( string $site_id, int $limit ): array {
	global $wpdb;
	// The front page settings are restored first: deleting the page WordPress shows as front page resets them.
	$spec = siteforge_importer_get_spec();
	$site = $spec['sites'][ $site_id ] ?? null;
	if ( $site && ! empty( $site['previousFront'] ) && (int) get_option( 'page_on_front' ) === (int) ( $site['homePageId'] ?? 0 ) ) {
		update_option( 'show_on_front', $site['previousFront']['show_on_front'] );
		update_option( 'page_on_front', (int) $site['previousFront']['page_on_front'] );
	}
	$ids     = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_siteforge_site_id' AND meta_value = %s ORDER BY post_id LIMIT %d", $site_id, $limit ) ) );
	$deleted = 0;
	wp_defer_term_counting( true );
	foreach ( $ids as $id ) {
		$post = get_post( $id );
		if ( ! $post ) {
			delete_metadata( 'post', $id, '_siteforge_site_id' );
			continue;
		}
		$ok = 'attachment' === $post->post_type ? wp_delete_attachment( $id, true ) : wp_delete_post( $id, true );
		if ( $ok ) {
			++$deleted;
		} else {
			delete_metadata( 'post', $id, '_siteforge_site_id' );
		}
	}
	wp_defer_term_counting( false );
	$remaining = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_siteforge_site_id' AND meta_value = %s", $site_id ) );
	if ( $remaining > 0 ) {
		return array( 'deleted' => $deleted, 'remaining' => $remaining, 'done' => false );
	}
	$spec     = siteforge_importer_get_spec();
	$taxonomy = $spec['taxonomy'];
	// Terms this site created that no longer hold any post.
	$term_ids = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT term_id FROM {$wpdb->termmeta} WHERE meta_key = '_siteforge_created' AND meta_value = %s", $site_id ) ) );
	foreach ( $term_ids as $term_id ) {
		$term = get_term( $term_id );
		if ( $term && ! is_wp_error( $term ) ) {
			wp_update_term_count_now( array( $term_id ), $term->taxonomy );
			$term = get_term( $term_id );
			if ( $term && ! is_wp_error( $term ) && 0 === (int) $term->count ) {
				wp_delete_term( $term_id, $term->taxonomy );
			}
		}
	}
	unset( $spec['sites'][ $site_id ] );
	$removed = array();
	foreach ( $spec['postTypes'] as $key => $def ) {
		unset( $def['sites'][ $site_id ] );
		$spec['postTypes'][ $key ] = $def;
		if ( ! $def['sites'] ) {
			$left = empty( $def['reused'] ) ? (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s AND post_status NOT IN ('auto-draft')", $key ) ) : 0;
			if ( 0 === $left ) {
				unset( $spec['postTypes'][ $key ] );
				$removed[] = $key;
			}
		}
	}
	$support = get_option( 'elementor_cpt_support' );
	if ( is_array( $support ) && $removed ) {
		update_option( 'elementor_cpt_support', array_values( array_diff( $support, array_filter( $removed, static fn( $key ) => ! in_array( $key, array( 'post', 'page' ), true ) ) ) ) );
	}
	if ( siteforge_importer_save_spec( $spec ) ) {
		foreach ( $removed as $key ) {
			if ( post_type_exists( $key ) && ! in_array( $key, get_post_types( array( '_builtin' => true ) ), true ) ) {
				unregister_post_type( $key );
			}
		}
		flush_rewrite_rules( false );
		update_option( SITEFORGE_IMPORTER_FLUSH_OPTION, siteforge_importer_spec_hash( $spec ), true );
	}
	return array( 'deleted' => $deleted, 'remaining' => 0, 'done' => true, 'removedTypes' => $removed );
}

/**
 * Imported items per site and post type.
 *
 * @return array<int, array{siteId: string, name: string, counts: array<string,int>, records: int, media: int}>
 */
function siteforge_importer_site_counts(): array {
	global $wpdb;
	$spec  = siteforge_importer_get_spec();
	$rows  = $wpdb->get_results( "SELECT m.meta_value AS site, p.post_type AS type, COUNT(*) AS n FROM {$wpdb->postmeta} m INNER JOIN {$wpdb->posts} p ON p.ID = m.post_id WHERE m.meta_key = '_siteforge_site_id' GROUP BY m.meta_value, p.post_type" );
	$sites = array();
	foreach ( $rows as $row ) {
		$sites[ $row->site ] ??= array( 'siteId' => $row->site, 'name' => (string) ( $spec['sites'][ $row->site ]['name'] ?? $row->site ), 'counts' => array(), 'records' => 0, 'media' => 0, 'pages' => 0 );
		if ( 'attachment' === $row->type ) {
			$sites[ $row->site ]['media'] += (int) $row->n;
		} elseif ( 'page' === $row->type && ! in_array( 'page', $spec['sites'][ $row->site ]['types'] ?? array(), true ) ) {
			$sites[ $row->site ]['pages'] += (int) $row->n;
		} else {
			$sites[ $row->site ]['counts'][ $row->type ] = (int) $row->n;
			$sites[ $row->site ]['records']             += (int) $row->n;
		}
	}
	foreach ( $spec['sites'] as $site_id => $site ) {
		$sites[ $site_id ] ??= array( 'siteId' => $site_id, 'name' => (string) ( $site['name'] ?? $site_id ), 'counts' => array(), 'records' => 0, 'media' => 0, 'pages' => 0 );
		$sites[ $site_id ]['types']   = $site['types'] ?? array();
		$sites[ $site_id ]['builder'] = $site['builder'] ?? 'blocks';
	}
	return array_values( $sites );
}
