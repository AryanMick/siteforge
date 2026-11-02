import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateConfig } from '../config.mjs';
import { hash } from '../util.mjs';
import { sitePlan } from './config.mjs';

export const planPath = jobDirectory => join(jobDirectory, 'plan.json');

export function createPlanSnapshot(request) {
  const sites = Array.from({ length: request.siteCount }, (_, index) => {
    const plan = sitePlan(request, index);
    return { ...plan, config: validateConfig(plan.config) };
  });
  return { version: 1, requestSha256: hash(request), sites };
}

export function planDescriptor(snapshot) {
  return { version: 1, sha256: hash(snapshot) };
}

export async function loadPlanSnapshot(job, directory) {
  const descriptor = job.planSnapshot;
  let snapshot;
  try { snapshot = JSON.parse(await readFile(planPath(directory), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && descriptor === undefined) return null;
    if (error.code === 'ENOENT') throw new Error('Saved plan snapshot is missing');
    throw error;
  }
  assert(descriptor, 'Saved plan snapshot has no job descriptor');
  assert.equal(descriptor.version, 1, 'Unsupported plan descriptor version');
  assert.match(descriptor.sha256, /^[a-f0-9]{64}$/, 'Invalid plan digest');
  assert.equal(snapshot.version, 1, 'Unsupported plan snapshot version');
  assert.equal(hash(snapshot), descriptor.sha256, 'Saved plan snapshot digest mismatch');
  assert.equal(snapshot.requestSha256, hash(job.config), 'Saved plan request differs from the job');
  assert(Array.isArray(snapshot.sites), 'Saved plan site inventory is missing');
  assert.equal(snapshot.sites.length, job.config.siteCount, 'Saved plan site count differs from the job');
  assert.equal(new Set(snapshot.sites.map(site => site.id)).size, snapshot.sites.length, 'Saved plan site IDs are not unique');
  let pages = 0;
  for (const plan of snapshot.sites) {
    assert.equal(plan.id, plan.summary.id, 'Saved plan summary identity differs');
    assert.equal(plan.id, plan.config.site.id, 'Saved plan config identity differs');
    assert.equal(plan.summary.pageCount, plan.config.site.pageCount, 'Saved plan page count differs');
    assert.deepEqual(validateConfig(plan.config), plan.config, 'Saved plan config is not complete');
    pages += plan.summary.pageCount;
  }
  assert.equal(pages, job.totalPages, 'Saved plan page total differs from the job');
  return snapshot;
}

export function assertSavedSiteSummary(summary, config, index, request) {
  const custom = request.suite === 'custom' || request.suite === undefined;
  const specified = value => value !== undefined && value !== 'random';
  assert.equal(summary.id, config.site.id, 'Saved site identity differs from its config');
  assert.equal(summary.pageCount, config.site.pageCount, 'Saved site page count differs from its config');
  assert.equal(summary.seed, config.seed, 'Saved site seed differs from its config');
  for (const key of ['domain', 'framework', 'visualStyle', 'linkMode', 'cmsProfile']) {
    if (key in summary) assert.equal(summary[key], config.site[key], `Saved site ${key} differs from its config`);
  }
  if (custom && 'name' in summary) assert.equal(summary.name, config.site.name, 'Saved site name differs from its config');
  if ('builderProfile' in summary) assert.equal(summary.builderProfile, config.site.builderProfile ?? 'none', 'Saved site builderProfile differs from its config');
  if ('noise' in summary) assert.equal(summary.noise, config.noise.level, 'Saved site noise differs from its config');
  if ('transport' in summary) assert.equal(summary.transport, config.transport.profile, 'Saved site transport differs from its config');
  if ('previewProtocol' in summary) assert.equal(summary.previewProtocol, config.previewProtocol, 'Saved site protocol differs from its config');
  if ('challenge' in summary) assert.equal(summary.challenge, config.challenge, 'Saved site challenge differs from its config');
  if ('randomness' in summary) assert.equal(summary.randomness, config.variation?.amount, 'Saved site variation differs from its config');
  if ('fieldLayout' in summary) assert(config.contentTypes.every(type => type.fieldLayout === summary.fieldLayout), 'Saved site field layout differs from its config');
  if (custom) {
    assert.equal(summary.id, `site-${String(index + 1).padStart(3, '0')}-${config.site.domain}`, 'Saved site order differs from its config');
    const fixedChoices = {
      domain: config.site.domain, framework: config.site.framework, visualStyle: config.site.visualStyle,
      noise: config.noise.level, linkMode: config.site.linkMode, cmsProfile: config.site.cmsProfile,
      builderProfile: config.site.builderProfile ?? 'none', transport: config.transport.profile,
      previewProtocol: config.previewProtocol, challenge: config.challenge,
    };
    for (const [key, actual] of Object.entries(fixedChoices)) {
      if (specified(request[key]) && (!['domain', 'framework', 'visualStyle', 'noise'].includes(key) || request[key] !== 'mixed')) {
        assert.equal(actual, request[key], `Saved site ${key} differs from the fixed request`);
      }
    }
    if (specified(request.fieldLayout)) assert(config.contentTypes.every(type => type.fieldLayout === request.fieldLayout), 'Saved site field layout differs from the fixed request');
    if (request.randomness !== undefined) assert.equal(config.variation?.amount, request.randomness, 'Saved site variation differs from the fixed request');
    if (specified(request.scenario) && 'scenario' in summary) assert.equal(summary.scenario, request.scenario, 'Saved site scenario differs from the fixed request');
    if (typeof request.optionalFields === 'boolean' && 'optionalFields' in summary) assert.equal(summary.optionalFields, request.optionalFields, 'Saved site optional fields differ from the fixed request');
  }
  if (request.randomPageCount === true) assert(Number.isInteger(summary.pageCount) && summary.pageCount >= 5 && summary.pageCount <= request.pagesPerSite, `Saved random site page count is outside 5..${request.pagesPerSite}`);
  else if (request.pagesPerSite === 0) assert(Number.isInteger(summary.pageCount) && summary.pageCount >= 5 && summary.pageCount <= 200, 'Saved random site page count is outside 5..200');
  else if (request.pagesPerSite !== undefined) assert.equal(summary.pageCount, request.pagesPerSite, 'Saved site page count differs from the request');
}
