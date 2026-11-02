export type RunKind = 'bdd' | 'mutation';
export type RunStatus = 'running' | 'passed' | 'failed' | 'interrupted';

export interface ScenarioSpec {
  id: string;
  name: string;
  line: number;
  tags: string[];
  steps: string[];
  examples: number;
}

export interface FeatureSpec {
  id: string;
  name: string;
  file: string;
  source: string;
  planned: boolean;
  tags: string[];
  scenarios: ScenarioSpec[];
}

export interface BehaviorSummary {
  scenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: { name: string; status: string; error?: string }[];
}

export interface MutationSummary {
  total: number;
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  excluded: number;
  ignored: number;
  compileErrors: number;
  runtimeErrors: number;
  pending: number;
  score: number | null;
  scope: string[];
}

export interface TestRun {
  id: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  error?: string;
  ownerPid: number;
  behavior?: BehaviorSummary;
  mutation?: MutationSummary;
  log: string;
}

export interface DashboardData {
  features: FeatureSpec[];
  runs: TestRun[];
}
