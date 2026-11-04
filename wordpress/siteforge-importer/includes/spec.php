<?php
/**
 * The stored type spec (option `siteforge_types`) and everything registered from it on `init`: custom post types,
 * their post meta, the topic taxonomy and admin list columns. Also decides which SiteForge content types map to
 * post types the site already has.
 *
 * Spec shape:
 *   version   1
 *   taxonomy  taxonomy used for topics ('topic', or 'sf_topic' when 'topic' is taken by a post type)
 *   postTypes key => { key, label, singular, slug, icon, reused, fields: [{ name, metaKey, label, type, display }], sites: { siteId => SiteForge type name } }
 *   sites     siteId => { id, name, builder, types: { SiteForge type name => post type key }, order: [type names], homePageId, updatedAt }
 *
 * @package SiteForgeImporter
 */

defined( 'ABSPATH' ) || exit;

/** Post type keys WordPress reserves (query vars and rewrite tags); a SiteForge type with such a name gets an sf_ prefix. */
const SITEFORGE_IMPORTER_RESERVED = array( 'attachment', 'attachment_id', 'author', 'author_name', 'calendar', 'cat', 'category', 'category_name', 'comments_popup', 'cpage', 'custom', 'customize_messenger_channel', 'customized', 'day', 'debug', 'embed', 'error', 'exact', 'feed', 'fields', 'hour', 'link_category', 'm', 'minute', 'monthnum', 'more', 'name', 'nav_menu', 'nonce', 'nopaging', 'offset', 'order', 'orderby', 'p', 'page', 'page_id', 'paged', 'pagename', 'pb', 'perm', 'post', 'post_format', 'post_mime_type', 'post_status', 'post_tag', 'post_type', 'posts', 'posts_per_archive_page', 'posts_per_page', 'preview', 'robots', 's', 'search', 'second', 'sentence', 'showposts', 'static', 'status', 'subpost', 'subpost_id', 'tag', 'tag_id', 'taxonomy', 'tb', 'term', 'terms', 'theme', 'title', 'type', 'types', 'w', 'withcomments', 'withoutcomments', 'year', 'revision', 'nav_menu_item', 'action' );

/** Post types of well-known plugins that hold the same kind of content as a SiteForge type. */
const SITEFORGE_IMPORTER_ALIASES = array(
	'event'       => array( 'tribe_events', 'events', 'mec-events', 'ajde_events', 'event_listing', 'event-organiser', 'em_event', 'sc_event' ),
	'book'        => array( 'books', 'mbm_book', 'book_review' ),
	'author'      => array( 'authors', 'book_author', 'writer' ),
	'exhibition'  => array( 'exhibitions', 'exhibit' ),
	'course'      => array( 'courses', 'sfwd-courses', 'lp_course', 'tutor_course' ),
	'faculty'     => array( 'people', 'staff', 'team', 'team_member' ),
	'provider'    => array( 'doctor', 'doctors', 'physician' ),
	'publication' => array( 'publications', 'document', 'documents' ),
	'release'     => array( 'releases', 'changelog' ),
	'guide'       => array( 'docs', 'documentation', 'kb', 'knowledgebase' ),
	'location'    => array( 'locations', 'wpsl_stores' ),
	'branch'      => array( 'branches', 'locations', 'location' ),
	'office'      => array( 'offices', 'locations', 'location' ),
	'project'     => array( 'projects', 'portfolio' ),
	'grant'       => array( 'grants', 'funding' ),
	'article'     => array( 'articles', 'news' ),
	'resource'    => array( 'resources' ),
	'object'      => array( 'objects', 'artwork', 'artworks', 'collection_item' ),
	'creator'     => array( 'creators', 'artist', 'artists' ),
);

/** Returns the stored spec, normalized. Values in another format (e.g. from a SiteForge theme) are ignored. */
function siteforge_importer_get_spec(): array {
	$spec = get_option( SITEFORGE_IMPORTER_SPEC_OPTION, array() );
	if ( is_string( $spec ) ) {
		$decoded = json_decode( $spec, true );
		$spec    = is_array( $decoded ) ? $decoded : array();
	}
	if ( ! is_array( $spec ) || ( $spec['version'] ?? null ) !== 1 || ! isset( $spec['postTypes'] ) || ! is_array( $spec['postTypes'] ) ) {
		$spec = array();
	}
	return array(
		'version'   => 1,
		'taxonomy'  => is_string( $spec['taxonomy'] ?? null ) ? sanitize_key( $spec['taxonomy'] ) : 'topic',
		'postTypes' => is_array( $spec['postTypes'] ?? null ) ? $spec['postTypes'] : array(),
		'sites'     => is_array( $spec['sites'] ?? null ) ? $spec['sites'] : array(),
	);
}

/**
 * Saves the spec when it differs from the stored one. Returns true when the registered types changed, so the caller
 * registers them in the current request and rebuilds the rewrite rules once.
 */
function siteforge_importer_save_spec( array $spec ): bool {
	$previous = siteforge_importer_get_spec();
	if ( wp_json_encode( $previous ) !== wp_json_encode( $spec ) ) {
		update_option( SITEFORGE_IMPORTER_SPEC_OPTION, $spec, true );
	}
	return siteforge_importer_spec_hash( $previous ) !== siteforge_importer_spec_hash( $spec );
}

/** Hash of the parts of the spec that affect registration and rewrite rules (types, slugs, fields, taxonomy). */
function siteforge_importer_spec_hash( array $spec ): string {
	$types = array();
	foreach ( $spec['postTypes'] as $key => $def ) {
		$types[ $key ] = array( $def['slug'] ?? '', ! empty( $def['reused'] ), $def['label'] ?? '', $def['singular'] ?? '', $def['icon'] ?? '', wp_list_pluck( $def['fields'] ?? array(), 'metaKey' ) );
	}
	ksort( $types );
	return md5( (string) wp_json_encode( array( $types, $spec['taxonomy'] ) ) );
}

/** Post type key for a SiteForge type name: snake_case, at most 20 characters, never a reserved term. */
function siteforge_importer_post_type_key( string $name ): string {
	$key = strtolower( (string) preg_replace( '/([a-z0-9])([A-Z])/', '$1_$2', $name ) );
	$key = (string) preg_replace( '/[^a-z0-9_]/', '', $key );
	if ( '' === $key ) {
		$key = 'record';
	}
	if ( in_array( $key, SITEFORGE_IMPORTER_RESERVED, true ) ) {
		$key = 'sf_' . $key;
	}
	return substr( $key, 0, 20 );
}

/** Meta key for a SiteForge field name: snake_case (publicationDate → publication_date). */
function siteforge_importer_meta_key( string $name ): string {
	$key = strtolower( (string) preg_replace( '/([a-z0-9])([A-Z])/', '$1_$2', $name ) );
	$key = (string) preg_replace( '/[^a-z0-9_]/', '', $key );
	return '' === $key ? 'field' : $key;
}

/** Dashicon for a content type, from its name and label. */
function siteforge_importer_icon( string $name, string $label ): string {
	$text  = strtolower( $name . ' ' . $label );
	$icons = array(
		'book|catalog|title'                                => 'dashicons-book',
		'author|creator|writer|journalist|faculty|provider|people|staff' => 'dashicons-admin-users',
		'event|meeting|exhibition|calendar|program'          => 'dashicons-calendar-alt',
		'branch|office|clinic|department|location|visit'     => 'dashicons-building',
		'object|collection|artwork'                          => 'dashicons-format-gallery',
		'record|finding|archive|report|publication|policy|notice' => 'dashicons-media-document',
		'guide|tutorial|reference|resource|learning|course|research' => 'dashicons-welcome-learn-more',
		'release|edition'                                    => 'dashicons-update',
		'article|news|feature'                               => 'dashicons-megaphone',
		'project|grant|opportunity|volunteer|service'        => 'dashicons-heart',
	);
	foreach ( $icons as $pattern => $icon ) {
		if ( preg_match( '/' . $pattern . '/', $text ) ) {
			return $icon;
		}
	}
	return 'dashicons-database';
}

/** Post type keys this plugin registers itself (not reused ones). */
function siteforge_importer_own_post_types( ?array $spec = null ): array {
	$spec = $spec ?? siteforge_importer_get_spec();
	$own  = array();
	foreach ( $spec['postTypes'] as $key => $def ) {
		if ( empty( $def['reused'] ) ) {
			$own[] = $key;
		}
	}
	return $own;
}

/**
 * Chooses the post type for one SiteForge type: an explicit `postType`, a type this plugin already registered, an
 * existing post type with the same key, slug or label (or a well-known alias, e.g. event → tribe_events) unless
 * $reuse is false, or a new key.
 *
 * @return array{postType: string, reused: bool, reason: string}
 */
function siteforge_importer_match_type( array $type, array $spec, bool $reuse ): array {
	$own    = siteforge_importer_own_post_types( $spec );
	$wanted = siteforge_importer_post_type_key( $type['name'] );
	if ( ! empty( $type['postType'] ) ) {
		$explicit = sanitize_key( $type['postType'] );
		if ( post_type_exists( $explicit ) && ! in_array( $explicit, $own, true ) ) {
			return array( 'postType' => $explicit, 'reused' => true, 'reason' => 'requested' );
		}
		return array( 'postType' => substr( $explicit, 0, 20 ), 'reused' => false, 'reason' => 'requested' );
	}
	if ( isset( $spec['postTypes'][ $wanted ] ) ) {
		return array( 'postType' => $wanted, 'reused' => ! empty( $spec['postTypes'][ $wanted ]['reused'] ), 'reason' => 'previous import' );
	}
	if ( $reuse ) {
		$names    = array_unique( array_filter( array( $wanted, sanitize_key( $type['name'] ), sanitize_key( $type['slug'] ?? '' ), sanitize_key( $type['singular'] ?? '' ), sanitize_key( str_replace( '-', '_', $type['slug'] ?? '' ) ) ) ) );
		$aliases  = SITEFORGE_IMPORTER_ALIASES[ $type['name'] ] ?? array();
		$label    = strtolower( trim( (string) ( $type['label'] ?? '' ) ) );
		$singular = strtolower( trim( (string) ( $type['singular'] ?? '' ) ) );
		$found    = null;
		foreach ( get_post_types( array( '_builtin' => false, 'show_ui' => true ), 'objects' ) as $object ) {
			if ( in_array( $object->name, $own, true ) ) {
				continue;
			}
			$reason = null;
			if ( in_array( $object->name, $names, true ) ) {
				$reason = 'same key';
			} elseif ( '' !== $label && strtolower( (string) $object->labels->name ) === $label ) {
				$reason = 'same label';
			} elseif ( '' !== $singular && strtolower( (string) $object->labels->singular_name ) === $singular ) {
				$reason = 'same singular label';
			} elseif ( in_array( $object->name, $aliases, true ) ) {
				$reason = 'known equivalent';
			}
			// An exact key wins over a label or alias match.
			if ( $reason && ( ! $found || 'same key' === $reason ) ) {
				$found = array( 'postType' => $object->name, 'reused' => true, 'reason' => $reason );
				if ( 'same key' === $reason ) {
					break;
				}
			}
		}
		if ( $found ) {
			return $found;
		}
	}
	// A key taken by something this plugin does not own cannot be registered again, and a key that still has posts
	// of an unregistered type (left by a removed theme or plugin) would adopt them: use the next free key.
	global $wpdb;
	$candidates = array( $wanted );
	if ( ! str_starts_with( $wanted, 'sf_' ) ) {
		$candidates[] = substr( 'sf_' . $wanted, 0, 20 );
	}
	for ( $n = 2; $n < 50; $n++ ) {
		$candidates[] = substr( $wanted, 0, 20 - strlen( "_$n" ) ) . "_$n";
	}
	foreach ( $candidates as $candidate ) {
		if ( post_type_exists( $candidate ) ? ! in_array( $candidate, $own, true ) : (bool) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s LIMIT 1", $candidate ) ) ) {
			continue;
		}
		return array( 'postType' => $candidate, 'reused' => false, 'reason' => 'new' );
	}
	return array( 'postType' => $wanted, 'reused' => false, 'reason' => 'new' );
}

/** Taxonomy key for topics: 'topic', unless a post type already uses that name (bbPress registers one). */
function siteforge_importer_topic_taxonomy( array $spec ): string {
	if ( ! empty( $spec['taxonomy'] ) && ( ! post_type_exists( $spec['taxonomy'] ) ) ) {
		return $spec['taxonomy'];
	}
	return post_type_exists( 'topic' ) ? 'sf_topic' : 'topic';
}

/** Labels for a registered post type. */
function siteforge_importer_labels( array $def ): array {
	$plural   = $def['label'];
	$singular = $def['singular'];
	return array(
		'name'               => $plural,
		'singular_name'      => $singular,
		'menu_name'          => $plural,
		'all_items'          => sprintf( /* translators: %s: plural label. */ __( 'All %s', 'siteforge-importer' ), $plural ),
		'add_new_item'       => sprintf( /* translators: %s: singular label. */ __( 'Add New %s', 'siteforge-importer' ), $singular ),
		'edit_item'          => sprintf( /* translators: %s: singular label. */ __( 'Edit %s', 'siteforge-importer' ), $singular ),
		'new_item'           => sprintf( /* translators: %s: singular label. */ __( 'New %s', 'siteforge-importer' ), $singular ),
		'view_item'          => sprintf( /* translators: %s: singular label. */ __( 'View %s', 'siteforge-importer' ), $singular ),
		'view_items'         => sprintf( /* translators: %s: plural label. */ __( 'View %s', 'siteforge-importer' ), $plural ),
		'search_items'       => sprintf( /* translators: %s: plural label. */ __( 'Search %s', 'siteforge-importer' ), $plural ),
		'not_found'          => sprintf( /* translators: %s: plural label. */ __( 'No %s found.', 'siteforge-importer' ), strtolower( $plural ) ),
		'not_found_in_trash' => sprintf( /* translators: %s: plural label. */ __( 'No %s found in Trash.', 'siteforge-importer' ), strtolower( $plural ) ),
		'archives'           => $plural,
		'items_list'         => $plural,
	);
}

/** Registers one custom post type owned by this plugin. */
function siteforge_importer_register_post_type( string $key, array $def, string $taxonomy, int $position ): void {
	register_post_type(
		$key,
		array(
			'labels'            => siteforge_importer_labels( $def ),
			'description'       => sprintf( /* translators: %s: plural label. */ __( '%s imported by SiteForge.', 'siteforge-importer' ), $def['label'] ),
			'public'            => true,
			'show_in_rest'      => true,
			'show_in_nav_menus' => true,
			'has_archive'       => $def['slug'],
			'rewrite'           => array( 'slug' => $def['slug'], 'with_front' => false, 'feeds' => true, 'pages' => true ),
			'supports'          => array( 'title', 'editor', 'thumbnail', 'excerpt', 'custom-fields' ),
			'menu_icon'         => $def['icon'],
			'menu_position'     => $position,
			'taxonomies'        => array( $taxonomy ),
			'delete_with_user'  => false,
		)
	);
}

/** Registers the post meta of every field (shown in the REST API and the editor's custom fields panel). */
function siteforge_importer_register_meta( string $key, array $fields ): void {
	foreach ( $fields as $field ) {
		register_post_meta(
			$key,
			$field['metaKey'],
			array(
				'type'              => 'string',
				'single'            => true,
				'description'       => $field['label'],
				'show_in_rest'      => true,
				'sanitize_callback' => 'siteforge_importer_clean_text',
				'auth_callback'     => static function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
}

/** Plain text as stored in meta: valid UTF-8, normalized line breaks, no control characters. Escaping happens on output. */
function siteforge_importer_clean_text( $value ): string {
	$value = wp_check_invalid_utf8( (string) $value, true );
	$value = str_replace( array( "\r\n", "\r" ), "\n", $value );
	return (string) preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value );
}

/** Registers every type in the spec, its meta, the topic taxonomy and the admin columns. Runs on `init`. */
function siteforge_importer_register_all( ?array $spec = null ): void {
	$spec     = $spec ?? siteforge_importer_get_spec();
	$taxonomy = siteforge_importer_topic_taxonomy( $spec );
	$position = 26;
	foreach ( $spec['postTypes'] as $key => $def ) {
		if ( empty( $def['reused'] ) && ! post_type_exists( $key ) ) {
			siteforge_importer_register_post_type( $key, $def, $taxonomy, $position++ );
		}
		siteforge_importer_register_meta( $key, $def['fields'] ?? array() );
	}
	$object_types = array_keys( $spec['postTypes'] );
	if ( ! $object_types ) {
		return;
	}
	if ( taxonomy_exists( $taxonomy ) ) {
		foreach ( $object_types as $object_type ) {
			register_taxonomy_for_object_type( $taxonomy, $object_type );
		}
		return;
	}
	register_taxonomy(
		$taxonomy,
		$object_types,
		array(
			'labels'            => array(
				'name'          => __( 'Topics', 'siteforge-importer' ),
				'singular_name' => __( 'Topic', 'siteforge-importer' ),
				'search_items'  => __( 'Search Topics', 'siteforge-importer' ),
				'all_items'     => __( 'All Topics', 'siteforge-importer' ),
				'edit_item'     => __( 'Edit Topic', 'siteforge-importer' ),
				'add_new_item'  => __( 'Add New Topic', 'siteforge-importer' ),
				'menu_name'     => __( 'Topics', 'siteforge-importer' ),
			),
			'public'            => true,
			'hierarchical'      => false,
			'show_in_rest'      => true,
			'show_admin_column' => true,
			'rewrite'           => array( 'slug' => 'topic', 'with_front' => false ),
		)
	);
}

add_action(
	'init',
	static function () {
		siteforge_importer_register_all();
	},
	5
);

// A reused post type whose plugin was deactivated is registered by this plugin, so its imported items stay reachable.
add_action(
	'init',
	static function () {
		$spec     = siteforge_importer_get_spec();
		$taxonomy = siteforge_importer_topic_taxonomy( $spec );
		foreach ( $spec['postTypes'] as $key => $def ) {
			if ( ! empty( $def['reused'] ) && ! post_type_exists( $key ) ) {
				siteforge_importer_register_post_type( $key, $def, $taxonomy, 40 );
			}
		}
	},
	99
);

// Rewrite rules are rebuilt once after the spec changes (or after activation), never on every request.
add_action(
	'init',
	static function () {
		$hash = siteforge_importer_spec_hash( siteforge_importer_get_spec() );
		if ( get_option( SITEFORGE_IMPORTER_FLUSH_OPTION ) !== $hash ) {
			flush_rewrite_rules( false );
			update_option( SITEFORGE_IMPORTER_FLUSH_OPTION, $hash, true );
		}
	},
	100
);

// Admin list columns: the first short fields of each imported type, so the list reads like a real catalog.
add_action(
	'admin_init',
	static function () {
		foreach ( siteforge_importer_get_spec()['postTypes'] as $key => $def ) {
			if ( ! empty( $def['reused'] ) ) {
				continue;
			}
			$columns = array_slice( array_values( array_filter( $def['fields'] ?? array(), static fn( $field ) => 'row' === ( $field['display'] ?? '' ) ) ), 0, 2 );
			if ( ! $columns ) {
				continue;
			}
			add_filter(
				"manage_{$key}_posts_columns",
				static function ( $existing ) use ( $columns ) {
					$result = array();
					foreach ( $existing as $name => $label ) {
						$result[ $name ] = $label;
						if ( 'title' === $name ) {
							foreach ( $columns as $field ) {
								$result[ 'siteforge_' . $field['metaKey'] ] = $field['label'];
							}
						}
					}
					return $result;
				}
			);
			add_action(
				"manage_{$key}_posts_custom_column",
				static function ( $column, $post_id ) use ( $columns ) {
					foreach ( $columns as $field ) {
						if ( 'siteforge_' . $field['metaKey'] === $column ) {
							echo esc_html( (string) get_post_meta( $post_id, $field['metaKey'], true ) );
						}
					}
				},
				10,
				2
			);
		}
	}
);
