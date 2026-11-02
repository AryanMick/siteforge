import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.env.SITEFORGE_RUN_DIR || 'reports/mutation');

export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'command',
  tempDirName: mkdtempSync(join(tmpdir(), 'siteforge-mutation-')),
  commandRunner: { command: 'npm run test:bdd -- --profile mutation' },
  mutate: ['src/engine/structure.ts'],
  coverageAnalysis: 'off',
  concurrency: 2,
  timeoutMS: 10000,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: `${reportDir}/mutation.html` },
  jsonReporter: { fileName: `${reportDir}/mutation.json` },
  thresholds: { high: 90, low: 75, break: 75 },
  ignorePatterns: ['/.next/**', '/.next-dev/**', '/.cache/**', '/.stryker-tmp/**', '/.workbench/**', '/.fixture-lab/**', '/.pagepilot/**', '/outputs/**', '/reports/**', '/docs/**', '/public/**'],
};
