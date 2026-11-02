import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Page arrays are serialized record by record, without one giant JSON string.
export function* jsonChunks(value) {
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) yield `${index ? ',' : ''}${JSON.stringify(value[index]) ?? 'null'}`;
    yield ']';
  } else if (value && typeof value === 'object') {
    yield '{';
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      yield `${first ? '' : ','}${JSON.stringify(key)}:`;
      first = false;
      if (Array.isArray(item)) yield* jsonChunks(item);
      else yield JSON.stringify(item);
    }
    yield '}';
  } else yield JSON.stringify(value);
}

export function hashJson(value) {
  const digest = createHash('sha256');
  for (const chunk of jsonChunks(value)) digest.update(chunk);
  return digest.digest('hex');
}

export async function writeJsonArtifact(path, value) {
  await pipeline(Readable.from(jsonChunks(value)), createWriteStream(path, { mode: 0o600 }));
}

export async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
