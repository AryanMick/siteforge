#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runReferenceStudy } from '../src/reference-study.mjs';

try {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string', default: 'examples/reference-sites.json' },
      out: { type: 'string' },
      live: { type: 'boolean', default: false },
      seeds: { type: 'string' },
      levels: { type: 'string' },
      'max-pages': { type: 'string' },
      'delay-ms': { type: 'string' },
      threshold: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`Generate and score a bounded multi-reference synthetic study.

node scripts/reference-study.mjs --out outputs/reference-study
node scripts/reference-study.mjs --manifest examples/reference-sites.json --out outputs/live-reference-study --live

--out is required and must name a fresh directory.
Offline mode performs no reference network requests. --live enables sequential, robots-aware HTTPS sampling.
Optional controls: --seeds 48291,91703 --levels clean,cosmetic,high
--max-pages 5 (1..8 per public source) --delay-ms 1200 --threshold 0.32
Edit the manifest to change fictional schemas, optional fields, layouts or page counts.`);
  } else {
    if (!values.out) throw new Error('--out is required; use a fresh directory');
    const manifest = JSON.parse(await readFile(values.manifest, 'utf8'));
    const options = { live: values.live };
    for (const name of ['seeds','levels']) if (values[name] !== undefined) {
      const parts = values[name].split(',').map(part => part.trim());
      if (parts.some(part => !part)) throw new Error(`--${name} contains an empty item`);
      options[name] = name === 'seeds' ? parts.map(Number) : parts;
    }
    for (const [flag, name] of [['max-pages','maxPages'],['delay-ms','delayMs'],['threshold','threshold']]) if (values[flag] !== undefined) options[name] = Number(values[flag]);
    const result = await runReferenceStudy(manifest, values.out, options);
    console.log(`${result.study.status}: ${result.output}`);
    console.log(`Report: ${result.output}/report.html`);
    if (result.study.status === 'failed') {
      for (const failure of result.study.gates.failures) console.error(failure);
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
