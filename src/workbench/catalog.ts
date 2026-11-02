import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType, type FeatureChild, type Scenario } from '@cucumber/messages';
import type { FeatureSpec, ScenarioSpec } from './types';

function scenarioSpec(scenario: Scenario, tags: string[]): ScenarioSpec {
  return {
    id: scenario.id, name: scenario.name, line: scenario.location.line,
    tags: [...tags, ...scenario.tags.map(tag => tag.name)],
    steps: scenario.steps.map(step => `${step.keyword.trim()} ${step.text}`),
    examples: scenario.examples.reduce((n, example) => n + example.tableBody.length, 0),
  };
}

export function parseFeature(source: string, file: string): FeatureSpec {
  const messages = generateMessages(source, file, SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
    newId: IdGenerator.incrementing(), includeGherkinDocument: true, includePickles: false, includeSource: false,
  });
  const errors = messages.flatMap(message => message.parseError ? [message.parseError.message] : []);
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
  const feature = messages.find(message => message.gherkinDocument)?.gherkinDocument?.feature;
  if (!feature) throw new Error(`${file}: no Feature found`);
  const tags = feature.tags.map(tag => tag.name);
  const scenarios: ScenarioSpec[] = [];
  for (const child of feature.children as FeatureChild[]) {
    if (child.scenario) scenarios.push(scenarioSpec(child.scenario, tags));
    if (child.rule) for (const entry of child.rule.children) {
      if (entry.scenario) scenarios.push(scenarioSpec(entry.scenario, [...tags, ...child.rule.tags.map(tag => tag.name)]));
    }
  }
  return { id: file, name: feature.name, file, source, planned: tags.includes('@planned'), tags, scenarios };
}

export async function loadFeatures(root = process.cwd()): Promise<FeatureSpec[]> {
  const paths: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.feature')) paths.push(path);
    }
  }
  await visit(join(root, 'features'));
  const features = await Promise.all(paths.sort().map(async path => parseFeature(await readFile(path, 'utf8'), relative(root, path))));
  return features.sort((a, b) => Number(a.planned) - Number(b.planned) || Number(b.file === 'features/structure.feature') - Number(a.file === 'features/structure.feature') || a.file.localeCompare(b.file));
}
