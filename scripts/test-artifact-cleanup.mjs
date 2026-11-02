import { unlink } from 'node:fs/promises';
import { isAlive, previewRecord, validUuid } from '../src/fixture-lab/store.mjs';

export async function cleanupTestArtifacts({ base, request, jobIds, preview, downloadedFile, downloadedFiles = [], keepArtifacts = false }) {
  const errors = [];
  if (preview?.pid) {
    try {
      const record = await previewRecord(preview.jobId, preview.siteId);
      if (record?.pid === preview.pid) {
        if (preview.pid === process.pid) throw new Error('Preview PID is the test process');
        try { process.kill(preview.pid, 'SIGTERM'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        const deadline = Date.now() + 10000;
        while (isAlive(preview.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        if (isAlive(preview.pid)) throw new Error(`Preview ${preview.pid} did not stop within 10 seconds`);
      }
    } catch (error) { errors.push(new Error(`Could not stop owned preview: ${error.message}`, { cause: error })); }
  }
  if (!keepArtifacts) {
    const origin = new URL(base).origin;
    for (const id of [...jobIds].reverse()) {
      try {
        validUuid(id);
        const response = await request.delete(`${origin}/api/fixtures/${id}`, { headers: { Origin: origin } });
        if (![200, 404].includes(response.status())) throw new Error(`DELETE returned ${response.status()}: ${await response.text()}`);
      } catch (error) { errors.push(new Error(`Could not delete test job ${id}: ${error.message}`, { cause: error })); }
    }
    for (const file of new Set([downloadedFile, ...downloadedFiles].filter(Boolean))) {
      try { await unlink(file); }
      catch (error) { if (error.code !== 'ENOENT') errors.push(new Error(`Could not remove test download ${file}: ${error.message}`, { cause: error })); }
    }
  }
  return errors;
}
