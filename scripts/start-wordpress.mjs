// Starts the local WordPress at http://127.0.0.1:9400 (SITEFORGE_WP_PORT changes the port) and keeps it running until
// Ctrl+C. The first run installs WordPress, Elementor and the SiteForge importer into .wordpress/site; later runs reuse
// them. The app starts this same script in the background with --background.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWordPress } from '../src/wordpress/runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.exitCode = await runWordPress({ root, background: process.argv.includes('--background') });
