// Runs a real WordPress in Docker with the SiteForge Importer plugin active, and puts generated SiteForge sites into it.
//
// Two ways to get a site in:
//   A. load: SiteForge builds its own theme from the site and imports every page through it.
//   B. theme + push: pick a real theme, let SiteForge interrogate it (content types, taxonomies, fields), then push the
//      generated content into those types through the plugin. The theme keeps the design.
//
//   npm run wordpress:docker -- up                       start WordPress + MySQL, install WordPress on the first start,
//                                                        activate the importer plugin, write .wordpress-docker/connection.json
//   npm run wordpress:docker -- theme <theme>            install and activate a theme, then show what it offers. <theme> is
//                                                        a wordpress.org slug (astra), a theme .zip file or a .zip URL
//   npm run wordpress:docker -- inspect [--site <dir>]   interrogate the running site: content types, taxonomies, fields,
//                                                        and which existing types the site's content would go into
//   npm run wordpress:docker -- push <site folder> [...] push the generated content through the plugin (same options as
//                                                        node src/cli.mjs wordpress push: --builder, --front-page, --no-reuse)
//   npm run wordpress:docker -- forget <site folder>     delete what push created for that site
//   npm run wordpress:docker -- load <site folder>       build the site's WordPress theme, install, activate, import pages
//   npm run wordpress:docker -- status                   state and addresses
//   npm run wordpress:docker -- wp <wp-cli arguments>    run WP-CLI, e.g.  wp theme list
//   npm run wordpress:docker -- down                     stop (keeps the data)
//   npm run wordpress:docker -- reset                    stop and delete the WordPress and database volumes
//
// <site folder> is a generated site, such as outputs/library. The theme comes from the same code as the WP button in the
// app (src/cms/cms-theme.mjs). Settings are read from docker/.env (see docker/.env.example).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compose = join(root, 'docker', 'compose.wordpress.yaml');
const importDirectory = join(root, '.wordpress-docker', 'import');
const THEME_FILE = 'theme.zip';
const connectionFile = join(root, '.wordpress-docker', 'connection.json');
const IMPORTER = 'siteforge-importer';
// Create the folder Docker mounts before Docker does: on Linux, Docker creates a missing mount folder as root, and then
// this script cannot write connection.json or theme files into it.
mkdirSync(importDirectory, { recursive: true });

function readEnv() {
  const values = {};
  const file = join(root, 'docker', '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { ...values, ...process.env };
}
const env = readEnv();
const port = Number(env.SITEFORGE_WP_DOCKER_PORT ?? 8080);
// WordPress keeps only letters, digits, spaces and _ . - @ in a user name (admin123$ becomes admin123), so show that one.
const adminUser = (env.SITEFORGE_WP_DOCKER_ADMIN ?? 'admin').replace(/[^A-Za-z0-9 _.@-]/g, '') || 'admin';
const adminPassword = env.SITEFORGE_WP_DOCKER_ADMIN_PASSWORD ?? 'password';
const address = `http://localhost:${port}`;

if (!Number.isInteger(port) || port < 1 || port > 65535) fail('SITEFORGE_WP_DOCKER_PORT must be 1-65535');
function fail(message) { console.error(message); process.exit(1); }

function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', ['compose', '-f', compose, ...args], { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env });
  if (result.error) fail(result.error.code === 'ENOENT' ? 'Docker is not installed or not on PATH. Install Docker Desktop (or Docker Engine with the compose plugin) and try again.' : result.error.message);
  if (result.status !== 0 && !allowFailure) fail(`docker compose ${args.join(' ')} failed${capture ? `:\n${result.stderr || result.stdout}` : ''}`);
  return result;
}
// The wordpress:cli image runs its arguments as a program, so `wp` is named explicitly.
const wp = (args, options) => docker(['run', '--rm', '-T', 'wpcli', 'wp', ...args], options);

async function waitForHttp(timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const response = await fetch(`${address}/wp-login.php`, { redirect: 'manual', signal: AbortSignal.timeout(5000) }); if (response.status < 500) return; } catch { /* Not up yet. */ }
    await new Promise(done => setTimeout(done, 2000));
  }
  fail(`WordPress did not answer at ${address} within ${Math.round(timeoutMs / 1000)} seconds. See: docker compose -f docker/compose.wordpress.yaml logs`);
}

function installed() { return wp(['core', 'is-installed'], { capture: true, allowFailure: true }).status === 0; }

async function up() {
  docker(['up', '-d', '--wait']);
  await waitForHttp();
  if (!installed()) {
    console.log('Installing WordPress ...');
    wp(['core', 'install', `--url=${address}`, '--title=SiteForge test site', `--admin_user=${adminUser}`, `--admin_password=${adminPassword}`, '--admin_email=admin@example.test', '--skip-email']);
  }
  // Pretty permalinks, unless someone already chose a structure (the answer key uses the real permalinks).
  if (!wp(['option', 'get', 'permalink_structure'], { capture: true, allowFailure: true }).stdout.trim()) wp(['rewrite', 'structure', '/%postname%/', '--hard']);
  await connectImporter();
  console.log(`WordPress is running: ${address}   admin: ${address}/wp-admin   login: ${adminUser} / ${adminPassword}`);
}

// Activates the SiteForge Importer (mounted from wordpress/siteforge-importer) and saves its token where the CLI finds it.
async function connectImporter() {
  if (wp(['plugin', 'is-active', IMPORTER], { capture: true, allowFailure: true }).status !== 0) {
    console.log('Activating the SiteForge Importer plugin ...');
    wp(['plugin', 'activate', IMPORTER]);
  }
  const token = wp(['eval', 'echo siteforge_importer_token();'], { capture: true }).stdout.trim().split(/\r?\n/).pop();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token ?? '')) fail('Could not read the SiteForge import token from WordPress. Check: npm run wordpress:docker -- wp plugin list');
  await mkdir(dirname(connectionFile), { recursive: true });
  const connection = { url: address, adminUrl: `${address}/wp-admin/`, username: adminUser, password: adminPassword, token, startedAt: new Date().toISOString() };
  try { await writeFile(connectionFile, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EACCES') fail(`Cannot write ${connectionFile}: an earlier Docker run created .wordpress-docker as root. Delete that folder (sudo rm -rf .wordpress-docker), then run this again.`);
    throw error;
  }
}

// The SiteForge CLI against this WordPress (wordpress inspect | push | reset), with the Docker connection file.
function cli(args) {
  const result = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), 'wordpress', ...args, '--connection', connectionFile], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function theme(choice) {
  if (!choice) fail('theme needs a wordpress.org theme slug (e.g. astra, kadence, twentytwentyfive), a theme .zip file or a .zip URL');
  await up();
  let source = choice;
  if (/^https?:\/\//i.test(choice)) source = choice;
  else if (/\.zip$/i.test(choice) || existsSync(choice)) {
    const file = resolve(choice);
    if (!existsSync(file) || !/\.zip$/i.test(file)) fail(`${file} is not a theme .zip file.`);
    await mkdir(importDirectory, { recursive: true });
    const name = `chosen-${basename(file).replace(/[^A-Za-z0-9._-]/g, '-')}`;
    await copyFile(file, join(importDirectory, name));
    source = `/import/${name}`;
  } else if (!/^[a-z0-9-]+$/.test(choice)) fail(`"${choice}" is not a theme slug, .zip file or URL.`);
  console.log(`Installing and activating ${choice} ...`);
  wp(['theme', 'install', source, '--force', '--activate']);
  wp(['cache', 'flush'], { allowFailure: true });
  console.log('');
  cli(['inspect']);
  console.log(`\nNext: npm run wordpress:docker -- push <site folder>   (inspect --site <site folder> first to see where each type would go)`);
}

async function load(siteFolder) {
  if (!siteFolder) fail('load needs a generated site folder, such as outputs/library');
  const site = resolve(siteFolder);
  if (!existsSync(join(site, 'public'))) fail(`${site} is not a generated site (it has no public/ folder). Generate one first: node src/cli.mjs generate <settings.yaml> --out ${siteFolder}`);
  await up();
  await mkdir(importDirectory, { recursive: true });
  await rm(join(importDirectory, THEME_FILE), { force: true });
  console.log('Building the WordPress theme from the site ...');
  const build = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), 'cms-theme', site, '--cms', 'wordpress', '--out', join(importDirectory, THEME_FILE)], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) fail('Could not build the theme package.');
  console.log('Installing and activating the theme ...');
  wp(['theme', 'install', `/import/${THEME_FILE}`, '--force', '--activate']);
  const slug = wp(['theme', 'list', '--status=active', '--field=name'], { capture: true }).stdout.trim().split(/\r?\n/)[0];
  if (!/^siteforge-/.test(slug)) fail(`The active theme is "${slug}", not a SiteForge theme. Check: npm run wordpress:docker -- wp theme list`);
  console.log(`Importing pages with ${slug} (large sites take a while) ...`);
  docker(['run', '--rm', '-T', '--entrypoint', 'php', 'wpcli', `wp-content/themes/${slug}/siteforge-import.php`, '/var/www/html/wp-load.php']);
  wp(['rewrite', 'structure', '/%postname%/', '--hard']);
  wp(['cache', 'flush'], { allowFailure: true });
  console.log(`Done. Open ${address}  (answer key: ${join(site, 'private', 'answer-key.json')})`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'up') await up();
else if (command === 'load') await load(rest[0]);
else if (command === 'theme') await theme(rest[0]);
else if (command === 'inspect') { await connectImporter(); cli(['inspect', ...rest]); }
else if (command === 'push') { if (!rest[0]) fail('push needs a generated site folder, such as outputs/library'); await up(); cli(['push', ...rest]); console.log(`Open ${address}`); }
else if (command === 'forget') { if (!rest[0]) fail('forget needs the site folder that was pushed'); await connectImporter(); cli(['reset', ...rest]); }
else if (command === 'status') { docker(['ps', '--all']); console.log(`Address: ${address}`); }
else if (command === 'wp') { if (!rest.length) fail('wp needs WP-CLI arguments, e.g. wp theme list'); const child = spawn('docker', ['compose', '-f', compose, 'run', '--rm', 'wpcli', 'wp', ...rest], { cwd: root, stdio: 'inherit', env }); child.once('exit', code => process.exit(code ?? 1)); }
else if (command === 'down') docker(['down']);
else if (command === 'reset') { docker(['down', '--volumes']); await rm(join(root, '.wordpress-docker'), { recursive: true, force: true }); console.log('Removed the WordPress and database volumes.'); }
else fail('Usage: npm run wordpress:docker -- up | theme <slug|zip|url> | inspect [--site <dir>] | push <site folder> | forget <site folder> | load <site folder> | status | wp <args> | down | reset');
