import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

test('CI keeps read-only pinned actions and opt-in live website samples', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/benchmark.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.equal(workflow.on.workflow_dispatch.inputs.public_samples.default, false);
  const steps = workflow.jobs.verify.steps;
  for (const step of steps.filter(step => step.uses)) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
  const live = steps.find(step => step.run === 'npm run test:public-sites');
  assert.equal(live.if, "github.event_name == 'workflow_dispatch' && inputs.public_samples");
  for (const command of ['npm test', 'npm run test:bdd', 'npm run test:mutation', 'npm run test:mutation:generator', 'npm run test:mutation:repeated', 'npm run test:pagepilot-ui', 'npm run test:legacy-browser']) assert(steps.some(step => step.run === command), command);
  assert.equal(steps.find(step => step.uses?.startsWith('actions/upload-artifact@')).if, 'always()');
});
