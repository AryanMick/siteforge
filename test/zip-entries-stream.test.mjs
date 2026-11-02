import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import AdmZip from 'adm-zip';
import { zipEntriesStream } from '../src/fixture-lab/archive.mjs';

const collect = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); };

test('a nested package that fails to open becomes an error note, not a truncated archive', async () => {
  const zip = new AdmZip(await collect(zipEntriesStream([
    { name: 'a.zip', open: async () => zipEntriesStream([{ name: 'inner.txt', data: 'inside' }]) },
    { name: 'b.zip', open: async () => { throw new Error('No generated pages were found to export'); } },
    { name: 'README.txt', data: 'readme' },
  ])));
  assert.deepEqual(zip.getEntries().map(entry => entry.entryName), ['a.zip', 'b.zip.ERROR.txt', 'README.txt']);
  assert.match(zip.readAsText('b.zip.ERROR.txt'), /No generated pages/);
  assert.equal(new AdmZip(zip.getEntry('a.zip').getData()).readAsText('inner.txt'), 'inside');
  // Nested ZIPs are deflated (method 8), never STORED with a data descriptor.
  assert.equal(zip.getEntry('a.zip').header.method, 8);
});

test('a client disconnect while a nested package is being prepared releases it', async () => {
  let inner;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const output = zipEntriesStream([{ name: 'slow.zip', open: async () => { await gate; inner = new PassThrough(); inner.write('x'.repeat(1024)); return inner; } }]);
  output.resume();
  output.destroy();
  release();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(inner, 'package was opened');
  assert.equal(inner.destroyed, true, 'opened package is destroyed after the disconnect');
});

test('readable streams and buffers keep working', async () => {
  const zip = new AdmZip(await collect(zipEntriesStream([{ name: 's.txt', open: async () => Readable.from(['abc']) }, { name: 'd.txt', data: 'def' }])));
  assert.equal(zip.readAsText('s.txt'), 'abc');
  assert.equal(zip.readAsText('d.txt'), 'def');
});
