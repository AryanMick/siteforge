import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drupalPort, drupalStatus, drupalToken, patchCore } from '../src/drupal/runtime.mjs';

test('patchCore points Drupal core at the Fiber stand-in and the web-request SAPI check, once', async () => {
  const core = await mkdtemp(join(tmpdir(), 'siteforge-drupal-core-'));
  try {
    await mkdir(join(core, 'lib'), { recursive: true });
    await mkdir(join(core, 'tests'), { recursive: true });
    const source = `<?php
function render($callable) {
  $fiber = new \\Fiber(static fn () => $callable());
  $fiber->start();
  if (\\Fiber::getCurrent() !== NULL) { \\Fiber::suspend(1); }
  return PHP_SAPI === 'cli' ? 'cli' : 'web';
}
$label = 'PHP_SAPI';
`;
    await writeFile(join(core, 'lib', 'Renderer.php'), source);
    await writeFile(join(core, 'lib', 'install.inc'), "<?php if (PHP_SAPI !== 'cli') { echo 1; }\n");
    await writeFile(join(core, 'tests', 'FiberTest.php'), source);
    assert.equal(await patchCore(core), 2);
    const patched = await readFile(join(core, 'lib', 'Renderer.php'), 'utf8');
    assert.match(patched, /new \\SiteforgeSyncFiber\(static fn/);
    assert.match(patched, /\\SiteforgeSyncFiber::getCurrent\(\)/);
    assert.match(patched, /\\SiteforgeSyncFiber::suspend\(1\)/);
    assert.match(patched, /return \(empty\(\$_SERVER\['REQUEST_METHOD'\]\) \? PHP_SAPI : 'cgi-fcgi'\) === 'cli'/);
    assert.match(patched, /\$label = 'PHP_SAPI';/, 'strings are left alone');
    assert.equal(await readFile(join(core, 'tests', 'FiberTest.php'), 'utf8'), source, 'tests are left alone');
    assert.equal(await patchCore(core), 0, 'running again changes nothing');
  } finally { await rm(core, { recursive: true, force: true }); }
});

test('the local Drupal reports stopped before its first start and checks its port setting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-drupal-root-'));
  try {
    const status = await drupalStatus({ root });
    assert.equal(status.state, 'stopped');
    assert.equal(status.url, 'http://127.0.0.1:9600');
    assert.equal(status.username, 'admin');
    assert.equal(await drupalToken(root), null);
    assert.equal(drupalPort(''), 9600);
    assert.equal(drupalPort('9700'), 9700);
    assert.throws(() => drupalPort('http'), /SITEFORGE_DRUPAL_PORT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
