import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';

// Read one ZIP entry at a time; never inflate an entire answer key into memory.
export async function verifyZipEntries(path, expected, { signal, timeoutMs = 300000 } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  cancellation.throwIfAborted();
  return new Promise((accept, reject) => {
    let active;
    let archive;
    let settled = false;
    const fail = failure => {
      if (settled) return;
      settled = true;
      cancellation.removeEventListener('abort', aborted);
      active?.destroy();
      archive?.close();
      reject(failure);
    };
    const aborted = () => fail(cancellation.reason);
    cancellation.addEventListener('abort', aborted, { once: true });
    yauzl.open(path, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (settled) { zip?.close(); return; }
      if (error) { fail(error); return; }
      archive = zip;
      const seen = new Set();
      zip.on('error', fail);
      zip.once('end', () => {
        try {
          assert.equal(seen.size, expected.size, 'Archive inventory is incomplete');
          settled = true;
          cancellation.removeEventListener('abort', aborted);
          accept({ entries: seen.size });
        } catch (failure) { fail(failure); }
      });
      zip.on('entry', entry => {
        void (async () => {
          assert(expected.has(entry.fileName), `Unexpected archive entry: ${entry.fileName}`);
          assert(!seen.has(entry.fileName), `Duplicate archive entry: ${entry.fileName}`);
          const stream = await new Promise((resolve, rejectStream) => zip.openReadStream(entry, (failure, input) => failure ? rejectStream(failure) : resolve(input)));
          if (settled) { stream.destroy(); return; }
          active = stream;
          const digest = createHash('sha256');
          for await (const chunk of stream) digest.update(chunk);
          assert.equal(digest.digest('hex'), expected.get(entry.fileName), `Archive digest mismatch: ${entry.fileName}`);
          seen.add(entry.fileName);
          active = undefined;
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}
