import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { answerJson } from './archive.mjs';

const CHUNK_SIZE = 250;
export const inspectionQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(200).default(''),
}).strict();

export function answerSummary(answer) {
  const counts = {};
  let affectedPages = 0;
  for (const page of answer.pages) {
    if (page.noiseEvents.length) affectedPages++;
    for (const event of page.noiseEvents) counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return { version: 1, pageCount: answer.pages.length, schemaDefinitions: answer.schemaDefinitions,
    transport: answer.transport, coverage: { counts, affectedPages },
    pages: answer.pages.map((page, index) => ({ index, pageId: page.pageId, url: page.url, contentType: page.contentType, expectedCluster: page.expectedCluster })) };
}

export async function writeAnswerInspection(privateRoot, answer) {
  await mkdir(join(privateRoot, 'answer-pages'), { mode: 0o700 });
  for (let offset = 0; offset < answer.pages.length; offset += CHUNK_SIZE) {
    await writeFile(join(privateRoot, 'answer-pages', `${offset / CHUNK_SIZE}.json`), JSON.stringify(answer.pages.slice(offset, offset + CHUNK_SIZE)), { mode: 0o600 });
  }
  await writeFile(join(privateRoot, 'answer-index.json'), JSON.stringify(answerSummary(answer)), { mode: 0o600 });
}

export async function inspectAnswers(directory, input) {
  const { offset, limit, q } = inspectionQuery.parse(input);
  let index;
  let legacy;
  try { index = JSON.parse(await readFile(join(directory, 'private', 'answer-index.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    legacy = JSON.parse(await answerJson(directory));
    index = answerSummary(legacy);
  }
  const query = q.toLowerCase();
  const matched = index.pages.filter(page => `${page.url} ${page.contentType} ${page.expectedCluster} ${page.pageId}`.toLowerCase().includes(query));
  const selected = matched.slice(offset, offset + limit);
  const chunks = new Map();
  const pages = [];
  for (const item of selected) {
    if (legacy) { pages.push(legacy.pages[item.index]); continue; }
    const chunk = Math.floor(item.index / CHUNK_SIZE);
    if (!chunks.has(chunk)) chunks.set(chunk, JSON.parse(await readFile(join(directory, 'private', 'answer-pages', `${chunk}.json`), 'utf8')));
    pages.push(chunks.get(chunk)[item.index % CHUNK_SIZE]);
  }
  return { pages, schemaDefinitions: index.schemaDefinitions, transport: index.transport, coverage: index.coverage,
    pagination: { total: index.pageCount, matched: matched.length, offset, limit } };
}
