import { replaceFile } from '../site/replace-file.mjs';
// The local WordPress that SiteForge puts generated sites into. It runs on WordPress Playground (PHP compiled to
// WebAssembly, run by Node), so it needs no PHP, MySQL or Docker. WordPress files and its SQLite database live in
// .wordpress/site and survive restarts. scripts/start-wordpress.mjs runs the server; the app starts it in the
// background through startWordPress() and the same launcher.
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';

export const WORDPRESS_USERNAME = 'admin';
export const WORDPRESS_PASSWORD = 'password';
export const DEFAULT_WORDPRESS_PORT = 9400;
const PHP_VERSION = '8.3';
const ELEMENTOR_URL = 'https://downloads.wordpress.org/plugin/elementor.latest-stable.zip';
const WORDPRESS_RELEASES_URL = 'https://api.wordpress.org/core/version-check/1.7/';
// The first start downloads WordPress and Elementor and installs both; later starts take seconds.
const STARTING_LIMIT_MS = 15 * 60 * 1000;
const STOP_WAIT_MS = 15000;

export function wordpressPaths(root = process.cwd()) {
  const data = join(/* turbopackIgnore: true */ root, '.wordpress');
  return {
    root, data,
    site: join(data, 'site'),
    cache: join(data, 'cache'),
    runtime: join(data, 'runtime.json'),
    connection: join(data, 'connection.json'),
    setup: join(data, 'setup.json'),
    blueprint: join(data, 'blueprint.json'),
    report: join(data, 'cache', 'setup-report.json'),
    log: join(data, 'server.log'),
    importer: join(/* turbopackIgnore: true */ root, 'wordpress', 'siteforge-importer'),
    launcher: join(/* turbopackIgnore: true */ root, 'scripts', 'start-wordpress.mjs'),
    cli: join(/* turbopackIgnore: true */ root, 'node_modules', '@wp-playground', 'cli', 'wp-playground.js'),
  };
}

export function wordpressPort(value = process.env.SITEFORGE_WP_PORT) {
  if (value === undefined || value === '') return DEFAULT_WORDPRESS_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SITEFORGE_WP_PORT must be a port number from 1 to 65535, not "${value}".`);
  return port;
}

const urlsFor = port => {
  const url = `http://127.0.0.1:${port}`;
  return { url, adminUrl: `${url}/wp-admin/`, loginUrl: `${url}/wp-login.php`, restUrl: `${url}/wp-json/` };
};

export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await replaceFile(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async path => { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

/** GET a local URL without following redirects. Resolves to { status, body } or null when nothing answers. */
export function probe(url, timeoutMs = 4000) {
  return new Promise(resolve => {
    const request = httpRequest(url, { method: 'GET', headers: { accept: 'application/json' }, timeout: timeoutMs }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size <= 1024 * 1024) chunks.push(chunk); });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', () => resolve(null));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(null));
    request.end();
  });
}

/** True when WordPress answers its REST index. Playground redirects the very first request once; follow that. */
export async function restAnswers(url, timeoutMs = 4000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await probe(`${url}/wp-json/`, timeoutMs);
    if (!answer) return false;
    if (answer.status === 200) { try { return Array.isArray(JSON.parse(answer.body).namespaces); } catch { return false; } }
    if (answer.status < 300 || answer.status >= 400) return false;
  }
  return false;
}

export function portIsFree(port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function logTail(path, lines = 40) {
  try {
    const text = await readFile(path, 'utf8');
    // Progress output uses carriage returns and colour codes; keep the last state of each line as plain text.
    return text.slice(-64 * 1024).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split('\n').map(line => line.split('\r').filter(Boolean).pop() ?? '')
      .filter(line => line.trim()).slice(-lines).join('\n');
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

/** Current state of the local WordPress: 'stopped' | 'starting' | 'running' | 'failed'. */
export async function wordpressStatus({ root = process.cwd() } = {}) {
  const paths = wordpressPaths(root);
  const record = await readJsonFile(paths.runtime);
  let port;
  try { port = Number.isInteger(record?.port) ? record.port : wordpressPort(); } catch { port = DEFAULT_WORDPRESS_PORT; }
  const urls = urlsFor(port);
  const base = { ...urls, port, username: WORDPRESS_USERNAME, password: WORDPRESS_PASSWORD, dataDirectory: paths.data };
  const tail = await logTail(paths.log);
  const details = {
    pid: record?.pid ?? null, startedAt: record?.startedAt ?? null, readyAt: record?.readyAt ?? null,
    firstRun: record?.firstRun ?? null, wordpressVersion: record?.wordpressVersion ?? null, theme: record?.theme ?? null,
    plugins: record?.plugins ?? null, warnings: record?.warnings ?? [],
  };
  const result = (state, error = null, extra = {}) => ({ state, ...base, ...details, ...extra, error, logTail: tail });
  if (!record) return result('stopped');
  if (!isAlive(record.pid)) {
    // A launcher that is gone after 'running' was stopped from outside (closed terminal, restart): just stopped.
    if (record.state === 'failed') return result('failed', record.error ?? 'WordPress could not start. See the log below.');
    if (record.state === 'starting') return result('failed', 'WordPress stopped before it was ready. See the log below.');
    return result('stopped');
  }
  if (record.state === 'failed') return result('failed', record.error ?? 'WordPress could not start. See the log below.');
  if (record.state === 'running') {
    if (await restAnswers(urls.url, 5000)) return result('running');
    // The recorded process ID now belongs to some other program and nothing listens on the port.
    if (await portIsFree(port)) return result('stopped');
    return result('running', 'WordPress is running but did not answer /wp-json/ within 5 seconds.', { healthy: false });
  }
  if (record.state === 'stopped') return result('stopped');
  const age = Date.now() - Date.parse(record.startedAt ?? 0);
  if (!(age <= STARTING_LIMIT_MS)) return result('failed', 'WordPress did not finish starting within 15 minutes. Stop it and start it again.');
  return result('starting');
}

let pendingStart = null;
/** Starts WordPress as a detached background process and returns at once (state 'starting'). */
export function startWordPress(options = {}) {
  // Two clicks at once must not launch two servers.
  pendingStart ??= launchWordPress(options).finally(() => { pendingStart = null; });
  return pendingStart;
}

async function launchWordPress({ root = process.cwd() } = {}) {
  const current = await wordpressStatus({ root });
  if (current.state === 'running' || current.state === 'starting') return current;
  const paths = wordpressPaths(root);
  if (!await exists(paths.cli)) throw new Error('WordPress Playground is not installed. Run npm install, then try again.');
  const port = wordpressPort();
  if (!await portIsFree(port)) throw new Error(`Port ${port} is already in use by another program. Close it or set SITEFORGE_WP_PORT to a free port.`);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  const env = { ...process.env, SITEFORGE_WP_PORT: String(port) };
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, [paths.launcher, '--background'], { cwd: root, env, detached: true, windowsHide: true, stdio: 'ignore', shell: false });
  await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
  child.unref();
  const startedAt = new Date().toISOString();
  // The launcher writes the same record moments later; writing it here makes status say 'starting' immediately.
  const record = await readJsonFile(paths.runtime);
  if (record?.pid !== child.pid) await atomicJson(paths.runtime, { pid: child.pid, port, state: 'starting', startedAt, launchedBy: 'app' });
  return { ...await wordpressStatus({ root }), state: 'starting' };
}

function killTree(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (process.platform === 'win32') {
    // Windows has no process groups or SIGTERM; taskkill /T ends the launcher and the Playground processes under it.
    return new Promise(resolve => execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  }
  try { process.kill(-pid, signal); return Promise.resolve(); } catch { /* Not a group leader (started from a terminal): signal the launcher. */ }
  try { process.kill(pid, signal); } catch { /* Already gone. */ }
  return Promise.resolve();
}

/** Stops WordPress (started by the app or by npm run wordpress). Files and database stay in .wordpress/site. */
export async function stopWordPress({ root = process.cwd() } = {}) {
  const paths = wordpressPaths(root);
  const record = await readJsonFile(paths.runtime);
  const current = await wordpressStatus({ root });
  // Only signal processes that are still our WordPress; a stale record's process IDs may belong to other programs now.
  if (!record || !['running', 'starting'].includes(current.state)) {
    if (record && ['running', 'starting'].includes(record.state)) await atomicJson(paths.runtime, { ...record, state: current.state === 'failed' ? 'failed' : 'stopped', stoppedAt: new Date().toISOString() });
    return wordpressStatus({ root });
  }
  const pids = [record.pid, record.childPid].filter(pid => Number.isInteger(pid) && pid > 0 && isAlive(pid));
  for (const pid of pids) await killTree(pid, 'SIGTERM');
  const deadline = Date.now() + STOP_WAIT_MS;
  while (pids.some(isAlive) && Date.now() < deadline) await pause(200);
  for (const pid of pids.filter(isAlive)) await killTree(pid, 'SIGKILL');
  const killDeadline = Date.now() + 5000;
  while (pids.some(isAlive) && Date.now() < killDeadline) await pause(100);
  if (pids.some(isAlive)) throw new Error('WordPress could not be stopped. Try again in a moment.');
  const latest = await readJsonFile(paths.runtime) ?? record;
  await atomicJson(paths.runtime, { ...latest, state: 'stopped', stoppedAt: new Date().toISOString(), cleanExit: true });
  return wordpressStatus({ root });
}

// ---- Launcher side (scripts/start-wordpress.mjs) ----

/** The importer plugin is written separately; make sure the folder holds at least a valid plugin header. */
export async function ensureImporterPlugin(paths) {
  await mkdir(paths.importer, { recursive: true });
  const candidates = (await readdir(paths.importer)).filter(name => name.endsWith('.php')).sort((a, b) => (b === 'siteforge-importer.php') - (a === 'siteforge-importer.php'));
  for (const name of candidates) {
    const head = (await readFile(join(paths.importer, name), 'utf8')).slice(0, 8192);
    if (/Plugin Name:/i.test(head)) return `siteforge-importer/${name}`;
  }
  // Never overwrite: the 'wx' flag fails if the file already exists.
  await writeFile(join(paths.importer, 'siteforge-importer.php'), '<?php /* Plugin Name: SiteForge Importer */\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return 'siteforge-importer/siteforge-importer.php';
}

export async function ensureConnection(paths, port, startedAt) {
  const existing = await readJsonFile(paths.connection);
  const token = typeof existing?.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(existing.token) ? existing.token : randomBytes(32).toString('base64url');
  const { url, adminUrl } = urlsFor(port);
  const connection = { url, adminUrl, username: WORDPRESS_USERNAME, password: WORDPRESS_PASSWORD, token, startedAt };
  await atomicJson(paths.connection, connection);
  return connection;
}

async function download(url, target, say) {
  if (await exists(target)) return target;
  say(`Downloading ${url} ...`);
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const partial = `${target}.partial`;
  const out = createWriteStream(partial);
  try { for await (const chunk of response.body) if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve)); }
  finally { await new Promise(resolve => out.end(resolve)); }
  await rename(partial, target);
  return target;
}

/** The newest stable WordPress zip. Pinned in setup.json so a reset can reinstall from the cached copy offline. */
async function wordpressRelease(paths, say) {
  const setup = await readJsonFile(paths.setup);
  if (setup?.wordpressZipUrl) return setup;
  say('Looking up the latest WordPress release ...');
  const response = await fetch(WORDPRESS_RELEASES_URL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not look up the latest WordPress release (${response.status}).`);
  const offer = (await response.json()).offers?.find(item => /^\d+\.\d+(\.\d+)?$/.test(item.version ?? '') && /^https:\/\/downloads\.wordpress\.org\/release\//.test(item.download ?? ''));
  if (!offer) throw new Error('The WordPress release list had no stable release.');
  const value = { ...setup, wordpressVersion: offer.version, wordpressZipUrl: offer.download, resolvedAt: new Date().toISOString() };
  await atomicJson(paths.setup, value);
  return value;
}

// Playground logs every cookie-less page request in as admin. Keep that for the dashboard only, so crawlers and
// the REST API see the public site logged out, like a real WordPress.
const LOCAL_LOGIN_MU_PLUGIN = `<?php
/**
 * Plugin Name: SiteForge local login
 * Description: Written by SiteForge on every start. Opening /wp-admin/ signs you in as admin automatically; public pages, the REST API and wp-login.php behave like a normal WordPress.
 */
$siteforge_path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!is_string($siteforge_path) || !preg_match('#^/wp-admin(/|$)#', $siteforge_path) || preg_match('#^/wp-admin/admin-(ajax|post)\\.php#', $siteforge_path)) {
\t$_COOKIE['playground_auto_login_already_happened'] = '1';
}
`;

// A PHP single-quoted literal: no variable interpolation, only \\ and \' are escapes.
const phpString = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function setupPhp({ importerPlugin }) {
  return `<?php
require '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$report = array('checkedAt' => gmdate('c'), 'plugins' => array(), 'warnings' => array());
// The documented local login: admin / password.
$user = get_user_by('login', ${phpString(WORDPRESS_USERNAME)});
if (!$user) {
\t$id = wp_create_user(${phpString(WORDPRESS_USERNAME)}, ${phpString(WORDPRESS_PASSWORD)}, 'admin@localhost.com');
\tif (is_wp_error($id)) { $report['warnings'][] = 'Could not create the admin user: ' . $id->get_error_message(); }
\telse { (new WP_User($id))->set_role('administrator'); }
} elseif (!wp_check_password(${phpString(WORDPRESS_PASSWORD)}, $user->user_pass, $user->ID)) {
\twp_set_password(${phpString(WORDPRESS_PASSWORD)}, $user->ID);
}
if (get_option('permalink_structure') !== '/%postname%/') {
\tglobal $wp_rewrite;
\t$wp_rewrite->set_permalink_structure('/%postname%/');
}
flush_rewrite_rules(false);
wp_mkdir_p(WPMU_PLUGIN_DIR);
file_put_contents(WPMU_PLUGIN_DIR . '/siteforge-local-login.php', base64_decode('${Buffer.from(LOCAL_LOGIN_MU_PLUGIN, 'utf8').toString('base64')}'));
foreach (array('elementor/elementor.php', ${phpString(importerPlugin)}) as $plugin) {
\tif (!file_exists(WP_PLUGIN_DIR . '/' . $plugin)) { $report['plugins'][$plugin] = 'missing'; continue; }
\ttry {
\t\t$result = is_plugin_active($plugin) ? null : activate_plugin($plugin);
\t\t$report['plugins'][$plugin] = is_wp_error($result) ? 'error: ' . $result->get_error_message() : (is_plugin_active($plugin) ? 'active' : 'inactive');
\t} catch (Throwable $error) {
\t\t$report['plugins'][$plugin] = 'error: ' . $error->getMessage();
\t}
}
// Elementor sends the first admin page after activation to its sign-up wizard; skip that so /wp-admin/ is the dashboard.
delete_transient('elementor_activation_redirect');
$report['wordpressVersion'] = get_bloginfo('version');
$report['theme'] = get_stylesheet();
$report['permalinkStructure'] = get_option('permalink_structure');
file_put_contents('/siteforge-cache/setup-report.json', json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
`;
}

export function buildBlueprint({ token, installElementor, importerPlugin }) {
  const steps = [
    { step: 'defineWpConfigConsts', method: 'rewrite-wp-config', consts: { WP_ENVIRONMENT_TYPE: 'local', SITEFORGE_IMPORT_TOKEN: token } },
    { step: 'setSiteOptions', options: { permalink_structure: '/%postname%/' } },
  ];
  if (installElementor) steps.push({ step: 'installPlugin', pluginData: { resource: 'vfs', path: '/siteforge-cache/elementor.zip' }, ifAlreadyInstalled: 'skip', options: { activate: true } });
  steps.push(
    { step: 'activatePlugin', pluginPath: 'elementor/elementor.php' },
    // Activates the SiteForge importer without failing the start if that plugin has an error; the result is reported.
    { step: 'runPHP', code: setupPhp({ importerPlugin }) },
    { step: 'login', username: WORDPRESS_USERNAME, password: WORDPRESS_PASSWORD },
  );
  return { $schema: 'https://playground.wordpress.net/blueprint-schema.json', landingPage: '/wp-admin/', steps };
}

/**
 * Runs WordPress until stopped: prepares .wordpress/, starts the Playground CLI server and records its state in
 * .wordpress/runtime.json. Used by scripts/start-wordpress.mjs.
 */
export async function runWordPress({ root = process.cwd(), background = false } = {}) {
  const paths = wordpressPaths(root);
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  await mkdir(paths.site, { recursive: true });
  const port = wordpressPort();
  const urls = urlsFor(port);
  const previous = await readJsonFile(paths.runtime);
  if (previous && previous.pid !== process.pid && isAlive(previous.pid) && ['starting', 'running'].includes(previous.state)) {
    const answering = await restAnswers(`http://127.0.0.1:${previous.port ?? port}`);
    if (answering || previous.state === 'starting') {
      console.log(`WordPress is already ${answering ? 'running' : 'starting'} at http://127.0.0.1:${previous.port ?? port} (PID ${previous.pid}). No new server was started.`);
      return 0;
    }
  }
  if (await exists(paths.log)) await rename(paths.log, join(paths.data, 'server.previous.log')).catch(() => {});
  const log = createWriteStream(paths.log, { flags: 'a', mode: 0o600 });
  const say = message => { log.write(`[siteforge] ${message}\n`); if (!background) console.log(message); };
  const startedAt = new Date().toISOString();
  let record = { pid: process.pid, port, state: 'starting', startedAt, launchedBy: background ? 'app' : 'terminal', ...urls };
  const save = async changes => { record = { ...record, ...changes }; await atomicJson(paths.runtime, record); };
  await save({});
  let child;
  let stopping = false;
  const finish = async (state, error) => {
    await save({ state, ...(error ? { error } : {}), ...(state === 'stopped' ? { stoppedAt: new Date().toISOString(), cleanExit: true } : {}) }).catch(() => {});
    await new Promise(resolve => log.end(resolve));
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    say('Stopping WordPress ...');
    if (child) { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000).unref(); }
    else void finish('stopped').then(() => process.exit(0));
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (process.platform !== 'win32') process.once('SIGHUP', stop);
  try {
    if (!await exists(paths.cli)) throw new Error('WordPress Playground is not installed. Run npm install, then try again.');
    if (!await portIsFree(port)) throw new Error(`Port ${port} is already in use by another program. Close it or set SITEFORGE_WP_PORT to a free port.`);
    const importerPlugin = await ensureImporterPlugin(paths);
    const connection = await ensureConnection(paths, port, startedAt);
    const installed = await exists(join(paths.site, 'wp-includes', 'version.php')) && await exists(join(paths.site, 'wp-config.php'));
    const installElementor = !await exists(join(paths.site, 'wp-content', 'plugins', 'elementor', 'elementor.php'));
    const release = await wordpressRelease(paths, say);
    if (installElementor) await download(ELEMENTOR_URL, join(paths.cache, 'elementor.zip'), say);
    await atomicJson(paths.blueprint, buildBlueprint({ token: connection.token, installElementor, importerPlugin }));
    await unlink(paths.report).catch(() => {});
    await save({ firstRun: !installed, wordpressVersion: release.wordpressVersion });
    say(installed ? `Starting WordPress from ${paths.site} ...` : `Installing WordPress ${release.wordpressVersion} into ${paths.site} (first run, takes a few minutes) ...`);
    const args = [
      paths.cli, 'server',
      '--port', String(port), '--site-url', urls.url, '--php', PHP_VERSION, '--wp', release.wordpressZipUrl,
      '--wordpress-install-mode', installed ? 'install-from-existing-files-if-needed' : 'download-and-install',
      '--mount-dir-before-install', paths.site, '/wordpress',
      '--mount-dir', paths.importer, '/wordpress/wp-content/plugins/siteforge-importer',
      '--mount-dir', paths.cache, '/siteforge-cache',
      '--blueprint', paths.blueprint, '--login',
    ];
    // Playground caches downloads under the home folder; point it at .wordpress/cache so they stay with the site.
    const env = { ...process.env, HOME: paths.cache, USERPROFILE: paths.cache };
    delete env.NODE_OPTIONS;
    child = spawn(process.execPath, args, { cwd: paths.data, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    await save({ childPid: child.pid });
    const tee = stream => chunk => { log.write(chunk); if (!background) stream.write(chunk); };
    child.stdout.on('data', tee(process.stdout));
    child.stderr.on('data', tee(process.stderr));
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    // Playground answers requests as soon as WordPress boots, before the blueprint has run. The blueprint's last
    // PHP step writes the setup report, so wait for that report and for the REST index.
    let ready = false;
    const readiness = (async () => {
      while (!ready && !stopping) {
        if (await exists(paths.report) && await restAnswers(urls.url, 3000)) { ready = true; break; }
        await pause(500);
      }
    })();
    const outcome = await Promise.race([readiness.then(() => null), exited]);
    if (stopping) { await exited; await finish('stopped'); return 0; }
    if (outcome) throw new Error(`WordPress Playground exited before WordPress was ready (${outcome.signal ?? `code ${outcome.code}`}). See ${paths.log}.`);
    const report = await readJsonFile(paths.report);
    const warnings = [...report?.warnings ?? []];
    for (const [plugin, state] of Object.entries(report?.plugins ?? {})) if (state !== 'active') warnings.push(`${plugin}: ${state}`);
    await save({ state: 'running', readyAt: new Date().toISOString(), wordpressVersion: report?.wordpressVersion ?? release.wordpressVersion, theme: report?.theme ?? null, plugins: report?.plugins ?? null, warnings });
    await atomicJson(paths.connection, { ...connection, startedAt: record.readyAt });
    if (!installed) await atomicJson(paths.setup, { ...await readJsonFile(paths.setup), installedAt: record.readyAt });
    const seconds = ((Date.parse(record.readyAt) - Date.parse(startedAt)) / 1000).toFixed(1);
    say(`WordPress is ready after ${seconds} s: ${urls.url}/  (dashboard ${urls.adminUrl}, login ${WORDPRESS_USERNAME} / ${WORDPRESS_PASSWORD})`);
    for (const warning of warnings) say(`Warning: ${warning}`);
    if (!background) say('Press Ctrl+C to stop WordPress. Posts and settings are kept in .wordpress/site.');
    const end = await exited;
    if (stopping) { await finish('stopped'); return 0; }
    throw new Error(`WordPress Playground stopped unexpectedly (${end.signal ?? `code ${end.code}`}). See ${paths.log}.`);
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (stopping) { await finish('stopped'); return 0; }
    const message = String(error?.message ?? error).slice(0, 2000);
    say(`Error: ${message}`);
    await finish('failed', message);
    return 1;
  }
}
