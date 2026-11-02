const support = ['./scripts/register-tsx.mjs', 'features/steps/**/*.ts'];

export default {
  paths: ['features/*.feature'],
  import: support,
  tags: 'not @planned',
  format: ['progress'],
  parallel: 0,
};

export const mutation = {
  paths: ['features/structure.feature'],
  import: ['./scripts/register-tsx.mjs', 'features/steps/structure.steps.ts'],
  tags: '@core and not @planned',
  parallel: 0,
};
