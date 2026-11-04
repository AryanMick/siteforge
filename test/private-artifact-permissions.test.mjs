import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('new private artifacts stay owner-only even with a permissive process umask', { skip: process.platform === 'win32' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-private-permissions-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const script = `
    import assert from 'node:assert/strict';
    import { generate } from ${JSON.stringify(new URL('../src/site/generator.mjs', import.meta.url).href)};
    process.umask(0);
    const input = { site: { id: 'private-permissions', pageCount: 5 } };
    await generate(input, process.argv[1] + '/complete');
    await assert.rejects(generate(input, process.argv[1] + '/interrupted', {
      onProgress: async () => { throw new Error('Deliberate permission-check interruption'); }
    }), /Deliberate permission-check interruption/);
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root], { timeout: 30000 });
  const entries = await readdir(root);
  const interrupted = entries.find(name => name.startsWith('interrupted.building-'));
  assert(interrupted, 'Interrupted generation retains its diagnostic folder');
  for (const name of ['complete', interrupted]) {
    const privateRoot = join(root, name, 'private');
    const visited = [];
    async function inspect(directory) {
      assert.equal((await stat(directory)).mode & 0o777, 0o700, directory);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else {
          assert(entry.isFile(), `Unexpected private artifact: ${path}`);
          assert.equal((await stat(path)).mode & 0o777, 0o600, path);
          visited.push(entry.name);
        }
      }
    }
    await inspect(privateRoot);
    for (const file of ['canonical.json', 'answer-key.json', 'ground-truth.json', 'answer-index.json', '0.json']) {
      assert(visited.includes(file), `Missing private artifact ${file}`);
    }
    if (name === 'complete') {
      for (const file of ['config.json', 'transport.json', 'manifest.json', 'metadata.json', 'run.json']) assert(visited.includes(file), file);
      assert.match(await readFile(join(root, name, 'public/index.html'), 'utf8'), /<html/);
    } else {
      const failure = JSON.parse(await readFile(join(privateRoot, 'failure.json'), 'utf8'));
      assert.equal(failure.status, 'failed');
      assert.match(failure.message, /Deliberate permission-check interruption/);
    }
  }
});
