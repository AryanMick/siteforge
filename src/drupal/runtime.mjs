// The local Drupal that SiteForge puts generated sites into. Like the local WordPress it runs on PHP compiled to
// WebAssembly (the WordPress Playground server, pointed at a Drupal folder), so it needs no PHP, MySQL or Docker.
// Drupal's files and SQLite database live in .drupal/site and survive restarts. scripts/start-drupal.mjs runs the
// server; the app starts it in the background through startDrupal().
//
// Two things differ from a normal Drupal, both because of PHP-WASM:
// - PHP-WASM has no Fibers. Drupal only uses them to interleave rendering, so core's few `new \Fiber(...)` calls are
//   pointed at a stand-in that runs each callable straight through (sites/siteforge-sync-fiber.php).
// - SQLite uses a plain journal instead of WAL, whose shared-memory file the separate PHP workers cannot share.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, isAlive, killTree, portIsFree, probe, readJsonFile } from '../wordpress/runtime.mjs';

export const DRUPAL_USERNAME = 'admin';
export const DRUPAL_PASSWORD = 'password';
export const DEFAULT_DRUPAL_PORT = 9600;
const PHP_VERSION = '8.3';
const RELEASES_URL = 'https://updates.drupal.org/release-history/drupal/current';
const STARTING_LIMIT_MS = 20 * 60 * 1000;
const STOP_WAIT_MS = 15000;

export function drupalPaths(root = process.cwd()) {
  const data = join(/* turbopackIgnore: true */ root, '.drupal');
  return {
    root, data,
    site: join(data, 'site'),
    cache: join(data, 'cache'),
    runtime: join(data, 'runtime.json'),
    connection: join(data, 'connection.json'),
    setup: join(data, 'setup.json'),
    log: join(data, 'server.log'),
    launcher: join(/* turbopackIgnore: true */ root, 'scripts', 'start-drupal.mjs'),
    cli: join(/* turbopackIgnore: true */ root, 'node_modules', '@wp-playground', 'cli', 'wp-playground.js'),
  };
}

export function drupalPort(value = process.env.SITEFORGE_DRUPAL_PORT) {
  if (value === undefined || value === '') return DEFAULT_DRUPAL_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SITEFORGE_DRUPAL_PORT must be a port number from 1 to 65535, not "${value}".`);
  return port;
}

const urlsFor = port => { const url = `http://127.0.0.1:${port}`; return { url, adminUrl: `${url}/admin/content`, loginUrl: `${url}/user/login` }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async path => { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

/** True when the local Drupal answers SiteForge's health file with an installed site. */
export async function drupalAnswers(url, timeoutMs = 4000) {
  const answer = await probe(`${url}/siteforge-health.php`, timeoutMs);
  if (answer?.status !== 200) return false;
  try { return JSON.parse(answer.body).installed === true; } catch { return false; }
}

async function logTail(path, lines = 40) {
  try {
    const text = await readFile(path, 'utf8');
    return text.slice(-64 * 1024).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split('\n').map(line => line.split('\r').filter(Boolean).pop() ?? '')
      .filter(line => line.trim()).slice(-lines).join('\n');
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

/** Current state of the local Drupal: 'stopped' | 'starting' | 'running' | 'failed'. */
export async function drupalStatus({ root = process.cwd() } = {}) {
  const paths = drupalPaths(root);
  const record = await readJsonFile(paths.runtime);
  let port;
  try { port = Number.isInteger(record?.port) ? record.port : drupalPort(); } catch { port = DEFAULT_DRUPAL_PORT; }
  const urls = urlsFor(port);
  const base = { ...urls, port, username: DRUPAL_USERNAME, password: DRUPAL_PASSWORD, dataDirectory: paths.data };
  const details = { pid: record?.pid ?? null, startedAt: record?.startedAt ?? null, readyAt: record?.readyAt ?? null, firstRun: record?.firstRun ?? null, drupalVersion: record?.drupalVersion ?? null, site: record?.site ?? null };
  const tail = await logTail(paths.log);
  const result = (state, error = null, extra = {}) => ({ state, ...base, ...details, ...extra, error, logTail: tail });
  if (!record) return result('stopped');
  if (!isAlive(record.pid)) {
    if (record.state === 'failed') return result('failed', record.error ?? 'Drupal could not start. See the log below.');
    if (record.state === 'starting') return result('failed', 'Drupal stopped before it was ready. See the log below.');
    return result('stopped');
  }
  if (record.state === 'failed') return result('failed', record.error ?? 'Drupal could not start. See the log below.');
  if (record.state === 'running') {
    if (await drupalAnswers(urls.url, 5000)) return result('running');
    if (await portIsFree(port)) return result('stopped');
    return result('running', 'Drupal is running but did not answer within 5 seconds.', { healthy: false });
  }
  if (record.state === 'stopped') return result('stopped');
  const age = Date.now() - Date.parse(record.startedAt ?? 0);
  if (!(age <= STARTING_LIMIT_MS)) return result('failed', 'Drupal did not finish starting within 20 minutes. Stop it and start it again.');
  return result('starting');
}

let pendingStart = null;
/** Starts Drupal as a detached background process and returns at once (state 'starting'). */
export function startDrupal(options = {}) {
  pendingStart ??= launchDrupal(options).finally(() => { pendingStart = null; });
  return pendingStart;
}

async function launchDrupal({ root = process.cwd() } = {}) {
  const current = await drupalStatus({ root });
  if (current.state === 'running' || current.state === 'starting') return current;
  const paths = drupalPaths(root);
  if (!await exists(paths.cli)) throw new Error('WordPress Playground (which also runs Drupal) is not installed. Run npm install, then try again.');
  const port = drupalPort();
  if (!await portIsFree(port)) throw new Error(`Port ${port} is already in use by another program. Close it or set SITEFORGE_DRUPAL_PORT to a free port.`);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  const env = { ...process.env, SITEFORGE_DRUPAL_PORT: String(port) };
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, [paths.launcher, '--background'], { cwd: root, env, detached: true, windowsHide: true, stdio: 'ignore', shell: false });
  await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
  child.unref();
  const record = await readJsonFile(paths.runtime);
  if (record?.pid !== child.pid) await atomicJson(paths.runtime, { pid: child.pid, port, state: 'starting', startedAt: new Date().toISOString(), launchedBy: 'app' });
  return { ...await drupalStatus({ root }), state: 'starting' };
}

/** Stops Drupal. Files and database stay in .drupal/site. */
export async function stopDrupal({ root = process.cwd() } = {}) {
  const paths = drupalPaths(root);
  const record = await readJsonFile(paths.runtime);
  const current = await drupalStatus({ root });
  if (!record || !['running', 'starting'].includes(current.state)) {
    if (record && ['running', 'starting'].includes(record.state)) await atomicJson(paths.runtime, { ...record, state: current.state === 'failed' ? 'failed' : 'stopped', stoppedAt: new Date().toISOString() });
    return drupalStatus({ root });
  }
  const pids = [record.pid, record.childPid].filter(pid => Number.isInteger(pid) && pid > 0 && isAlive(pid));
  for (const pid of pids) await killTree(pid, 'SIGTERM');
  const deadline = Date.now() + STOP_WAIT_MS;
  while (pids.some(isAlive) && Date.now() < deadline) await pause(200);
  for (const pid of pids.filter(isAlive)) await killTree(pid, 'SIGKILL');
  const killDeadline = Date.now() + 5000;
  while (pids.some(isAlive) && Date.now() < killDeadline) await pause(100);
  if (pids.some(isAlive)) throw new Error('Drupal could not be stopped. Try again in a moment.');
  const latest = await readJsonFile(paths.runtime) ?? record;
  await atomicJson(paths.runtime, { ...latest, state: 'stopped', stoppedAt: new Date().toISOString(), cleanExit: true });
  return drupalStatus({ root });
}

// ---- Launcher side (scripts/start-drupal.mjs) ----

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

/** The newest stable Drupal 11 release, pinned in setup.json so later starts and resets reuse the cached download. */
async function drupalRelease(paths, say) {
  const setup = await readJsonFile(paths.setup);
  if (setup?.drupalTarUrl) return setup;
  say('Looking up the latest Drupal release ...');
  const response = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not look up the latest Drupal release (${response.status}).`);
  const xml = await response.text();
  for (const release of xml.split('<release>').slice(1)) {
    const version = release.match(/<version>([^<]+)<\/version>/)?.[1];
    const link = release.match(/<download_link>([^<]+)<\/download_link>/)?.[1];
    if (/^11\.\d+\.\d+$/.test(version ?? '') && /^https:\/\/ftp\.drupal\.org\/files\/projects\/drupal-[\d.]+\.tar\.gz$/.test(link ?? '')) {
      const value = { ...setup, drupalVersion: version, drupalTarUrl: link, resolvedAt: new Date().toISOString() };
      await atomicJson(paths.setup, value);
      return value;
    }
  }
  throw new Error('The Drupal release list had no stable Drupal 11 release.');
}

const run = (command, args, options) => new Promise((resolve, reject) => execFile(command, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => error ? reject(new Error(`${command} failed: ${stderr || error.message}`)) : resolve(stdout)));

// PHP stand-in for \Fiber (see the top of this file).
const SYNC_FIBER = `<?php
// Written by SiteForge. PHP compiled to WebAssembly has no Fibers. Drupal only uses them to interleave work, so this
// stand-in runs each callable straight through: getCurrent() is always NULL, so Drupal never asks to suspend.
final class SiteforgeSyncFiber {
  private $callable; private bool $started = FALSE; private mixed $return = NULL;
  public function __construct(callable $callable) { $this->callable = $callable; }
  public function start(mixed ...$args): mixed { $this->started = TRUE; $this->return = ($this->callable)(...$args); return NULL; }
  public function resume(mixed $value = NULL): mixed { return NULL; }
  public function throw(\\Throwable $exception): mixed { throw $exception; }
  public function getReturn(): mixed { return $this->return; }
  public function isStarted(): bool { return $this->started; }
  public function isSuspended(): bool { return FALSE; }
  public function isRunning(): bool { return FALSE; }
  public function isTerminated(): bool { return $this->started; }
  public static function getCurrent(): ?self { return NULL; }
  public static function suspend(mixed $value = NULL): mixed { return NULL; }
}
`;

// PHP-WASM reports itself as the command line (PHP_SAPI is 'cli'), and Drupal then skips sessions, so nobody could log
// in. Core reads PHP_SAPI through this expression instead, which says 'cgi-fcgi' while serving a web request.
const WEB_SAPI = "(empty($_SERVER['REQUEST_METHOD']) ? PHP_SAPI : 'cgi-fcgi')";

/** Adjusts core for PHP-WASM (Fibers, PHP_SAPI; see above). Idempotent; returns the number of files changed. */
export async function patchCore(directory) {
  let changed = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { if (!/^tests?$/i.test(entry.name)) changed += await patchCore(path); continue; }
    if (!/\.(php|inc)$/.test(entry.name)) continue;
    const text = await readFile(path, 'utf8');
    if (!text.includes('\\Fiber') && !/(?<![\w$'])PHP_SAPI\b/.test(text)) continue;
    const next = text.replaceAll('new \\Fiber(', 'new \\SiteforgeSyncFiber(').replaceAll('\\Fiber::getCurrent(', '\\SiteforgeSyncFiber::getCurrent(').replaceAll('\\Fiber::suspend(', '\\SiteforgeSyncFiber::suspend(')
      .split(WEB_SAPI).map(part => part.replace(/(?<![\w$'\\])PHP_SAPI\b/g, WEB_SAPI)).join(WEB_SAPI);
    if (next !== text) { await writeFile(path, next); changed++; }
  }
  return changed;
}

const phpString = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const JOURNAL = "$databases['default']['default']['init_commands'] = ['wal' => 'PRAGMA journal_mode=DELETE'];";

function settingsBlock() {
  return `
// ---- Written by SiteForge ----
require_once DRUPAL_ROOT . '/sites/siteforge-sync-fiber.php';
$databases['default']['default'] = [
  'driver' => 'sqlite',
  'namespace' => 'Drupal\\\\sqlite\\\\Driver\\\\Database\\\\sqlite',
  'autoload' => 'core/modules/sqlite/src/Driver/Database/sqlite/',
  'database' => 'sites/default/files/.ht.sqlite',
  'prefix' => '',
];
$settings['hash_salt'] = ${phpString(randomBytes(32).toString('hex'))};
$settings['config_sync_directory'] = 'sites/default/files/config_sync';
$settings['trusted_host_patterns'] = ['^127\\.0\\.0\\.1$', '^localhost$'];
$settings['siteforge_token'] = require __DIR__ . '/siteforge-token.php';
`;
}

// Small PHP entry points in the Drupal root. Each one that changes Drupal checks the token from settings.php.
const BOOT = `use Drupal\\Core\\DrupalKernel; use Symfony\\Component\\HttpFoundation\\Request;
$siteforge_loader = require 'autoload.php';
$siteforge_request = Request::createFromGlobals();
$siteforge_kernel = DrupalKernel::createFromRequest($siteforge_request, $siteforge_loader, 'prod');
$siteforge_kernel->boot(); $siteforge_kernel->preHandle($siteforge_request);
if (!hash_equals((string) \\Drupal\\Core\\Site\\Settings::get('siteforge_token', ''), (string) ($_GET['token'] ?? ''))) { http_response_code(403); exit("Forbidden\\n"); }
set_time_limit(0);
header('Content-Type: application/json');`;

const ENTRY_POINTS = {
  'siteforge-health.php': `<?php
// Written by SiteForge: tells the app whether this Drupal is installed. It reveals nothing else.
header('Content-Type: application/json');
$siteforge_db = __DIR__ . '/sites/default/files/.ht.sqlite';
echo json_encode(['installed' => is_file($siteforge_db) && filesize($siteforge_db) > 100000 && is_file(__DIR__ . '/sites/default/files/.siteforge-installed')]);
`,
  'siteforge-install.php': `<?php
// Written by SiteForge: installs Drupal without the web wizard (what drush site:install does).
if (!hash_equals((string) require __DIR__ . '/sites/default/siteforge-token.php', (string) ($_GET['token'] ?? ''))) { http_response_code(403); exit("Forbidden\\n"); }
header('Content-Type: application/json');
if (is_file(__DIR__ . '/sites/default/files/.siteforge-installed')) { echo json_encode(['installed' => TRUE, 'already' => TRUE]); return; }
set_time_limit(0);
$class_loader = require __DIR__ . '/autoload.php';
require_once __DIR__ . '/core/includes/install.core.inc';
install_drupal($class_loader, [
  'interactive' => FALSE,
  'parameters' => ['profile' => 'standard', 'langcode' => 'en'],
  'forms' => [
    'install_configure_form' => [
      'site_name' => 'SiteForge Drupal', 'site_mail' => 'admin@localhost.com',
      'account' => ['name' => ${phpString(DRUPAL_USERNAME)}, 'mail' => 'admin@localhost.com', 'pass' => ['pass1' => ${phpString(DRUPAL_PASSWORD)}, 'pass2' => ${phpString(DRUPAL_PASSWORD)}]],
      'enable_update_status_module' => NULL, 'enable_update_status_emails' => NULL,
    ],
  ],
]);
echo json_encode(['installed' => TRUE]);
`,
  'siteforge-setup.php': `<?php
// Written by SiteForge: runs after every start. Keeps the documented login, the plain SQLite journal and the local
// login module, then marks the site as installed.
${BOOT}
\\Drupal::database()->query('PRAGMA journal_mode=DELETE');
if (!\\Drupal::moduleHandler()->moduleExists('siteforge_local')) \\Drupal::service('module_installer')->install(['siteforge_local']);
$siteforge_admin = \\Drupal\\user\\Entity\\User::load(1);
if ($siteforge_admin && !\\Drupal::service('password')->check(${phpString(DRUPAL_PASSWORD)}, $siteforge_admin->getPassword())) { $siteforge_admin->setPassword(${phpString(DRUPAL_PASSWORD)})->save(); }
touch(__DIR__ . '/sites/default/files/.siteforge-installed');
echo json_encode(['drupalVersion' => \\Drupal::VERSION, 'theme' => \\Drupal::config('system.theme')->get('default')]);
`,
  'siteforge-push.php': `<?php
// Written by SiteForge: installs, imports or removes the pushed site's module (modules/custom/siteforge_content).
${BOOT}
$siteforge_action = $_GET['action'] ?? '';
$siteforge_installer = \\Drupal::service('module_installer');
$siteforge_installed = \\Drupal::moduleHandler()->moduleExists('siteforge_content');
if ($siteforge_action === 'remove') {
  if ($siteforge_installed) $siteforge_installer->uninstall(['siteforge_content']);
  if (\\Drupal::service('theme_handler')->themeExists('siteforge_theme')) \\Drupal::service('theme_installer')->uninstall(['siteforge_theme']);
  echo json_encode(['removed' => $siteforge_installed]); return;
}
if ($siteforge_action !== 'import') { http_response_code(400); exit("Unknown action\\n"); }
if (!$siteforge_installed) $siteforge_installer->install(['siteforge_content']);
\\Drupal::moduleHandler()->loadInclude('siteforge_content', 'module');
// import_all prints progress lines for drush; keep the answer pure JSON.
ob_start(); siteforge_content_import_all(); ob_end_clean();
drupal_flush_all_caches();
$siteforge_counts = [];
foreach (\\Drupal::database()->query("SELECT type, COUNT(*) AS n FROM {node_field_data} WHERE type LIKE 'sf\\\\_%' ESCAPE '\\\\' GROUP BY type")->fetchAllKeyed() as $siteforge_type => $siteforge_n) {
  $siteforge_counts[$siteforge_type] = ['label' => \\Drupal\\node\\Entity\\NodeType::load($siteforge_type)?->label() ?? $siteforge_type, 'count' => (int) $siteforge_n];
}
echo json_encode(['types' => $siteforge_counts, 'theme' => \\Drupal::config('system.theme')->get('default')]);
`,
};

// Opening /admin signs you in as admin, like the local WordPress; public pages stay logged out.
const LOCAL_MODULE = {
  'siteforge_local.info.yml': `name: 'SiteForge local login'
type: module
description: 'Written by SiteForge. Opening /admin on this local test site signs you in as admin automatically.'
package: SiteForge
core_version_requirement: ^10 || ^11
`,
  'siteforge_local.services.yml': `services:
  siteforge_local.login:
    class: Drupal\\siteforge_local\\LocalLogin
    tags:
      - { name: event_subscriber }
`,
  'src/LocalLogin.php': `<?php

namespace Drupal\\siteforge_local;

use Drupal\\user\\Entity\\User;
use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpFoundation\\RedirectResponse;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

/**
 * Signs in as user 1 on /admin pages of this local test site.
 */
class LocalLogin implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    // After the authentication subscriber (priority 300), before routing access checks.
    return [KernelEvents::REQUEST => ['onRequest', 100]];
  }

  public function onRequest(RequestEvent $event): void {
    if (!$event->isMainRequest() || !\\Drupal::currentUser()->isAnonymous()) {
      return;
    }
    $request = $event->getRequest();
    if (!preg_match('#^/admin(/|$)#', $request->getPathInfo())) {
      return;
    }
    $account = User::load(1);
    if ($account) {
      user_login_finalize($account);
      $event->setResponse(new RedirectResponse($request->getRequestUri()));
    }
  }

}
`,
};

/** Writes Drupal's files on first run and SiteForge's helper files on every start. */
async function prepareSite(paths, release, token, say) {
  const installedFiles = await exists(join(paths.site, 'core', 'lib', 'Drupal.php'));
  if (!installedFiles) {
    const archive = await download(release.drupalTarUrl, join(paths.cache, `drupal-${release.drupalVersion}.tar.gz`), say);
    say(`Unpacking Drupal ${release.drupalVersion} ...`);
    await mkdir(paths.site, { recursive: true });
    // tar ships with macOS, Linux and Windows 10 or later.
    await run('tar', ['-xzf', archive, '-C', paths.site, '--strip-components=1']);
  }
  await writeFile(join(paths.site, 'sites', 'siteforge-sync-fiber.php'), SYNC_FIBER);
  const patched = await patchCore(join(paths.site, 'core'));
  if (patched) say(`Adjusted ${patched} Drupal core files for PHP-WASM (Fibers, command-line check).`);
  // The token lives in a PHP file that returns it, so the web server never shows it as text.
  await writeFile(join(paths.site, 'sites', 'default', 'siteforge-token.php'), `<?php return ${phpString(token)};\n`);
  const settings = join(paths.site, 'sites', 'default', 'settings.php');
  if (!await exists(settings)) {
    await copyFile(join(paths.site, 'sites', 'default', 'default.settings.php'), settings);
    await writeFile(settings, (await readFile(settings, 'utf8')) + settingsBlock());
  }
  await mkdir(join(paths.site, 'sites', 'default', 'files'), { recursive: true });
  for (const [name, text] of Object.entries(ENTRY_POINTS)) await writeFile(join(paths.site, name), text);
  for (const [name, text] of Object.entries(LOCAL_MODULE)) {
    const target = join(paths.site, 'modules', 'custom', 'siteforge_local', name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, text);
  }
  return !installedFiles;
}

/** The token SiteForge uses for its entry points, read from settings.php (written on first run). */
export async function drupalToken(root = process.cwd()) {
  const file = await readFile(join(drupalPaths(root).site, 'sites', 'default', 'siteforge-token.php'), 'utf8').catch(() => '');
  return file.match(/return '([0-9a-f]+)';/)?.[1] ?? null;
}

export async function call(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${new URL(url).pathname} did not answer JSON: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500)}`); }
}

/** Runs Drupal until stopped: prepares .drupal/, starts the server and records its state in .drupal/runtime.json. */
export async function runDrupal({ root = process.cwd(), background = false } = {}) {
  const paths = drupalPaths(root);
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  const port = drupalPort();
  const urls = urlsFor(port);
  const previous = await readJsonFile(paths.runtime);
  if (previous && previous.pid !== process.pid && isAlive(previous.pid) && ['starting', 'running'].includes(previous.state)) {
    console.log(`Drupal is already ${previous.state} at http://127.0.0.1:${previous.port ?? port} (PID ${previous.pid}). No new server was started.`);
    return 0;
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
    say('Stopping Drupal ...');
    if (child) { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000).unref(); }
    else void finish('stopped').then(() => process.exit(0));
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (process.platform !== 'win32') process.once('SIGHUP', stop);
  try {
    if (!await exists(paths.cli)) throw new Error('WordPress Playground (which also runs Drupal) is not installed. Run npm install, then try again.');
    if (!await portIsFree(port)) throw new Error(`Port ${port} is already in use by another program. Close it or set SITEFORGE_DRUPAL_PORT to a free port.`);
    const release = await drupalRelease(paths, say);
    const token = await drupalToken(root) ?? randomBytes(24).toString('hex');
    const firstRun = await prepareSite(paths, release, token, say);
    await atomicJson(paths.connection, { url: urls.url, adminUrl: urls.adminUrl, username: DRUPAL_USERNAME, password: DRUPAL_PASSWORD, token });
    await save({ firstRun, drupalVersion: release.drupalVersion });
    say(firstRun ? `Installing Drupal ${release.drupalVersion} into ${paths.site} (first run, takes a few minutes) ...` : `Starting Drupal from ${paths.site} ...`);
    const args = [
      paths.cli, 'server', '--port', String(port), '--site-url', urls.url, '--php', PHP_VERSION,
      '--wordpress-install-mode', 'do-not-attempt-installing', '--skip-sqlite-setup',
      '--mount-dir-before-install', paths.site, '/wordpress',
      '--php-ini', 'memory_limit', '1024M', '--php-ini', 'max_execution_time', '0',
    ];
    const env = { ...process.env, HOME: paths.cache, USERPROFILE: paths.cache };
    delete env.NODE_OPTIONS;
    child = spawn(process.execPath, args, { cwd: paths.data, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    await save({ childPid: child.pid });
    const tee = stream => chunk => { log.write(chunk); if (!background) stream.write(chunk); };
    child.stdout.on('data', tee(process.stdout));
    child.stderr.on('data', tee(process.stderr));
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const setup = (async () => {
      while (!stopping && (await probe(`${urls.url}/siteforge-health.php`, 3000))?.status !== 200) await pause(500);
      if (stopping) return null;
      const settings = join(paths.site, 'sites', 'default', 'settings.php');
      if (!await exists(join(paths.site, 'sites', 'default', 'files', '.siteforge-installed'))) {
        say('Running the Drupal installer ...');
        await call(`${urls.url}/siteforge-install.php?token=${token}`, 20 * 60 * 1000);
      }
      // The installer rewrites the database settings; a plain journal is set again after it.
      const text = await readFile(settings, 'utf8');
      if (!text.trimEnd().endsWith(JOURNAL)) await writeFile(settings, `${text.trimEnd()}\n${JOURNAL}\n`);
      return call(`${urls.url}/siteforge-setup.php?token=${token}`, 10 * 60 * 1000);
    })();
    const outcome = await Promise.race([setup.then(report => ({ report })), exited]);
    if (stopping) { await exited; await finish('stopped'); return 0; }
    if (!('report' in outcome)) throw new Error(`The PHP server exited before Drupal was ready (${outcome.signal ?? `code ${outcome.code}`}). See ${paths.log}.`);
    await save({ state: 'running', readyAt: new Date().toISOString(), drupalVersion: outcome.report?.drupalVersion ?? release.drupalVersion });
    if (firstRun) await atomicJson(paths.setup, { ...await readJsonFile(paths.setup), installedAt: record.readyAt });
    const seconds = ((Date.parse(record.readyAt) - Date.parse(startedAt)) / 1000).toFixed(1);
    say(`Drupal is ready after ${seconds} s: ${urls.url}/  (admin ${urls.url}/admin, login ${DRUPAL_USERNAME} / ${DRUPAL_PASSWORD})`);
    if (!background) say('Press Ctrl+C to stop Drupal. Content and settings are kept in .drupal/site.');
    const end = await exited;
    if (stopping) { await finish('stopped'); return 0; }
    throw new Error(`The PHP server stopped unexpectedly (${end.signal ?? `code ${end.code}`}). See ${paths.log}.`);
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (stopping) { await finish('stopped'); return 0; }
    const message = String(error?.message ?? error).slice(0, 2000);
    say(`Error: ${message}`);
    await finish('failed', message);
    return 1;
  }
}

