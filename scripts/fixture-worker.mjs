import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../src/site/generator.mjs';
import { loadPlanSnapshot } from '../src/fixture-lab/plans.mjs';
import { atomicJson, claimBatch, directoryBytes, jobDirectory, releaseBatch, saveJob, siteDirectory, validUuid } from '../src/fixture-lab/store.mjs';
import { handoffDirectory, publishSiteHandoff } from '../src/fixture-lab/handoff.mjs';

const id = validUuid(process.argv[2]);
const job = JSON.parse(await readFile(join(jobDirectory(id), 'job.json'), 'utf8'));
await claimBatch(id);
await atomicJson(join(jobDirectory(id), 'worker.json'), { pid: process.pid, startedAt: new Date().toISOString() });

try {
  const snapshot = await loadPlanSnapshot(job, jobDirectory(id));
  if (!snapshot) throw new Error('The fixture worker requires a saved plan snapshot');
  await mkdir(join(jobDirectory(id), 'sites'), { recursive: true, mode: 0o700 });
  for (let index = 0; index < job.config.siteCount; index++) {
    const plan = snapshot.sites[index];
    job.progress = { siteIndex: index, phase: 'preparing', completedPages: 0, totalPages: plan.summary.pageCount };
    await saveJob(job);
    const generated = await generate(plan.config, siteDirectory(id, plan.id), { onProgress: async progress => {
      job.progress = { siteIndex: index, ...progress };
      await saveJob(job);
    } });
    const metadata = JSON.parse(await readFile(join(siteDirectory(id, plan.id), 'private', 'metadata.json'), 'utf8'));
    const site = { ...plan.summary, ...(metadata.site.shell ? { structure: metadata.site.shell } : {}), clusters: metadata.clusters.length, noiseEvents: generated.noiseEvents, transportRules: metadata.transport.ruleCount, handoff: { version: 1, status: 'pending', directory: handoffDirectory(id, plan.id) } };
    job.sites.push(site);
    job.completedSites = job.sites.length;
    job.progress = { siteIndex: index, phase: 'preparing-handoff', completedPages: plan.summary.pageCount, totalPages: plan.summary.pageCount };
    await saveJob(job);
    await publishSiteHandoff(id, plan.id);
    site.handoff.status = 'ready';
    await saveJob(job);
  }
  // What deleting the set frees: website files and answer keys, plus the evaluator copies. Those are clones that share
  // space on APFS but full copies on ext4/NTFS. Measuring is informational, so it never fails a finished set.
  try {
    job.diskBytes = await directoryBytes(join(jobDirectory(id), 'sites'));
    job.handoffBytes = await directoryBytes(join(jobDirectory(id), 'handoff'));
  } catch { delete job.diskBytes; delete job.handoffBytes; }
  job.status = 'completed'; job.finishedAt = new Date().toISOString();
  delete job.progress;
} catch (error) {
  for (const site of job.sites) if (site.handoff?.status === 'pending') site.handoff.status = 'failed';
  job.status = 'failed'; job.finishedAt = new Date().toISOString(); job.error = String(error?.message ?? error).slice(0, 1000);
  process.exitCode = 1;
} finally {
  // A visible terminal status means the next batch can acquire the generation lock.
  await releaseBatch(id);
  await saveJob(job);
}
