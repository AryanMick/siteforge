import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertNoRuntimeArtifacts(files, tracePath, root) {
  assert(Array.isArray(files) && files.every(file => typeof file === 'string'), 'Invalid production trace');
  const runtimeDirectories = ['.fixture-lab', '.pagepilot', '.workbench', 'outputs', 'reports', '.cache'];
  for (const file of files) {
    const traced = relative(root, resolve(dirname(tracePath), file));
    assert(!runtimeDirectories.some(directory => traced === directory || traced.startsWith(directory + sep)), `Runtime data included in deployment trace: ${traced}`);
  }
}

export async function checkBuild(root = process.cwd()) {
  const directory = join(root, '.next', 'server');
  const traces = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.nft.json'))
    .map(entry => join(entry.parentPath, entry.name));
  assert(traces.length >= 6, 'Expected completed Next.js production traces; run next build first');
  for (const path of traces) assertNoRuntimeArtifacts(JSON.parse(await readFile(path, 'utf8')).files, path, root);
  console.log(`Production privacy: ${traces.length} traces exclude runtime fixtures, answer keys and saved test data.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkBuild();
