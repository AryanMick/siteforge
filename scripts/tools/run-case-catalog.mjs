import { createJob, getJob } from '../../src/fixture-lab/store.mjs';
import { CATALOG_SETTINGS } from '../../src/fixture-lab/case-catalog.mjs';
import { verifyCaseCatalogJob } from '../checks/check-case-catalog.mjs';

const job = await createJob({ ...CATALOG_SETTINGS, name: 'Full regression catalog', seed: 48291 });
console.log(`Generating 1,440 websites / 23,040 pages. Job: ${job.id}`);
let current = job;
while (current.status === 'running') {
  await new Promise(resolve => setTimeout(resolve, 1000));
  current = await getJob(job.id);
}
if (current.status !== 'completed') throw new Error(current.error || 'Catalog generation failed; completed websites were preserved.');
const { evidence, evidencePath } = await verifyCaseCatalogJob(job.id);
console.log(`${evidence.totals.passed}/${evidence.totals.cases} verified. ${evidencePath}`);
if (evidence.status !== 'passed') process.exitCode = 1;
