import ZipStream from 'zip-stream';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { listFiles } from '../artifact-files.mjs';

export async function publicZip(siteDirectory) {
  const chunks = [];
  for await (const chunk of await publicZipStream(siteDirectory)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function publicZipStream(siteDirectory) {
  const root = join(/* turbopackIgnore: true */ siteDirectory, 'public');
  const files = await listFiles(root);
  return zipEntriesStream(files.map(file => ({ name: file.replaceAll('\\', '/'), path: join(root, file) })));
}

// Streams a ZIP of { name, path } (copied from disk), { name, data } (generated) and { name, open } (an async function
// returning a readable stream, opened only when its turn comes, e.g. a nested ZIP) entries, one entry at a time:
// no unbounded stat queue or accumulated file buffers.
// `date` defaults to a fixed timestamp so public ZIPs are byte-for-byte repeatable; CMS packages pass the current
// time, because PHP's opcode cache only notices replaced theme or module files when their modification time changes.
export function zipEntriesStream(entries, { date = new Date('2020-01-01T00:00:00Z') } = {}) {
  const zip = new ZipStream({ forceZip64: entries.length >= 65535, zlib: { level: 6 } });
  const output = new PassThrough();
  let activeInput;
  zip.on('error', error => output.destroy(error));
  output.once('close', () => { activeInput?.destroy?.(); zip.destroy(); });
  zip.pipe(output);
  void (async () => {
    for (const entry of entries) {
      if (output.destroyed) return;
      let name = entry.name;
      let input;
      if (entry.open) {
        // A nested package that cannot be built becomes a short error note instead of truncating the whole archive.
        try { input = await entry.open(); }
        catch (error) { name = `${entry.name}.ERROR.txt`; input = Buffer.from(`This file could not be packaged: ${error.message}\n`); }
        // The client may have disconnected while the package was being prepared.
        if (output.destroyed) { input.destroy?.(); return; }
      } else input = entry.path ? createReadStream(entry.path) : Buffer.from(entry.data);
      const streamed = !Buffer.isBuffer(input);
      activeInput = streamed ? input : undefined;
      await new Promise((accept, reject) => {
        let settled = false;
        const cancelled = () => done(new Error('Archive download cancelled'));
        const done = error => {
          if (settled) return;
          settled = true;
          output.off('close', cancelled);
          if (streamed) input.off('error', done);
          error ? reject(error) : accept();
        };
        output.once('close', cancelled);
        if (streamed) input.once('error', done);
        // Streamed entries are always deflated: STORED entries with data descriptors break Java's ZipInputStream.
        zip.entry(input, { name, date, mode: 0o100644 }, done);
      });
    }
    zip.finalize();
  })().catch(error => { if (!output.destroyed) output.destroy(error); });
  return output;
}

export async function answerStream(siteDirectory) {
  let path = join(/* turbopackIgnore: true */ siteDirectory, 'private', 'answer-key.json');
  try { await stat(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    path = join(/* turbopackIgnore: true */ siteDirectory, 'private', 'ground-truth.json');
    await stat(path);
  }
  return createReadStream(path);
}

export async function answerJson(siteDirectory) {
  try { return await readFile(/* turbopackIgnore: true */ join(siteDirectory, 'private', 'answer-key.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readFile(/* turbopackIgnore: true */ join(siteDirectory, 'private', 'ground-truth.json'));
  }
}

export function downloadName(job, site, kind) {
  const base = `${job.name}-${site.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || site.id;
  if (kind === 'wordpress' || kind === 'drupal') return `${base}-${kind}-theme.zip`;
  return `${base}-${kind === 'public' ? 'public.zip' : 'answer-key.json'}`;
}
