<?php
/**
 * Builds what a record looks like inside WordPress: Gutenberg blocks in post_content (any theme shows them) and,
 * when Elementor is used, the equivalent Elementor document. Also uploads record images into the media library.
 *
 * Field values are written so that WordPress shows them exactly as given: they are HTML-escaped, and the few
 * characters WordPress would rewrite on display (wptexturize dashes, ellipses and multiplication signs, smilies,
 * shortcodes, capital_P_dangit) are written as numeric character references. The answer key can therefore list the
 * original values.
 *
 * @package SiteForgeImporter
 */

defined( 'ABSPATH' ) || exit;

/** Escapes plain text for post content so WordPress's display filters leave it unchanged. */
function siteforge_importer_text( string $text ): string {
	// Every "&" is encoded (esc_html would keep text that looks like an entity, such as "&amp;", unencoded).
	$html = htmlspecialchars( wp_check_invalid_utf8( $text, true ), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8', true );
	// wptexturize: "--", " - ", leading/trailing hyphens → dashes; "..." → ellipsis; "``" → quote; "(tm)"; 9x9 → ×.
	$html = (string) preg_replace( '/(?<![A-Za-z0-9])-|-(?![A-Za-z0-9])/', '&#45;', $html );
	$html = str_replace( array( '...', '`', '(tm)' ), array( '&#46;&#46;&#46;', '&#96;', '&#40;tm)' ), $html );
	$html = (string) preg_replace( '/(?<=\d)x(?=\d)/', '&#120;', $html );
	// Shortcodes ([gallery]) keep their brackets literal.
	$html = str_replace( array( '[', ']' ), array( '&#91;', '&#93;' ), $html );
	// Smilies are whole words starting with ":", ";" or "8)" (":)", ";-)", ":idea:", "8-)").
	$html = (string) preg_replace_callback( '/(^|\s)([:;])(?=\S)/', static fn( $m ) => $m[1] . '&#' . ord( $m[2] ) . ';', $html );
	$html = (string) preg_replace( '/(^|\s)8(?=\)|&#45;\))/', '$1&#56;', $html );
	// capital_P_dangit.
	return (string) preg_replace( '/(?<=Word)p(?=ress)/', '&#112;', $html );
}

/** Paragraphs of a long text value (blank lines separate paragraphs). */
function siteforge_importer_paragraphs( string $text ): array {
	$parts = preg_split( '/\n\s*\n/', trim( $text ) );
	return array_values( array_filter( array_map( 'trim', is_array( $parts ) ? $parts : array( $text ) ), 'strlen' ) );
}

/** Inline HTML of one paragraph: escaped text with single line breaks kept as <br>. */
function siteforge_importer_inline( string $text ): string {
	return implode( '<br>', array_map( 'siteforge_importer_text', explode( "\n", $text ) ) );
}

/** One block: comment delimiters around saved HTML. */
function siteforge_importer_block( string $name, array $attributes, string $html ): string {
	$attrs = $attributes ? ' ' . wp_json_encode( $attributes, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : '';
	return "<!-- wp:{$name}{$attrs} -->\n{$html}\n<!-- /wp:{$name} -->";
}

/**
 * The fields of a record split by how they are shown: short values as label/value rows, long text as a heading and
 * paragraphs, and the image field as an image.
 *
 * @return array{rows: array, texts: array}
 */
function siteforge_importer_field_groups( array $def, array $written ): array {
	$rows  = array();
	$texts = array();
	foreach ( $def['fields'] as $field ) {
		$name = $field['name'];
		if ( ! isset( $written[ $name ] ) || '' === $written[ $name ] || 'image' === ( $field['display'] ?? '' ) ) {
			continue;
		}
		if ( 'text' === ( $field['display'] ?? '' ) ) {
			$texts[] = array( $field, $written[ $name ] );
		} else {
			$rows[] = array( $field, $written[ $name ] );
		}
	}
	return array( 'rows' => $rows, 'texts' => $texts );
}

/**
 * Gutenberg markup for a record: image, a table of label/value rows, headed paragraphs for long text and a list of
 * related records. Every block is saved the way the block editor saves it, so it opens without validation warnings.
 */
function siteforge_importer_blocks_content( array $def, array $written, ?array $image, array $related ): string {
	$blocks = array();
	$groups = siteforge_importer_field_groups( $def, $written );
	if ( $image && ! empty( $image['field'] ) && ! empty( $image['url'] ) ) {
		$id       = (int) $image['id'];
		$blocks[] = siteforge_importer_block(
			'image',
			array( 'id' => $id, 'sizeSlug' => 'full', 'linkDestination' => 'none', 'className' => 'record-image' ),
			sprintf( '<figure class="wp-block-image size-full record-image"><img src="%s" alt="%s" class="wp-image-%d"/></figure>', esc_url( $image['url'] ), esc_attr( $image['alt'] ?? '' ), $id )
		);
	}
	if ( $groups['rows'] ) {
		$cells = '';
		foreach ( $groups['rows'] as [ $field, $value ] ) {
			$cells .= sprintf( '<tr><th>%s</th><td>%s</td></tr>', siteforge_importer_text( $field['label'] ), siteforge_importer_inline( $value ) );
		}
		$blocks[] = siteforge_importer_block( 'table', array( 'className' => 'record-details' ), '<figure class="wp-block-table record-details"><table class="has-fixed-layout"><tbody>' . $cells . '</tbody></table></figure>' );
	}
	foreach ( $groups['texts'] as [ $field, $value ] ) {
		$blocks[] = siteforge_importer_block( 'heading', array(), '<h2 class="wp-block-heading">' . siteforge_importer_text( $field['label'] ) . '</h2>' );
		foreach ( siteforge_importer_paragraphs( $value ) as $paragraph ) {
			$blocks[] = siteforge_importer_block( 'paragraph', array(), '<p>' . siteforge_importer_inline( $paragraph ) . '</p>' );
		}
	}
	if ( $related ) {
		$blocks[] = siteforge_importer_block( 'heading', array(), '<h2 class="wp-block-heading">' . esc_html__( 'Related', 'siteforge-importer' ) . '</h2>' );
		$items    = '';
		foreach ( $related as $item ) {
			$items .= "<!-- wp:list-item -->\n" . sprintf( '<li><a href="%s">%s</a></li>', esc_url( $item['url'] ), siteforge_importer_text( $item['title'] ) ) . "\n<!-- /wp:list-item -->";
		}
		$blocks[] = siteforge_importer_block( 'list', array( 'className' => 'related-records' ), '<ul class="wp-block-list related-records">' . $items . '</ul>' );
	}
	return implode( "\n\n", $blocks );
}

/** True when Elementor is loaded in this request. */
function siteforge_importer_elementor_active(): bool {
	return defined( 'ELEMENTOR_VERSION' ) && class_exists( '\Elementor\Plugin' );
}

/** True when Elementor's flexbox containers are enabled (the default for new sites); otherwise sections/columns are used. */
function siteforge_importer_elementor_containers(): bool {
	if ( ! siteforge_importer_elementor_active() ) {
		return false;
	}
	$plugin = \Elementor\Plugin::$instance;
	return isset( $plugin->experiments ) && $plugin->experiments->is_feature_active( 'container' );
}

/**
 * Elementor document for a record (the value of _elementor_data): an image widget, an icon list of label/value rows,
 * heading + text editor widgets for long text and an icon list of related links, inside one container (or a
 * section with one column when containers are off). Element IDs are derived from the record ID, so a re-import
 * writes identical data.
 */
function siteforge_importer_elementor_document( array $def, string $external_id, array $written, ?array $image, array $related, bool $containers ): array {
	$counter = 0;
	$next_id = static function () use ( $external_id, &$counter ): string {
		return substr( md5( $external_id . '#' . $counter++ ), 0, 7 );
	};
	$widget  = static function ( string $type, array $settings ) use ( $next_id ): array {
		return array( 'id' => $next_id(), 'elType' => 'widget', 'settings' => $settings, 'elements' => array(), 'widgetType' => $type );
	};
	$icon    = array( 'value' => 'fas fa-angle-right', 'library' => 'fa-solid' );
	$groups  = siteforge_importer_field_groups( $def, $written );
	$widgets = array();
	if ( $image && ! empty( $image['field'] ) && ! empty( $image['url'] ) ) {
		$widgets[] = $widget( 'image', array( 'image' => array( 'url' => $image['url'], 'id' => (int) $image['id'], 'alt' => (string) ( $image['alt'] ?? '' ), 'source' => 'library' ), 'image_size' => 'full', '_css_classes' => 'record-image' ) );
	}
	if ( $groups['rows'] ) {
		$items = array();
		foreach ( $groups['rows'] as [ $field, $value ] ) {
			$items[] = array( '_id' => $next_id(), 'text' => '<strong>' . siteforge_importer_text( $field['label'] ) . ':</strong> ' . siteforge_importer_inline( $value ), 'selected_icon' => $icon );
		}
		$widgets[] = $widget( 'icon-list', array( 'icon_list' => $items, '_css_classes' => 'record-details' ) );
	}
	foreach ( $groups['texts'] as [ $field, $value ] ) {
		$widgets[] = $widget( 'heading', array( 'title' => siteforge_importer_text( $field['label'] ), 'header_size' => 'h2' ) );
		$html      = '';
		foreach ( siteforge_importer_paragraphs( $value ) as $paragraph ) {
			$html .= '<p>' . siteforge_importer_inline( $paragraph ) . '</p>';
		}
		$widgets[] = $widget( 'text-editor', array( 'editor' => $html ) );
	}
	if ( $related ) {
		$widgets[] = $widget( 'heading', array( 'title' => esc_html__( 'Related', 'siteforge-importer' ), 'header_size' => 'h2' ) );
		$items     = array();
		foreach ( $related as $item ) {
			$items[] = array( '_id' => $next_id(), 'text' => siteforge_importer_text( $item['title'] ), 'selected_icon' => $icon, 'link' => array( 'url' => $item['url'], 'is_external' => '', 'nofollow' => '', 'custom_attributes' => '' ) );
		}
		$widgets[] = $widget( 'icon-list', array( 'icon_list' => $items, '_css_classes' => 'related-records' ) );
	}
	if ( $containers ) {
		return array( array( 'id' => $next_id(), 'elType' => 'container', 'settings' => array( 'content_width' => 'boxed', 'flex_direction' => 'column' ), 'elements' => $widgets, 'isInner' => false ) );
	}
	$column = array( 'id' => $next_id(), 'elType' => 'column', 'settings' => array( '_column_size' => 100, '_inline_size' => null ), 'elements' => $widgets, 'isInner' => false );
	return array( array( 'id' => $next_id(), 'elType' => 'section', 'settings' => array(), 'elements' => array( $column ), 'isInner' => false ) );
}

/** Writes (or clears) the Elementor meta of a post. $document null removes Elementor from the post. */
function siteforge_importer_write_elementor( int $post_id, ?array $document, string $template_type ): void {
	if ( null === $document ) {
		if ( get_post_meta( $post_id, '_elementor_data', true ) ) {
			foreach ( array( '_elementor_edit_mode', '_elementor_template_type', '_elementor_version', '_elementor_data', '_elementor_css', '_elementor_element_cache', '_elementor_page_assets' ) as $key ) {
				delete_post_meta( $post_id, $key );
			}
		}
		return;
	}
	update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
	update_post_meta( $post_id, '_elementor_template_type', $template_type );
	update_post_meta( $post_id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '3.0.0' );
	// Meta functions unslash their input, so the JSON is slashed first (as Elementor does).
	update_post_meta( $post_id, '_elementor_data', wp_slash( (string) wp_json_encode( $document ) ) );
	// Cached CSS and rendered elements are rebuilt by Elementor on the next view.
	delete_post_meta( $post_id, '_elementor_css' );
	delete_post_meta( $post_id, '_elementor_element_cache' );
	delete_post_meta( $post_id, '_elementor_page_assets' );
}

/** Adds post types to Elementor's "Post Types" setting so "Edit with Elementor" is offered for them. */
function siteforge_importer_elementor_support( array $post_types ): void {
	$current = get_option( 'elementor_cpt_support', array( 'post', 'page' ) );
	$current = is_array( $current ) ? $current : array( 'post', 'page' );
	$merged  = array_values( array_unique( array_merge( $current, $post_types ) ) );
	if ( $merged !== $current ) {
		update_option( 'elementor_cpt_support', $merged );
	}
}

/**
 * The media library attachment for a record image, uploaded once per site and source path. A request may omit the
 * bytes when the same image was sent before; the stored attachment is then reused.
 *
 * @return array{id: int, url: string, path: string, alt: string, field: string}|WP_Error|null
 */
function siteforge_importer_attachment( string $site_id, ?array $image ) {
	static $cache = array();
	if ( ! $image ) {
		return null;
	}
	$filename = sanitize_file_name( (string) ( $image['filename'] ?? '' ) );
	$source   = (string) ( $image['source'] ?? $filename );
	if ( '' === $filename ) {
		return new WP_Error( 'siteforge_image', 'Image filename is missing.' );
	}
	$key = $site_id . ':' . $source;
	$alt = sanitize_text_field( (string) ( $image['alt'] ?? '' ) );
	$out = static function ( int $id ) use ( $alt, $image ): array {
		$url = (string) wp_get_attachment_url( $id );
		return array( 'id' => $id, 'url' => $url, 'path' => siteforge_importer_relative_url( $url ), 'alt' => $alt, 'field' => (string) ( $image['field'] ?? '' ) );
	};
	if ( isset( $cache[ $key ] ) ) {
		return $out( $cache[ $key ] );
	}
	global $wpdb;
	$existing = (int) $wpdb->get_var( $wpdb->prepare( "SELECT m.post_id FROM {$wpdb->postmeta} m INNER JOIN {$wpdb->posts} p ON p.ID = m.post_id AND p.post_type = 'attachment' WHERE m.meta_key = '_siteforge_image_key' AND m.meta_value = %s ORDER BY m.post_id LIMIT 1", $key ) );
	if ( $existing ) {
		$cache[ $key ] = $existing;
		return $out( $existing );
	}
	if ( empty( $image['base64'] ) ) {
		return new WP_Error( 'siteforge_image_missing', sprintf( 'Image %s has not been uploaded yet; send it with base64 data.', $source ) );
	}
	$bytes = base64_decode( (string) $image['base64'], true );
	if ( false === $bytes || '' === $bytes || strlen( $bytes ) > 8 * MB_IN_BYTES ) {
		return new WP_Error( 'siteforge_image', sprintf( 'Image %s is not valid base64 data under 8 MB.', $source ) );
	}
	$info    = @getimagesizefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- invalid data is reported below.
	$allowed = array( 'image/png', 'image/jpeg', 'image/gif', 'image/webp' );
	if ( ! $info || ! in_array( $info['mime'], $allowed, true ) ) {
		return new WP_Error( 'siteforge_image', sprintf( 'Image %s is not a PNG, JPEG, GIF or WebP image.', $source ) );
	}
	$upload = wp_upload_bits( $filename, null, $bytes );
	if ( ! empty( $upload['error'] ) ) {
		return new WP_Error( 'siteforge_image', sprintf( 'Image %s could not be saved: %s', $source, $upload['error'] ) );
	}
	$id = wp_insert_attachment(
		array(
			'post_mime_type' => $info['mime'],
			'post_title'     => '' !== $alt ? $alt : pathinfo( $filename, PATHINFO_FILENAME ),
			'post_content'   => '',
			'post_status'    => 'inherit',
		),
		$upload['file'],
		0,
		true
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	require_once ABSPATH . 'wp-admin/includes/image.php';
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );
	update_post_meta( $id, '_siteforge_image_key', $key );
	update_post_meta( $id, '_siteforge_site_id', $site_id );
	if ( '' !== $alt ) {
		update_post_meta( $id, '_wp_attachment_image_alt', $alt );
	}
	$cache[ $key ] = (int) $id;
	return $out( (int) $id );
}

/** Root-relative form (path and query) of a URL on this site, as the answer key lists it. */
function siteforge_importer_relative_url( string $url ): string {
	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) ) {
		return $url;
	}
	$path = $parts['path'] ?? '/';
	return ( '' === $path ? '/' : $path ) . ( isset( $parts['query'] ) ? '?' . $parts['query'] : '' );
}
