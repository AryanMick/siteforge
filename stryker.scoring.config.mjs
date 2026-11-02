import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Focused mutation run for listing-record scoring in src/evaluator.mjs (repeatedItemScore, added 2026-11-02).
const reportDir = resolve(process.env.SITEFORGE_RUN_DIR || 'reports/scoring-mutation');

export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'command',
  tempDirName: mkdtempSync(join(tmpdir(), 'siteforge-scoring-mutation-')),
  commandRunner: { command: `${JSON.stringify(process.execPath)} --test test/evaluator.test.mjs` },
  mutate: ['src/evaluator.mjs:343-395'],
  coverageAnalysis: 'off',
  concurrency: 2,
  timeoutMS: 10000,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: `${reportDir}/mutation.json` },
  thresholds: { high: 90, low: 80, break: 75 },
  ignorePatterns: ['/.next/**', '/.next-dev/**', '/.cache/**', '/.stryker-tmp/**', '/.workbench/**', '/.fixture-lab/**', '/.pagepilot/**', '/outputs/**', '/reports/**', '/docs/**', '/public/**', '/node_modules/.cache/**'],
};
