// Starts the local Drupal at http://127.0.0.1:9600 (SITEFORGE_DRUPAL_PORT changes the port) and keeps it running until
// Ctrl+C. The first run downloads and installs Drupal into .drupal/site; later runs reuse it. The app starts this same
// script in the background with --background.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDrupal } from '../src/drupal/runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.exitCode = await runDrupal({ root, background: process.argv.includes('--background') });
