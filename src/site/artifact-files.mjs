import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Returns paths relative to root with '/' separators on every OS, so manifests and ZIP names match on Windows.
export async function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
