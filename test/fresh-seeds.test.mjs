import test from 'node:test';
import assert from 'node:assert/strict';
import { unusedSeed } from '../src/fixture-lab/seeds.mjs';

test('fresh seeds avoid saved values, including collisions and uint32 wraparound', () => {
  assert.equal(unusedSeed(new Set(), () => 0), 0);
  const used = new Set([0xffffffff, 0, 1, 2]);
  assert.equal(unusedSeed(used, () => 0xffffffff), 3);
  const generated = new Set();
  for (let index = 0; index < 100; index++) generated.add(unusedSeed(generated, () => 42));
  assert.equal(generated.size, 100);
});
