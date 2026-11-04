import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPipeline, resultStatus } from '../src/crawl/pagepilot/pipeline.mjs';
import { checkId, claimRun, runDirectory, releaseLock, saveRun, ownsLock, stopRequested } from '../src/crawl/pagepilot/store.mjs';

const id = checkId(process.argv[2]);
const run = await claimRun(id);
let settling = false;
async function fail(message) {
  if (settling) return;
  settling = true;
  run.status = 'failed'; run.error = message; run.finishedAt = new Date().toISOString();
  for (const stage of run.stages) if (stage.status === 'running') { stage.status = 'failed'; stage.message = message; }
  await saveRun(run); await releaseLock(id);
}
let timer;
process.once('SIGTERM', () => { void fail('Pipeline was interrupted.').finally(() => process.exit(1)); });
process.once('SIGINT', () => { void fail('Pipeline was interrupted.').finally(() => process.exit(1)); });
try {
  const input = JSON.parse(await readFile(join(runDirectory(id), 'input.json'), 'utf8'));
  const durationMinutes = input.maxDurationMinutes ?? 15;
  const timeoutMs = (durationMinutes * 60 + 120) * 1000;
  timer = setTimeout(() => {
    void fail(`Pipeline exceeded its ${durationMinutes + 2}-minute time limit.`).finally(() => process.exit(1));
  }, timeoutMs);
  const options = run.kind === 'recluster'
    ? { sourceDirectory: join(runDirectory(run.snapshotRunId), 'artifacts'), excludedUrls: run.excludedUrls, sourceProvenance: run.sourceProvenance }
    : { shouldStop: () => stopRequested(id), onCrawlProgress: async progress => {
      if (settling || !await ownsLock(id)) throw new Error('Pipeline interrupted or its ownership expired');
      run.crawlProgress = progress;
      await saveRun(run);
    } };
  run.result = await runPipeline(input, join(runDirectory(id), 'artifacts'), async update => {
    if (settling || !await ownsLock(id)) throw new Error('Pipeline interrupted or its ownership expired');
    Object.assign(run.stages.find(stage => stage.id === update.id), update);
    await saveRun(run);
  }, options);
  run.status = resultStatus(run.result);
  if (run.status === 'failed') run.error = 'No HTML pages could be analyzed. Check the URL outcomes and robots policy.';
  run.finishedAt = new Date().toISOString();
  settling = true; await saveRun(run);
} catch (error) {
  await fail(String(error.message).slice(0, 500));
} finally { if (timer) clearTimeout(timer); await releaseLock(id); }
