import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoRuntimeArtifacts } from '../scripts/check-runtime-artifacts.mjs';

test('production privacy checker rejects known answer-key leaks and invalid traces', () => {
  const root = '/example/project';
  const trace = '/example/project/.next/server/route.js.nft.json';
  assert.doesNotThrow(() => assertNoRuntimeArtifacts(['../../package.json', '../../public/book-cover.png'], trace, root));
  for (const directory of ['.fixture-lab', '.pagepilot', '.workbench', 'outputs', 'reports', '.cache']) {
    assert.throws(() => assertNoRuntimeArtifacts([`../../${directory}/private/ground-truth.json`], trace, root), /Runtime data included/);
  }
  assert.throws(() => assertNoRuntimeArtifacts(null, trace, root), /Invalid production trace/);
});
