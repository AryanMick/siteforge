import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryBytes } from '../src/fixture-lab/store.mjs';

test('directoryBytes sums regular files recursively without following links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-bytes-'));
  try {
    await mkdir(join(root, 'a', 'b'), { recursive: true });
    await writeFile(join(root, 'one.txt'), 'x'.repeat(100));
    await writeFile(join(root, 'a', 'b', 'two.txt'), 'y'.repeat(250));
    const outside = await mkdtemp(join(tmpdir(), 'siteforge-bytes-outside-'));
    await writeFile(join(outside, 'big.bin'), Buffer.alloc(5000));
    await symlink(outside, join(root, 'link'));
    assert.equal(await directoryBytes(root), 350);
    assert.equal(await directoryBytes(join(root, 'missing')), 0);
    await rm(outside, { recursive: true, force: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
