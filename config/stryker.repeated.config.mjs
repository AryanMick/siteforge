import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.env.SITEFORGE_RUN_DIR || 'reports/repeated-mutation');

export default {
  $schema: '../node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'command',
  tempDirName: mkdtempSync(join(tmpdir(), 'siteforge-repeated-mutation-')),
  commandRunner: { command: `${JSON.stringify(process.execPath)} --test test/repeated-item-locations-contract.test.mjs` },
  mutate: ['src/answers/repeated-item-locations.mjs'],
  coverageAnalysis: 'off',
  concurrency: 2,
  timeoutMS: 10000,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: `${reportDir}/mutation.html` },
  jsonReporter: { fileName: `${reportDir}/mutation.json` },
  thresholds: { high: 95, low: 90, break: 90 },
  ignorePatterns: ['/.next/**', '/.next-dev/**', '/.cache/**', '/.stryker-tmp/**', '/.workbench/**', '/.fixture-lab/**', '/.pagepilot/**', '/outputs/**', '/reports/**', '/docs/**', '/public/**'],
};
