export type ProjectMode = 'synthetic' | 'public';
export type NoiseLevel = 'clean' | 'low' | 'medium' | 'high';
export type ProjectStatus = 'ready' | 'running' | 'completed' | 'attention' | 'failed';
export type StageId = 'prepare' | 'crawl' | 'cluster' | 'evaluate' | 'export';
export interface ProjectInput {
  name: string;
  mode: ProjectMode;
  profile: 'library' | 'archive' | 'government';
  noise: NoiseLevel;
  pageCount: number;
  seed: number;
  url: string;
  pathPrefix: string;
  maxPages: number;
  maxDepth?: number;
  maxDurationMinutes?: number;
  threshold?: number;
}
export interface PipelineStage {
  id: StageId;
  label: string;
  status: 'pending' | 'running' | 'passed' | 'skipped' | 'failed' | 'attention';
  message: string;
}
export interface PipelineMetrics {
  pages: number;
  clusters: number;
  fields: number;
  coverage: number | null;
  pairwiseF1: number | null;
  fieldValueF1: number | null;
}
export interface Project extends ProjectInput {
  maxDepth: number;
  maxDurationMinutes: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  latestRunId: string | null;
  metrics: PipelineMetrics | null;
  progress?: { completed: number; total: number; current: string };
  labeledPages?: number;
  crawlProgress?: PipelineRun['crawlProgress'] | null;
}
export interface PipelineResult {
  metrics: PipelineMetrics;
  clusters: { id: string; name: string; count: number; fields: string[]; urls: string[] }[];
  pages: { url: string; title: string; cluster: string; fields: Record<string, string>; issues: { code: string; count: number; evidence?: string }[]; fetch?: { status: number; bytes: number; encoding: string; sha256: string; contentType?: string; htmlDetected?: boolean }; tagCounts?: Record<string, number>; linkCount?: number; recordCount?: number; excluded?: boolean }[];
  issues: { code: string; count: number }[];
  outcomes: { url: string; state: string; reason?: string; message?: string; redirects?: { from: string; to: string; status: number }[] }[];
  diagnostics?: { robots: { url: string; status: string; code?: string; reason?: string; httpStatus?: number | null; redirects?: { from: string; to: string; status: number }[] }; requestedUrl: string; effectiveUrl: string };
  warnings: string[];
  crawl: { analyzed: number; discovered: number; stopReason: string | null; frontierExhausted: boolean; allEligibleAnalyzed: boolean; counts: Record<string, number> };
  evaluation: { status: 'passed' | 'failed' | 'not_available'; reason: string; thresholds: { coverage: number; pairwiseF1: number; fieldValueF1: number } | null };
  provenance: { profile: string; referenceUrl: string | null; synthetic: boolean; seed: number | null; canonicalSha256: string | null; noiseEvents: number; sourceUrl?: string | null; noise?: NoiseLevel | null };
  rules?: { threshold: number; excludedUrls: string[] };
  labels?: Record<string, string>;
  maxCrawlDepth?: number;
  clusterInsights?: Record<string, ClusterInsight>;
}
export interface ClusterInsight {
  representativeUrl: string;
  cohesion: number;
  fields: { name: string; present: number; total: number; coverage: number; inferredType: string; examples: string[] }[];
  sharedFields: string[];
  variableFields: string[];
  pathPatterns: string[];
  layoutVariants: { signature: string; pages: number }[];
  notes: string[];
}
export interface PipelineRun {
  id: string;
  projectId: string;
  status: 'running' | 'completed' | 'attention' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  stages: PipelineStage[];
  error: string | null;
  result: PipelineResult | null;
  kind?: 'crawl' | 'recluster';
  sourceRunId?: string;
  stopRequested?: boolean;
  crawlProgress?: {
    analyzed: number;
    discovered: number;
    queued: number;
    failed: number;
    skipped: number;
    bytes: number;
    elapsedMs: number;
    currentUrl: string | null;
    maxPages: number;
  };
}
export interface ProjectDetail { project: Project; runs: PipelineRun[] }
export interface ReviewFinding {
  code: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  action: string;
  occurrences: number;
  urls: string[];
  evidence: string[];
}
export interface SiteReview {
  findings: ReviewFinding[];
  analyzedPages: number;
  affectedUrls: number;
  highPriority: number;
  recoveredPages: number;
  scope: string;
  limitations: string[];
}
