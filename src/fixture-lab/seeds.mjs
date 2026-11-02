import { randomBytes } from 'node:crypto';

export function unusedSeed(used, sample = () => randomBytes(4).readUInt32BE(0)) {
  if (used.size >= 0x100000000) throw new Error('All supported fixture seeds have been used.');
  let seed = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    seed = sample() >>> 0;
    if (!used.has(seed)) return seed;
  }
  // Preserve progress even if an entropy source repeatedly returns an existing seed.
  for (let attempt = 0; attempt <= used.size; attempt++) {
    seed = (seed + 1) >>> 0;
    if (!used.has(seed)) return seed;
  }
  throw new Error('Could not allocate a fresh fixture seed.');
}
