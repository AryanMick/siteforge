// Runs a real WordPress in Docker and loads a generated SiteForge site into it (Option A: the exported WordPress theme).
//
//   npm run wordpress:docker -- up                       start WordPress + MySQL, install WordPress on the first start
//   npm run wordpress:docker -- load <site folder>       build the site's WordPress theme, install, activate, import pages
//   npm run wordpress:docker -- status                   state and addresses
//   npm run wordpress:docker -- wp <wp-cli arguments>    run WP-CLI, e.g.  wp theme list
//   npm run wordpress:docker -- down                     stop (keeps the data)
//   npm run wordpress:docker -- reset                    stop and delete the WordPress and database volumes
//
// <site folder> is a generated site, such as outputs/library. The theme comes from the same code as the WP button in the
// app (src/cms/cms-theme.mjs). Settings are read from docker/.env (see docker/.env.example).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compose = join(root, 'docker', 'compose.wordpress.yaml');
const importDirectory = join(root, '.wordpress-docker', 'import');
const THEME_FILE = 'theme.zip';

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
const adminUser = env.SITEFORGE_WP_DOCKER_ADMIN ?? 'admin';
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
const wp = (args, options) => docker(['run', '--rm', '-T', 'wpcli', ...args], options);

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
  console.log(`WordPress is running: ${address}   admin: ${address}/wp-admin   login: ${adminUser} / ${adminPassword}`);
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
else if (command === 'status') { docker(['ps', '--all']); console.log(`Address: ${address}`); }
else if (command === 'wp') { if (!rest.length) fail('wp needs WP-CLI arguments, e.g. wp theme list'); const child = spawn('docker', ['compose', '-f', compose, 'run', '--rm', 'wpcli', ...rest], { cwd: root, stdio: 'inherit', env }); child.once('exit', code => process.exit(code ?? 1)); }
else if (command === 'down') docker(['down']);
else if (command === 'reset') { docker(['down', '--volumes']); await rm(join(root, '.wordpress-docker'), { recursive: true, force: true }); console.log('Removed the WordPress and database volumes.'); }
else fail('Usage: npm run wordpress:docker -- up | load <site folder> | status | wp <args> | down | reset');
