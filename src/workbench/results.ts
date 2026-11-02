import { z } from 'zod';
import type { BehaviorSummary, MutationSummary } from './types';

const cucumberReport = z.array(z.object({
  elements: z.array(z.object({
    name: z.string(), type: z.string().optional(),
    steps: z.array(z.object({ result: z.object({ status: z.string(), error_message: z.string().optional() }).optional() })).default([]),
    before: z.array(z.object({ result: z.object({ status: z.string(), error_message: z.string().optional() }).optional() })).default([]),
    after: z.array(z.object({ result: z.object({ status: z.string(), error_message: z.string().optional() }).optional() })).default([]),
  })).default([]),
}));

export function summarizeBehaviors(input: unknown): BehaviorSummary {
  const features = cucumberReport.parse(input);
  const cases = features.flatMap(feature => feature.elements.filter(e => e.type !== 'background').map(element => {
    const results = [...element.before, ...element.steps, ...element.after].map(s => s.result);
    const failure = results.find(r => r && ['failed', 'ambiguous', 'undefined', 'pending'].includes(r.status));
    const status = failure ? 'failed' : results.length && results.every(r => r?.status === 'passed') ? 'passed' : 'skipped';
    return { name: element.name, status, ...(failure?.error_message ? { error: failure.error_message } : {}) };
  }));
  return { scenarios: cases.length, passed: cases.filter(c => c.status === 'passed').length, failed: cases.filter(c => c.status === 'failed').length, skipped: cases.filter(c => c.status === 'skipped').length, cases };
}

export function summarizeMutations(input: unknown): MutationSummary {
  const report = z.object({ files: z.record(z.object({ mutants: z.array(z.object({ status: z.enum(['Killed', 'Timeout', 'Survived', 'NoCoverage', 'Ignored', 'CompileError', 'RuntimeError', 'Pending']) })) })) }).parse(input);
  const mutants = Object.values(report.files).flatMap(file => file.mutants);
  const count = (status: string) => mutants.filter(m => m.status === status).length;
  const killed = count('Killed'), survived = count('Survived'), timeout = count('Timeout'), noCoverage = count('NoCoverage');
  const valid = killed + survived + timeout + noCoverage;
  return { total: mutants.length, killed, survived, timeout, noCoverage, excluded: mutants.length - valid, ignored: count('Ignored'), compileErrors: count('CompileError'), runtimeErrors: count('RuntimeError'), pending: count('Pending'), score: valid ? 100 * (killed + timeout) / valid : null, scope: Object.keys(report.files) };
}
