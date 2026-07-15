// Response shapes mirroring @bullwatch/core DTOs. Defined locally so the browser
// bundle never imports the node-only core package.

export interface QueueSummary {
  name: string;
  counts: Record<string, number>;
  paused: boolean;
  total: number;
}

export interface JobTimings {
  waitMs: number | null;
  runMs: number | null;
  totalMs: number | null;
}

export interface JobDTO {
  id: string | null;
  name: string;
  queue: string;
  attemptsMade: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  timings: JobTimings;
  data: unknown;
  opts: unknown;
  returnvalue: unknown;
  failedReason: string | null;
  stacktrace: string[];
  progress: number | string | boolean | object | null;
  errorSignature: string | null;
  parentKey: string | null;
  dataOmitted: boolean;
}

export type AggregateValue =
  | { kind: "counter"; count: number }
  | { kind: "histogram"; buckets: number[]; totalCount: number; sum: number };

export interface AggregateSeries {
  queue: string;
  jobName: string | null;
  errorSignature: string | null;
  metric: string;
  points: Array<{ ts: number; value: AggregateValue }>;
}

export interface FlowNodeDTO {
  job: JobDTO;
  children: FlowNodeDTO[];
}

export interface SearchResult {
  jobs: JobDTO[];
  scanned: number;
  truncated: boolean;
}

export interface FailureSignatureSummary {
  errorSignature: string;
  count: number;
  share: number;
  trend: number[];
  delta: number;
  sampleJobIds?: string[];
}

export interface FailureSummary {
  window: { from: number; to: number; bucketMs: number; bucketCount: number };
  totalFailures: number;
  classifiedFailures: number;
  signatures: FailureSignatureSummary[];
  truncatedSignatures: boolean;
  samplesScanned?: number;
  samplesTruncated?: boolean;
}

export interface WorkerDTO {
  id: string | null;
  addr: string | null;
  name: string | null;
  ageSeconds: number | null;
  idleSeconds: number | null;
}

export interface SchedulerDTO {
  key: string;
  name: string | null;
  pattern: string | null;
  every: number | null;
  next: number | null;
  tz: string | null;
}

export interface RuleSnapshot {
  ruleId: string;
  type: "failure_rate" | "queue_depth" | "latency";
  queue: string;
  status: "ok" | "firing";
  lastValue: number;
  firstBreachAt: number | null;
}

export interface DeployMarker {
  id: string;
  ts: number;
  label: string;
  version: string | null;
  sha: string | null;
  queue: string | null;
  metadata: Record<string, string> | null;
}

export type MetricKind = "completed" | "failed" | "added" | "wait_ms" | "run_ms";
