import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Given, Then, When, type World } from '@cucumber/cucumber';
import { validateProject, evaluationGate } from '../../src/pagepilot/config.mjs';
import { runPipeline, resultStatus } from '../../src/pagepilot/pipeline.mjs';
import type { PipelineResult } from '../../src/pagepilot/types';

interface PilotWorld extends World {
  pilotInput: ReturnType<typeof validateProject>;
  pilotResult: PipelineResult;
  pilotDirectory?: string;
  pilotEvaluation: ReturnType<typeof evaluationGate>;
  excludedUrl?: string;
  snapshotStages?: { id: string; status: string }[];
}
Given('a PagePilot {string} project with {string} noise', function(this: PilotWorld, profile: string, noise: string) {
  this.pilotInput = validateProject({ name: 'BDD pilot', profile, noise, pageCount: 24 });
});
When('its complete local pipeline runs', { timeout: 30000 }, async function(this: PilotWorld) {
  this.pilotDirectory = await mkdtemp(join(tmpdir(), 'pagepilot-bdd-'));
  this.pilotResult = await runPipeline(this.pilotInput, this.pilotDirectory) as unknown as PipelineResult;
});
Then('the PagePilot report contains {int} analyzed pages', function(this: PilotWorld, count: number) {
  assert.equal(this.pilotResult.metrics.pages, count);
  assert.equal(this.pilotResult.metrics.coverage, 1);
});
Then('the PagePilot benchmark gates have {string}', function(this: PilotWorld, status: string) {
  assert.equal(this.pilotResult.evaluation.status, status);
});
Then('the PagePilot report does not expose private answer labels', function(this: PilotWorld) {
  assert(!/canonicalValues|expectedCluster|ground-truth/.test(JSON.stringify(this.pilotResult)));
});
Then('the PagePilot run needs attention', function(this: PilotWorld) {
  assert.equal(resultStatus(this.pilotResult), 'attention');
});
When('a public PagePilot result is checked without an answer key', function(this: PilotWorld) {
  this.pilotEvaluation = evaluationGate({}, false);
});
Then('its evaluation status is not available', function(this: PilotWorld) {
  assert.equal(this.pilotEvaluation.status, 'not_available');
  assert.equal(this.pilotEvaluation.thresholds, null);
});
async function savedAnalysis(world: PilotWorld, exclude: boolean) {
  assert(world.pilotDirectory);
  world.excludedUrl = exclude ? world.pilotResult.pages[0].url : undefined;
  world.snapshotStages = [];
  world.pilotResult = await runPipeline(world.pilotInput, join(world.pilotDirectory, 'snapshot-analysis'),
    async (stage: { id: string; status: string }) => { world.snapshotStages!.push(stage); },
    { sourceDirectory: world.pilotDirectory, excludedUrls: world.excludedUrl ? [world.excludedUrl] : [], sourceProvenance: world.pilotResult.provenance }) as unknown as PipelineResult;
}
When('one captured page is excluded from a saved-snapshot analysis', async function(this: PilotWorld) {
  await savedAnalysis(this, true);
});
When('its saved snapshot is re-clustered without exclusions', async function(this: PilotWorld) {
  await savedAnalysis(this, false);
});
Then('the saved-snapshot coverage is {int} out of {int}', function(this: PilotWorld, found: number, expected: number) {
  assert.equal(this.pilotResult.metrics.coverage, found / expected);
  assert.equal(this.pilotResult.evaluation.status, 'failed');
});
Then('the excluded page remains in the observation audit', function(this: PilotWorld) {
  assert.equal(this.pilotResult.pages.length, 24);
  const page = this.pilotResult.pages.find(page => page.url === this.excludedUrl);
  assert.equal(page?.excluded, true);
  assert.equal(page?.cluster, 'excluded');
});
Then('snapshot preparation and crawling are skipped', function(this: PilotWorld) {
  for (const id of ['prepare', 'crawl']) assert.equal(this.snapshotStages?.filter(stage => stage.id === id).at(-1)?.status, 'skipped');
});
After(async function(this: PilotWorld) {
  if (this.pilotDirectory) await rm(this.pilotDirectory, { recursive: true, force: true });
});
