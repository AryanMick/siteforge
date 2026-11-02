import { ZodError, ZodIssueCode } from 'zod';
import { validateFixtureInput } from './config.mjs';

// Saved requests retain their historical parser; new generation cannot ignore overrides.
export function validateNewFixtureInput(input) {
  const value = validateFixtureInput(input);
  if (value.suite === 'custom') {
    if (value.builderProfile === 'random' && !['wordpress', 'random'].includes(value.cmsProfile)) {
      throw new ZodError([{ code: ZodIssueCode.custom, path: ['builderProfile'],
        message: 'Random page-builder markup requires WordPress or a random CMS profile.' }]);
    }
    return value;
  }
  const unsupported = ['cmsProfile', 'builderProfile', 'linkMode', 'randomness', 'sourceClutter']
    .filter(key => value[key] !== undefined);
  if (unsupported.length) throw new ZodError(unsupported.map(key => ({
    code: ZodIssueCode.custom, path: [key],
    message: 'Catalog cases use fixed settings. Omit this option or use a custom test set.',
  })));
  return value;
}
