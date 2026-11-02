import { z } from 'zod';
import { seedFor } from '../util.mjs';
import { FIXTURE_DOMAINS, FIELD_LAYOUTS, validateFixtureInput } from './config.mjs';

export const randomRequestSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  pagesPerSite: z.number().int().min(0).max(100000).refine(value => value === 0 || value >= 5, 'Use at least 5 pages.').default(60),
  randomPageCount: z.boolean().optional(),
  randomness: z.number().int().min(0).max(100).default(50),
  framework: z.enum(['html', 'react', 'angular']).default('html'),
  previewProtocol: z.enum(['http', 'https']).default('http'),
  challenge: z.enum(['standard', 'hard', 'extreme']).optional(),
}).strict();

function choicesFor(amount) {
  if (amount === 0) return {
    layouts: ['definition-list'], styles: ['conventional'], noise: ['clean'], scenarios: ['baseline'],
  };
  if (amount <= 33) return {
    layouts: FIELD_LAYOUTS.slice(0, 3), styles: ['conventional', 'modern'], noise: ['low'],
    scenarios: ['baseline', 'inconsistent-fields'],
  };
  if (amount <= 66) return {
    layouts: FIELD_LAYOUTS, styles: ['conventional', 'modern', 'legacy'], noise: ['low', 'medium'],
    scenarios: ['baseline', 'legacy-clutter', 'inconsistent-fields', 'extraction-traps'],
  };
  return {
    layouts: FIELD_LAYOUTS, styles: ['legacy', 'legacy', 'conventional', 'modern'], noise: ['medium', 'high'],
    scenarios: ['baseline', 'legacy-clutter', 'inconsistent-fields', 'extraction-traps', 'parser-stress'],
  };
}

export function randomFixtureInput(input) {
  const value = randomRequestSchema.parse(input);
  if (value.seed === undefined) throw new Error('Resolve a random seed before constructing the fixture.');
  const pick = (key, choices) => choices[seedFor('random-fixture-v1', value.seed, key) % choices.length];
  const domain = pick('domain', FIXTURE_DOMAINS);
  const choices = choicesFor(value.randomness);
  return validateFixtureInput({
    name: `Random ${domain} / ${value.seed}`, siteCount: 1, pagesPerSite: value.pagesPerSite, ...(value.randomPageCount === undefined ? {} : { randomPageCount: value.randomPageCount }),
    seed: value.seed, randomness: value.randomness, domain, framework: value.framework, previewProtocol: value.previewProtocol,
    ...(value.challenge === undefined ? {} : { challenge: value.challenge }),
    visualStyle: pick('visual-style', choices.styles), fieldLayout: pick('layout', choices.layouts),
    noise: pick('noise', choices.noise), optionalFields: value.randomness > 0,
    scenario: pick('scenario', choices.scenarios),
    transport: 'none',
  });
}
