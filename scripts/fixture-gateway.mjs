import { getJob, validUuid } from '../src/fixture-lab/store.mjs';
import { siteHostname, startGateway } from '../src/fixture-lab/gateway.mjs';

if (process.argv[2] === 'hosts') {
  const job = await getJob(validUuid(process.argv[3]));
  if (!job) throw new Error('Fixture job not found');
  for (const site of job.sites) console.log(`127.0.0.1 ${siteHostname(site.id)}`);
} else {
  const jobId = validUuid(process.argv[2]);
  const job = await getJob(jobId);
  if (!job) throw new Error('Fixture job not found');
  const port = Number(process.env.SITEFORGE_GATEWAY_PORT ?? 4480);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SITEFORGE_GATEWAY_PORT must be 1-65535');
  const host = process.env.SITEFORGE_GATEWAY_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('SITEFORGE_GATEWAY_HOST must be a loopback or container bind address');
  const gateway = await startGateway({ jobId, port, host });
  console.log(`Fixture gateway for ${jobId} listening on ${host}:${gateway.port}`);
  const stop = async () => { await gateway.close(); process.exit(0); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}
