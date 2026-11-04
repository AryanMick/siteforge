<?php
/**
 * Plugin Name:       SiteForge Importer
 * Description:       Imports SiteForge test content into native WordPress content types (custom post types with their fields), keeps the active theme in charge of the design, and serves an answer key with the real permalinks. Token-protected REST API under /wp-json/siteforge/v1/.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            SiteForge
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       siteforge-importer
 *
 * SiteForge Importer is free software: you can redistribute it and/or modify it under the terms of the GNU General
 * Public License as published by the Free Software Foundation, either version 2 of the License, or (at your option)
 * any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * @package SiteForgeImporter
 */

defined( 'ABSPATH' ) || exit;

define( 'SITEFORGE_IMPORTER_VERSION', '1.0.0' );
define( 'SITEFORGE_IMPORTER_FILE', __FILE__ );
define( 'SITEFORGE_IMPORTER_DIR', __DIR__ );

// Option names. The spec option is read on every request (types are registered on `init`), so it stays autoloaded.
define( 'SITEFORGE_IMPORTER_SPEC_OPTION', 'siteforge_types' );
define( 'SITEFORGE_IMPORTER_TOKEN_OPTION', 'siteforge_import_token' );
define( 'SITEFORGE_IMPORTER_FLUSH_OPTION', 'siteforge_rewrite_hash' );

require_once SITEFORGE_IMPORTER_DIR . '/includes/spec.php';
require_once SITEFORGE_IMPORTER_DIR . '/includes/content.php';
require_once SITEFORGE_IMPORTER_DIR . '/includes/records.php';
require_once SITEFORGE_IMPORTER_DIR . '/includes/answer-key.php';
require_once SITEFORGE_IMPORTER_DIR . '/includes/rest.php';

/**
 * The import token: the SITEFORGE_IMPORT_TOKEN constant when defined (e.g. in wp-config.php), otherwise an option
 * generated on activation (or lazily, if the plugin was enabled without running its activation hook).
 */
function siteforge_importer_token(): string {
	if ( defined( 'SITEFORGE_IMPORT_TOKEN' ) && is_string( SITEFORGE_IMPORT_TOKEN ) && '' !== SITEFORGE_IMPORT_TOKEN ) {
		return SITEFORGE_IMPORT_TOKEN;
	}
	$token = get_option( SITEFORGE_IMPORTER_TOKEN_OPTION, '' );
	if ( ! is_string( $token ) || strlen( $token ) < 20 ) {
		$token = siteforge_importer_regenerate_token();
	}
	return $token;
}

/** Creates (or replaces) the stored token. The option is not autoloaded. */
function siteforge_importer_regenerate_token(): string {
	$token = wp_generate_password( 40, false, false );
	update_option( SITEFORGE_IMPORTER_TOKEN_OPTION, $token, false );
	return $token;
}

/** True when the token comes from the SITEFORGE_IMPORT_TOKEN constant (it cannot be regenerated from the admin page). */
function siteforge_importer_token_is_constant(): bool {
	return defined( 'SITEFORGE_IMPORT_TOKEN' ) && is_string( SITEFORGE_IMPORT_TOKEN ) && '' !== SITEFORGE_IMPORT_TOKEN;
}

register_activation_hook(
	__FILE__,
	static function () {
		$token = get_option( SITEFORGE_IMPORTER_TOKEN_OPTION, '' );
		if ( ! is_string( $token ) || strlen( $token ) < 20 ) {
			siteforge_importer_regenerate_token();
		}
		// Registers any stored types before the rules are rebuilt on the next request.
		delete_option( SITEFORGE_IMPORTER_FLUSH_OPTION );
	}
);

register_deactivation_hook(
	__FILE__,
	static function () {
		// The custom post types disappear with the plugin; drop their rewrite rules on the next request.
		delete_option( SITEFORGE_IMPORTER_FLUSH_OPTION );
		delete_option( 'rewrite_rules' );
	}
);

/* -------------------------------------------------------------------------------------------------------------- */
/* Settings → SiteForge Importer                                                                                   */
/* -------------------------------------------------------------------------------------------------------------- */

add_action(
	'admin_menu',
	static function () {
		add_options_page(
			__( 'SiteForge Importer', 'siteforge-importer' ),
			__( 'SiteForge Importer', 'siteforge-importer' ),
			'manage_options',
			'siteforge-importer',
			'siteforge_importer_settings_page'
		);
	}
);

add_action(
	'admin_post_siteforge_importer_regenerate',
	static function () {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'siteforge-importer' ), 403 );
		}
		check_admin_referer( 'siteforge_importer_regenerate' );
		if ( ! siteforge_importer_token_is_constant() ) {
			siteforge_importer_regenerate_token();
		}
		wp_safe_redirect( add_query_arg( array( 'page' => 'siteforge-importer', 'regenerated' => '1' ), admin_url( 'options-general.php' ) ) );
		exit;
	}
);

/** Renders the settings page: the token, the REST base address and what has been imported. */
function siteforge_importer_settings_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$spec  = siteforge_importer_get_spec();
	$sites = siteforge_importer_site_counts();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'SiteForge Importer', 'siteforge-importer' ); ?></h1>
		<?php if ( isset( $_GET['regenerated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only. ?>
			<div class="notice notice-success"><p><?php esc_html_e( 'A new token was created. Update the SiteForge connection with it.', 'siteforge-importer' ); ?></p></div>
		<?php endif; ?>
		<p><?php esc_html_e( 'SiteForge pushes generated test content into this site through the REST API below. Every request must send the token in the X-SiteForge-Token header.', 'siteforge-importer' ); ?></p>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'REST API', 'siteforge-importer' ); ?></th>
				<td><code><?php echo esc_html( rest_url( 'siteforge/v1/' ) ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><label for="siteforge-token"><?php esc_html_e( 'Import token', 'siteforge-importer' ); ?></label></th>
				<td>
					<input id="siteforge-token" type="text" class="regular-text code" readonly value="<?php echo esc_attr( siteforge_importer_token() ); ?>" onfocus="this.select()">
					<?php if ( siteforge_importer_token_is_constant() ) : ?>
						<p class="description"><?php esc_html_e( 'Set by the SITEFORGE_IMPORT_TOKEN constant in wp-config.php.', 'siteforge-importer' ); ?></p>
					<?php endif; ?>
				</td>
			</tr>
		</table>
		<?php if ( ! siteforge_importer_token_is_constant() ) : ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="siteforge_importer_regenerate">
				<?php wp_nonce_field( 'siteforge_importer_regenerate' ); ?>
				<?php submit_button( __( 'Regenerate token', 'siteforge-importer' ), 'secondary', 'submit', false ); ?>
			</form>
		<?php endif; ?>
		<h2><?php esc_html_e( 'Imported sites', 'siteforge-importer' ); ?></h2>
		<?php if ( ! $sites ) : ?>
			<p><?php esc_html_e( 'Nothing has been imported yet.', 'siteforge-importer' ); ?></p>
		<?php else : ?>
			<table class="widefat striped">
				<thead><tr><th><?php esc_html_e( 'Site', 'siteforge-importer' ); ?></th><th><?php esc_html_e( 'Content types', 'siteforge-importer' ); ?></th><th><?php esc_html_e( 'Items', 'siteforge-importer' ); ?></th></tr></thead>
				<tbody>
				<?php foreach ( $sites as $site ) : ?>
					<tr>
						<td><strong><?php echo esc_html( $site['name'] ); ?></strong><br><code><?php echo esc_html( $site['siteId'] ); ?></code></td>
						<td>
							<?php
							$links = array();
							foreach ( $site['counts'] as $post_type => $count ) {
								$object  = get_post_type_object( $post_type );
								$label   = $object ? $object->labels->name : $post_type;
								$links[] = sprintf( '<a href="%s">%s</a> (%d)', esc_url( admin_url( 'edit.php?post_type=' . rawurlencode( $post_type ) ) ), esc_html( $label ), (int) $count );
							}
							echo wp_kses_post( implode( ', ', $links ) );
							?>
						</td>
						<td><?php echo esc_html( number_format_i18n( $site['records'] ) ); ?></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>
		<p class="description"><?php echo esc_html( sprintf( /* translators: %d: number of content types. */ __( '%d SiteForge content types are registered.', 'siteforge-importer' ), count( $spec['postTypes'] ) ) ); ?></p>
	</div>
	<?php
}
