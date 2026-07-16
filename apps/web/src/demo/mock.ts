// Static demo backend. When the app is built with VITE_DEMO=1 (the GitHub Pages
// deploy), there is no bullwatch server behind it — so we patch window.fetch to
// answer the same API the real server exposes, from a deterministic in-memory
// dataset. Everything is synthesized in the browser: no network, no Redis.
//
// The dataset is self-consistent — ids referenced by lists, search, failure
// samples and flows all resolve through the same job store, so clicking through
// the UI (drawer, retry, replay, pause) behaves like the live product.

import type {
  AggregateSeries,
  AggregateValue,
  DeployMarker,
  FailureSummary,
  FlowNodeDTO,
  JobDTO,
  MetricKind,
  QueueSummary,
  RuleSnapshot,
  SchedulerDTO,
  SearchResult,
  WorkerDTO,
} from "../api/types.js";

/** True when this bundle was built for the static demo. */
export const IS_DEMO = import.meta.env.VITE_DEMO === "1" || import.meta.env.VITE_DEMO === "true";

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness (stable data across reloads and polls)
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length) % arr.length] as T;

// Must match packages/core/src/storage/histogram.ts and lib/format.ts.
const LAT_BOUNDS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000,
];

/** Build a latency histogram value from `count` lognormal-ish samples. */
function histogram(
  rand: () => number,
  count: number,
  centerMs: number,
  spread: number,
): AggregateValue {
  const buckets = new Array<number>(LAT_BOUNDS.length + 1).fill(0);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = Math.max(1, centerMs * Math.exp((rand() * 2 - 1) * spread));
    sum += v;
    let idx = LAT_BOUNDS.findIndex((b) => v <= b);
    if (idx === -1) idx = LAT_BOUNDS.length;
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return { kind: "histogram", buckets, totalCount: count, sum: Math.round(sum) };
}

const MASKED = "[masked]";
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Queue configuration — the shape of the demo world
// ---------------------------------------------------------------------------

const SIG = {
  econn: "Error: ECONNRESET",
  timeout: "TimeoutError: upstream timed out after <n>ms",
  declined: "Error: 402 payment_required (card_declined)",
  email: "ValidationError: email must be a valid address",
  rate: "Error: 429 rate_limited",
  undef: "TypeError: cannot read properties of undefined (reading 'id')",
  ffmpeg: "Error: ffmpeg exited with code <n>",
  unavail: "Error: 503 service_unavailable",
};

interface QCfg {
  name: string;
  perMin: number;
  failRate: number;
  waitMs: number;
  runMs: number;
  paused: boolean;
  masked: boolean;
  jobNames: string[];
  sigs: Array<[string, number]>;
  counts: Record<string, number>;
  dayFailures: number;
}

const QUEUES: QCfg[] = [
  {
    name: "email",
    perMin: 54,
    failRate: 0.006,
    waitMs: 40,
    runMs: 120,
    paused: false,
    masked: false,
    jobNames: ["welcome", "password-reset", "receipt", "digest"],
    sigs: [
      [SIG.email, 6],
      [SIG.undef, 2],
      [SIG.rate, 1],
    ],
    counts: {
      waiting: 88,
      active: 6,
      completed: 184_203,
      failed: 214,
      delayed: 12,
      prioritized: 3,
    },
    dayFailures: 466,
  },
  {
    name: "payments",
    perMin: 21,
    failRate: 0.031,
    waitMs: 60,
    runMs: 340,
    paused: false,
    masked: true,
    jobNames: ["charge", "refund", "payout"],
    sigs: [
      [SIG.declined, 7],
      [SIG.econn, 2],
      [SIG.rate, 1],
    ],
    counts: { waiting: 34, active: 4, completed: 61_820, failed: 903, delayed: 5, prioritized: 8 },
    dayFailures: 951,
  },
  {
    name: "media-transcode",
    perMin: 7,
    failRate: 0.022,
    waitMs: 1_200,
    runMs: 8_400,
    paused: false,
    masked: false,
    jobNames: ["transcode", "thumbnail", "notify"],
    sigs: [
      [SIG.ffmpeg, 5],
      [SIG.unavail, 2],
    ],
    counts: { waiting: 41, active: 8, completed: 12_774, failed: 156, delayed: 22, prioritized: 0 },
    dayFailures: 168,
  },
  {
    name: "webhooks",
    perMin: 96,
    failRate: 0.048,
    waitMs: 30,
    runMs: 210,
    paused: false,
    masked: false,
    jobNames: ["deliver"],
    sigs: [
      [SIG.timeout, 6],
      [SIG.econn, 3],
      [SIG.unavail, 2],
      [SIG.rate, 1],
    ],
    counts: {
      waiting: 512,
      active: 12,
      completed: 421_669,
      failed: 3_408,
      delayed: 88,
      prioritized: 0,
    },
    dayFailures: 6_642,
  },
  {
    name: "notifications",
    perMin: 33,
    failRate: 0.011,
    waitMs: 25,
    runMs: 90,
    paused: false,
    masked: true,
    jobNames: ["push", "sms"],
    sigs: [
      [SIG.rate, 4],
      [SIG.undef, 2],
      [SIG.econn, 1],
    ],
    counts: { waiting: 61, active: 5, completed: 98_540, failed: 402, delayed: 9, prioritized: 2 },
    dayFailures: 733,
  },
  {
    name: "search-index",
    perMin: 12,
    failRate: 0.004,
    waitMs: 400,
    runMs: 260,
    paused: true,
    masked: false,
    jobNames: ["reindex", "purge"],
    sigs: [
      [SIG.unavail, 3],
      [SIG.econn, 1],
    ],
    counts: {
      waiting: 1_204,
      active: 0,
      completed: 33_910,
      failed: 38,
      delayed: 340,
      prioritized: 0,
    },
    dayFailures: 41,
  },
];

const CFG = new Map(QUEUES.map((q) => [q.name, q]));

// ---------------------------------------------------------------------------
// Job synthesis
// ---------------------------------------------------------------------------

type JobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "prioritized";

const STACKS = [
  "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "    at async Worker.processJob (/app/node_modules/bullmq/dist/cjs/classes/worker.js:512:20)",
  "    at async Worker.retryIfFailed (/app/node_modules/bullmq/dist/cjs/classes/worker.js:702:16)",
];

function rawReason(sig: string, rand: () => number): string {
  if (sig === SIG.timeout)
    return `TimeoutError: upstream timed out after ${20_000 + Math.floor(rand() * 40_000)}ms`;
  if (sig === SIG.ffmpeg) return `Error: ffmpeg exited with code ${pick(rand, [1, 69, 255])}`;
  return sig;
}

function buildData(cfg: QCfg, jobName: string, rand: () => number): unknown {
  const id = 1000 + Math.floor(rand() * 89_000);
  switch (cfg.name) {
    case "email":
      return {
        userId: id,
        email: `user${id}@example.com`,
        template: jobName,
        locale: pick(rand, ["en-US", "de-DE", "ja-JP", "pt-BR"]),
        campaignId: `cmp_${(id * 7) % 9999}`,
      };
    case "payments":
      return {
        orderId: `ord_${id}`,
        customerId: `cus_${(id * 3) % 99_999}`,
        amount: Math.floor(rand() * 48_000) / 100 + 1,
        currency: "usd",
        card: {
          number: cfg.masked ? MASKED : "4242 4242 4242 4242",
          cvv: cfg.masked ? MASKED : "123",
          brand: pick(rand, ["visa", "mastercard", "amex"]),
          expMonth: 1 + Math.floor(rand() * 12),
          expYear: 2027 + Math.floor(rand() * 4),
        },
        idempotencyKey: `idem_${id}${jobName}`,
      };
    case "media-transcode":
      return {
        assetId: `asset_${id}`,
        input: { bucket: "uploads", key: `raw/${id}/source.mov`, sizeBytes: 10_000_000 + id * 137 },
        target: { formats: ["1080p", "720p", "480p"], codec: "h264", container: "mp4" },
      };
    case "webhooks":
      return {
        endpoint: `https://hooks.customer-${(id % 40) + 1}.example.com/bullwatch`,
        event: pick(rand, ["order.created", "order.paid", "user.updated", "invoice.finalized"]),
        deliveryId: `dlv_${id}`,
        attempt: 1 + Math.floor(rand() * 3),
        payload: { id: `evt_${id}`, type: "order", version: 2 },
      };
    case "notifications":
      return {
        userId: id,
        channel: jobName,
        title: pick(rand, ["Your order shipped", "New login", "Weekly summary", "Price drop"]),
        deviceToken: cfg.masked ? MASKED : `tok_${id}`,
      };
    default:
      return {
        docId: `doc_${id}`,
        op: jobName,
        index: "products",
        version: 1 + Math.floor(rand() * 40),
      };
  }
}

function buildReturn(cfg: QCfg, runMs: number, rand: () => number): unknown {
  switch (cfg.name) {
    case "email":
      return {
        ok: true,
        messageId: `msg_${Math.floor(rand() * 1e9).toString(36)}`,
        provider: "ses",
      };
    case "payments":
      return {
        ok: true,
        status: "succeeded",
        chargeId: `ch_${Math.floor(rand() * 1e9).toString(36)}`,
      };
    case "media-transcode":
      return { ok: true, outputs: 3, durationMs: runMs, bitrateKbps: 4200 };
    case "webhooks":
      return { ok: true, statusCode: 200, latencyMs: Math.round(runMs) };
    default:
      return { ok: true };
  }
}

let idSeq = 900_000;

function makeJob(cfg: QCfg, state: JobState, rand: () => number): JobDTO {
  const id = String(idSeq--);
  const jobName = pick(rand, cfg.jobNames);
  const now = Date.now();
  const data = buildData(cfg, jobName, rand);

  const waitMs = Math.round(cfg.waitMs * (0.4 + rand() * 1.6));
  const runMs = Math.round(cfg.runMs * (0.4 + rand() * 1.8));

  const base: JobDTO = {
    id,
    name: jobName,
    queue: cfg.name,
    attemptsMade: 0,
    timestamp: now - Math.floor(rand() * 6 * HOUR),
    processedOn: null,
    finishedOn: null,
    timings: { waitMs: null, runMs: null, totalMs: null },
    data,
    opts: { attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 1_000 },
    returnvalue: null,
    failedReason: null,
    stacktrace: [],
    progress: 0,
    errorSignature: null,
    parentKey: null,
    dataOmitted: false,
  };

  if (state === "waiting" || state === "prioritized") return base;

  if (state === "delayed") {
    return { ...base, opts: { ...(base.opts as object), delay: 30_000 }, progress: 0 };
  }

  if (state === "active") {
    const processedOn = now - Math.floor(rand() * 30_000);
    return {
      ...base,
      attemptsMade: 1,
      processedOn,
      timestamp: processedOn - waitMs,
      timings: { waitMs, runMs: null, totalMs: null },
      progress: Math.floor(rand() * 90),
    };
  }

  if (state === "completed") {
    const finishedOn = now - Math.floor(rand() * 2 * HOUR);
    const processedOn = finishedOn - runMs;
    return {
      ...base,
      attemptsMade: 1,
      processedOn,
      finishedOn,
      timestamp: processedOn - waitMs,
      timings: { waitMs, runMs, totalMs: waitMs + runMs },
      returnvalue: buildReturn(cfg, runMs, rand),
      progress: 100,
    };
  }

  // failed
  const sig = weightedSig(cfg, rand);
  const finishedOn = now - Math.floor(rand() * 20 * HOUR);
  const processedOn = finishedOn - runMs;
  return {
    ...base,
    attemptsMade: 1 + Math.floor(rand() * 3),
    processedOn,
    finishedOn,
    timestamp: processedOn - waitMs,
    timings: { waitMs, runMs, totalMs: waitMs + runMs },
    failedReason: rawReason(sig, rand),
    stacktrace: [rawReason(sig, rand), ...STACKS],
    errorSignature: sig,
  };
}

function weightedSig(cfg: QCfg, rand: () => number): string {
  const total = cfg.sigs.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [s, w] of cfg.sigs) {
    r -= w;
    if (r <= 0) return s;
  }
  return cfg.sigs[0]?.[0] ?? SIG.econn;
}

// ---------------------------------------------------------------------------
// Mutable world state (sample job pools + live counts)
// ---------------------------------------------------------------------------

interface QState {
  cfg: QCfg;
  paused: boolean;
  counts: Record<string, number>;
  samples: Record<JobState, JobDTO[]>;
  byId: Map<string, JobDTO>;
}

const SAMPLE_LIMIT: Record<JobState, number> = {
  waiting: 30,
  active: 8,
  completed: 40,
  failed: 40,
  delayed: 15,
  prioritized: 6,
};

function buildQueueState(cfg: QCfg): QState {
  const rand = mulberry32(hashStr(cfg.name));
  const samples = {} as Record<JobState, JobDTO[]>;
  const byId = new Map<string, JobDTO>();
  for (const state of Object.keys(SAMPLE_LIMIT) as JobState[]) {
    const want = Math.min(SAMPLE_LIMIT[state], cfg.counts[state] ?? 0);
    const list: JobDTO[] = [];
    for (let i = 0; i < want; i++) {
      const job = makeJob(cfg, state, rand);
      list.push(job);
      if (job.id) byId.set(job.id, job);
    }
    samples[state] = list;
  }
  return { cfg, paused: cfg.paused, counts: { ...cfg.counts }, samples, byId };
}

const WORLD = new Map(QUEUES.map((q) => [q.name, buildQueueState(q)]));

// ---------------------------------------------------------------------------
// Workers, alerts, deploys, schedulers
// ---------------------------------------------------------------------------

const WORKERS: Array<WorkerDTO & { queues: string[] }> = [
  {
    id: "w1",
    addr: "10.0.4.12:52233",
    name: "worker-1",
    ageSeconds: 4 * 3600 + 210,
    idleSeconds: 1,
    queues: ["email", "notifications"],
  },
  {
    id: "w2",
    addr: "10.0.4.13:52244",
    name: "worker-2",
    ageSeconds: 9 * 3600 + 40,
    idleSeconds: 0.4,
    queues: ["payments"],
  },
  {
    id: "w3",
    addr: "10.0.7.21:41090",
    name: "worker-3",
    ageSeconds: 26 * 3600,
    idleSeconds: 11,
    queues: ["webhooks", "email"],
  },
  {
    id: "w4",
    addr: "10.0.7.22:41102",
    name: "worker-4",
    ageSeconds: 42 * 60,
    idleSeconds: 2,
    queues: ["media-transcode"],
  },
  {
    id: "w5",
    addr: "10.0.9.5:38801",
    name: "worker-5",
    ageSeconds: 52 * 3600,
    idleSeconds: 38,
    queues: ["webhooks"],
  },
  {
    id: "w6",
    addr: "10.0.9.6:38820",
    name: "worker-6",
    ageSeconds: 3 * 3600,
    idleSeconds: 0.8,
    queues: ["notifications", "search-index"],
  },
];

const ALERTS: RuleSnapshot[] = [
  {
    ruleId: "payments-failrate",
    type: "failure_rate",
    queue: "payments",
    status: "firing",
    lastValue: 0.031,
    firstBreachAt: Date.now() - 22 * MINUTE,
  },
  {
    ruleId: "webhooks-depth",
    type: "queue_depth",
    queue: "webhooks",
    status: "firing",
    lastValue: 512,
    firstBreachAt: Date.now() - 8 * MINUTE,
  },
  {
    ruleId: "email-latency",
    type: "latency",
    queue: "email",
    status: "ok",
    lastValue: 210,
    firstBreachAt: null,
  },
  {
    ruleId: "media-latency",
    type: "latency",
    queue: "media-transcode",
    status: "ok",
    lastValue: 9_100,
    firstBreachAt: null,
  },
  {
    ruleId: "webhooks-failrate",
    type: "failure_rate",
    queue: "webhooks",
    status: "firing",
    lastValue: 0.048,
    firstBreachAt: Date.now() - 3 * MINUTE,
  },
];

const DEPLOYS: DeployMarker[] = [
  {
    id: "d1",
    ts: Date.now() - 28 * MINUTE,
    label: "deploy v2.5.0-rc.1",
    version: "v2.5.0-rc.1",
    sha: "9f3a1c2",
    queue: null,
    metadata: { env: "prod", actor: "ci" },
  },
  {
    id: "d2",
    ts: Date.now() - 5 * HOUR,
    label: "deploy v2.4.1",
    version: "v2.4.1",
    sha: "1b7e044",
    queue: null,
    metadata: { env: "prod" },
  },
  {
    id: "d3",
    ts: Date.now() - 27 * HOUR,
    label: "payments hotfix",
    version: "v2.4.1-hotfix",
    sha: "aa20f9d",
    queue: "payments",
    metadata: { env: "prod" },
  },
  {
    id: "d4",
    ts: Date.now() - 3 * DAY,
    label: "deploy v2.4.0",
    version: "v2.4.0",
    sha: "5c0b3e8",
    queue: null,
    metadata: { env: "prod" },
  },
  {
    id: "d5",
    ts: Date.now() - 6 * DAY,
    label: "deploy v2.3.7",
    version: "v2.3.7",
    sha: "77d1aa1",
    queue: null,
    metadata: { env: "prod" },
  },
];

const SCHEDULERS: Record<string, SchedulerDTO[]> = {
  email: [
    {
      key: "digest-daily",
      name: "digest",
      pattern: "0 8 * * *",
      every: null,
      next: Date.now() + 6 * HOUR,
      tz: "UTC",
    },
  ],
  "search-index": [
    {
      key: "reindex-nightly",
      name: "reindex",
      pattern: "0 2 * * *",
      every: null,
      next: Date.now() + 11 * HOUR,
      tz: "UTC",
    },
    {
      key: "purge-15m",
      name: "purge",
      pattern: null,
      every: 900_000,
      next: Date.now() + 4 * MINUTE,
      tz: null,
    },
  ],
  payments: [
    {
      key: "payout-hourly",
      name: "payout",
      pattern: null,
      every: HOUR,
      next: Date.now() + 18 * MINUTE,
      tz: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Query handlers
// ---------------------------------------------------------------------------

function summary(qs: QState): QueueSummary {
  const total = Object.values(qs.counts).reduce((a, b) => a + b, 0);
  return { name: qs.cfg.name, counts: { ...qs.counts }, paused: qs.paused, total };
}

function getJob(name: string, id: string): JobDTO {
  const qs = WORLD.get(name);
  const existing = qs?.byId.get(id);
  if (existing) return existing;
  // Synthesize a stable job for any id (e.g. ids typed into Flows, or replayed
  // ids) so the drawer never dead-ends.
  const cfg = CFG.get(name) ?? QUEUES[0];
  if (!cfg) throw new Error("no queues");
  const rand = mulberry32(hashStr(`${name}:${id}`));
  const state = pick(rand, ["completed", "failed", "active"] as const);
  const job = makeJob(cfg, state, rand);
  return { ...job, id };
}

function listJobs(name: string, state: string, start: number, end: number, includeData: boolean) {
  const qs = WORLD.get(name);
  const pool = qs?.samples[state as JobState] ?? [];
  const slice = pool
    .slice(start, end + 1)
    .map((j) => (includeData ? j : { ...j, data: null, dataOmitted: true }));
  return { jobs: slice, state, start, end };
}

function deriveState(j: JobDTO): JobState {
  if (j.failedReason) return "failed";
  if (j.finishedOn) return "completed";
  if (j.processedOn) return "active";
  return "waiting";
}

function search(name: string, query: string, limit: number): SearchResult {
  const qs = WORLD.get(name);
  if (!qs) return { jobs: [], scanned: 0, truncated: false };
  const pool = [
    ...qs.samples.failed,
    ...qs.samples.completed,
    ...qs.samples.active,
    ...qs.samples.waiting,
    ...qs.samples.delayed,
  ];
  const raw = query.trim().toLowerCase();
  const kv = raw.match(/^([\w.]+):(.+)$/);
  const field = kv?.[1];
  const term = (kv?.[2] ?? raw).trim();

  const matches = pool.filter((j) => {
    if (!raw) return true;
    if (field === "status" || field === "state") return deriveState(j) === term;
    if (field === "name") return j.name.toLowerCase().includes(term);
    const hay = `${j.name} ${JSON.stringify(j.data)}`.toLowerCase();
    return hay.includes(term);
  });

  const scanned = Math.min(2_000, 280 + pool.length * 6);
  return { jobs: matches.slice(0, limit), scanned, truncated: matches.length > limit };
}

function metrics(
  name: string,
  metric: MetricKind,
  from: number,
  to: number,
  jobName?: string,
): AggregateSeries[] {
  const cfg = CFG.get(name);
  if (!cfg || to <= from) return [];
  const rand = mulberry32(hashStr(`${name}:${metric}`));
  const points: AggregateSeries["points"] = [];
  const n = 80;
  const step = (to - from) / n;
  for (let i = 0; i <= n; i++) {
    const ts = Math.round(from + i * step);
    const diurnal = 0.55 + 0.45 * Math.sin(ts / (4 * HOUR)) * Math.cos(ts / (11 * HOUR));
    const perBucket = cfg.perMin * (step / MINUTE) * Math.max(0.15, diurnal) * (0.7 + rand() * 0.6);
    if (metric === "completed" || metric === "added") {
      points.push({ ts, value: { kind: "counter", count: Math.max(0, Math.round(perBucket)) } });
    } else if (metric === "failed") {
      points.push({
        ts,
        value: {
          kind: "counter",
          count: Math.max(0, Math.round(perBucket * cfg.failRate * (2 + rand() * 4))),
        },
      });
    } else {
      const center = metric === "wait_ms" ? cfg.waitMs : cfg.runMs;
      const samples = Math.min(48, Math.max(1, Math.round(perBucket * 0.5)));
      points.push({ ts, value: histogram(rand, samples, center, 0.7) });
    }
  }
  return [{ queue: name, jobName: jobName ?? null, errorSignature: null, metric, points }];
}

function failures(
  name: string,
  from: number,
  to: number,
  topN: number,
  trendBuckets: number,
  samples: boolean,
): FailureSummary {
  const qs = WORLD.get(name);
  const cfg = CFG.get(name);
  const bucketCount = Math.max(1, trendBuckets);
  const bucketMs = Math.max(1, Math.round((to - from) / bucketCount));
  if (!qs || !cfg) {
    return {
      window: { from, to, bucketMs, bucketCount },
      totalFailures: 0,
      classifiedFailures: 0,
      signatures: [],
      truncatedSignatures: false,
    };
  }
  const total = cfg.dayFailures;
  const sigTotal = cfg.sigs.reduce((a, [, w]) => a + w, 0);
  const rand = mulberry32(hashStr(`${name}:fail`));

  const failedSamples = qs.samples.failed;
  const signatures = cfg.sigs
    .map(([sig, w], si) => {
      const count = Math.round((w / sigTotal) * total);
      // Trend across buckets with a rising/falling bias per signature.
      const bias = ((si % 3) - 1) * 0.6; // -0.6, 0, +0.6
      const trend: number[] = [];
      let remaining = count;
      for (let b = 0; b < bucketCount; b++) {
        const shape = Math.max(0.05, 1 + bias * (b / bucketCount - 0.5) * 4 + (rand() - 0.5) * 0.6);
        trend.push(shape);
      }
      const shapeSum = trend.reduce((a, v) => a + v, 0);
      const scaled = trend.map((v, b) => {
        if (b === bucketCount - 1) return remaining;
        const c = Math.round((v / shapeSum) * count);
        remaining -= c;
        return Math.max(0, c);
      });
      const firstHalf = scaled.slice(0, Math.floor(bucketCount / 2)).reduce((a, v) => a + v, 0);
      const secondHalf = scaled.slice(Math.floor(bucketCount / 2)).reduce((a, v) => a + v, 0);
      const sampleJobIds = samples
        ? failedSamples
            .filter((j) => j.errorSignature === sig)
            .slice(0, 6)
            .map((j) => j.id)
            .filter((x): x is string => x !== null)
        : undefined;
      return {
        errorSignature: sig,
        count,
        share: total > 0 ? count / total : 0,
        trend: scaled,
        delta: secondHalf - firstHalf,
        ...(sampleJobIds && sampleJobIds.length > 0 ? { sampleJobIds } : {}),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  const classified = signatures.reduce((a, s) => a + s.count, 0);
  return {
    window: { from, to, bucketMs, bucketCount },
    totalFailures: total,
    classifiedFailures: classified,
    signatures,
    truncatedSignatures: cfg.sigs.length > topN,
    ...(samples ? { samplesScanned: 400 + failedSamples.length, samplesTruncated: false } : {}),
  };
}

function workers(name: string): WorkerDTO[] {
  return WORKERS.filter((w) => w.queues.includes(name)).map(({ queues, ...w }) => w);
}

function flow(name: string, id: string): FlowNodeDTO {
  const parent = getJob(name, id);
  const cfg = CFG.get(name) ?? QUEUES[0];
  if (!cfg) throw new Error("no queues");
  const rand = mulberry32(hashStr(`${name}:${id}:flow`));
  const parentKey = `bull:${name}:${id}`;
  const childNames =
    name === "media-transcode" ? ["thumbnail", "notify"] : cfg.jobNames.slice(0, 2);

  const child = (suffix: string, jobName: string, grand = false): FlowNodeDTO => {
    const cid = `${id}${suffix}`;
    const base = { ...makeJob(cfg, "completed", rand), id: cid, name: jobName, parentKey };
    const children: FlowNodeDTO[] = grand
      ? [
          {
            job: {
              ...makeJob(cfg, "completed", rand),
              id: `${cid}a`,
              name: "finalize",
              parentKey: `bull:${name}:${cid}`,
            },
            children: [],
          },
        ]
      : [];
    return { job: base, children };
  };

  return {
    job: parent,
    children: [
      child("-1", childNames[0] ?? "child-a", true),
      child("-2", childNames[1] ?? "child-b"),
    ],
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function removeFromState(qs: QState, id: string): JobState | null {
  for (const state of Object.keys(qs.samples) as JobState[]) {
    const idx = qs.samples[state].findIndex((j) => j.id === id);
    if (idx >= 0) {
      qs.samples[state].splice(idx, 1);
      qs.counts[state] = Math.max(0, (qs.counts[state] ?? 1) - 1);
      return state;
    }
  }
  return null;
}

function retryJob(name: string, id: string) {
  const qs = WORLD.get(name);
  if (!qs) return { ok: false };
  const job = qs.byId.get(id);
  removeFromState(qs, id);
  qs.byId.delete(id);
  if (job) {
    const revived: JobDTO = {
      ...job,
      failedReason: null,
      stacktrace: [],
      errorSignature: null,
      finishedOn: null,
      processedOn: null,
      timings: { waitMs: null, runMs: null, totalMs: null },
      attemptsMade: job.attemptsMade,
    };
    qs.samples.waiting.unshift(revived);
    qs.counts.waiting = (qs.counts.waiting ?? 0) + 1;
    qs.byId.set(id, revived);
  }
  return { ok: true };
}

function removeJob(name: string, id: string) {
  const qs = WORLD.get(name);
  if (qs) {
    removeFromState(qs, id);
    qs.byId.delete(id);
  }
  return { ok: true };
}

function promoteJob(name: string, id: string) {
  const qs = WORLD.get(name);
  if (!qs) return { ok: false };
  const idx = qs.samples.delayed.findIndex((j) => j.id === id);
  if (idx >= 0) {
    const [job] = qs.samples.delayed.splice(idx, 1);
    qs.counts.delayed = Math.max(0, (qs.counts.delayed ?? 1) - 1);
    if (job) {
      qs.samples.waiting.unshift(job);
      qs.counts.waiting = (qs.counts.waiting ?? 0) + 1;
    }
  }
  return { ok: true };
}

function replayJob(name: string, id: string, data: unknown) {
  const qs = WORLD.get(name);
  const cfg = CFG.get(name);
  if (!qs || !cfg) return { ok: false, newJobId: null };
  const newId = String(idSeq--);
  const rand = mulberry32(hashStr(`${name}:${id}:replay`));
  const fresh: JobDTO = { ...makeJob(cfg, "waiting", rand), id: newId, data, parentKey: null };
  qs.samples.waiting.unshift(fresh);
  qs.counts.waiting = (qs.counts.waiting ?? 0) + 1;
  qs.byId.set(newId, fresh);
  return { ok: true, newJobId: newId };
}

function setPaused(name: string, paused: boolean) {
  const qs = WORLD.get(name);
  if (qs) qs.paused = paused;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fetch interceptor
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

interface Route {
  method: string;
  re: RegExp;
  handler: (m: RegExpMatchArray, url: URL, body: unknown) => Response;
}

const dec = decodeURIComponent;
const num = (v: string | null, d: number): number => {
  const n = v === null ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

const ROUTES: Route[] = [
  {
    method: "GET",
    re: /^\/api\/health$/,
    handler: () => json({ status: "ok", readOnly: false, metricsStore: "memory (demo)" }),
  },
  {
    method: "GET",
    re: /^\/api\/queues$/,
    handler: () => json({ queues: [...WORLD.values()].map(summary) }),
  },
  { method: "GET", re: /^\/api\/alerts$/, handler: () => json({ alerts: ALERTS }) },
  {
    method: "GET",
    re: /^\/api\/deploys$/,
    handler: (_m, url) => {
      const from = num(url.searchParams.get("from"), 0);
      const to = num(url.searchParams.get("to"), Date.now());
      const queue = url.searchParams.get("queue");
      const markers = DEPLOYS.filter(
        (d) => d.ts >= from && d.ts <= to && (!queue || d.queue === null || d.queue === queue),
      );
      return json({ markers });
    },
  },
  // Specific job sub-routes before the generic :id route.
  {
    method: "POST",
    re: /^\/api\/queues\/([^/]+)\/jobs\/([^/]+)\/retry$/,
    handler: (m) => json(retryJob(dec(m[1] as string), dec(m[2] as string))),
  },
  {
    method: "POST",
    re: /^\/api\/queues\/([^/]+)\/jobs\/([^/]+)\/promote$/,
    handler: (m) => json(promoteJob(dec(m[1] as string), dec(m[2] as string))),
  },
  {
    method: "POST",
    re: /^\/api\/queues\/([^/]+)\/jobs\/([^/]+)\/replay$/,
    handler: (m, _u, body) =>
      json(replayJob(dec(m[1] as string), dec(m[2] as string), (body as { data?: unknown })?.data)),
  },
  {
    method: "DELETE",
    re: /^\/api\/queues\/([^/]+)\/jobs\/([^/]+)$/,
    handler: (m) => json(removeJob(dec(m[1] as string), dec(m[2] as string))),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/jobs\/([^/]+)$/,
    handler: (m) => json(getJob(dec(m[1] as string), dec(m[2] as string))),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/jobs$/,
    handler: (m, url) =>
      json(
        listJobs(
          dec(m[1] as string),
          url.searchParams.get("state") ?? "waiting",
          num(url.searchParams.get("start"), 0),
          num(url.searchParams.get("end"), 49),
          url.searchParams.get("includeData") !== "false",
        ),
      ),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/schedulers$/,
    handler: (m) => json({ schedulers: SCHEDULERS[dec(m[1] as string)] ?? [] }),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/search$/,
    handler: (m, url) =>
      json(
        search(
          dec(m[1] as string),
          url.searchParams.get("q") ?? "",
          num(url.searchParams.get("limit"), 100),
        ),
      ),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/metrics$/,
    handler: (m, url) => {
      const now = Date.now();
      return json({
        series: metrics(
          dec(m[1] as string),
          (url.searchParams.get("metric") ?? "completed") as MetricKind,
          num(url.searchParams.get("from"), now - HOUR),
          num(url.searchParams.get("to"), now),
          url.searchParams.get("jobName") ?? undefined,
        ),
      });
    },
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/failures$/,
    handler: (m, url) => {
      const now = Date.now();
      return json(
        failures(
          dec(m[1] as string),
          num(url.searchParams.get("from"), now - DAY),
          num(url.searchParams.get("to"), now),
          num(url.searchParams.get("topN"), 20),
          num(url.searchParams.get("trendBuckets"), 24),
          url.searchParams.get("samples") === "true",
        ),
      );
    },
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/workers$/,
    handler: (m) => json({ workers: workers(dec(m[1] as string)) }),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)\/flows\/([^/]+)$/,
    handler: (m) => json(flow(dec(m[1] as string), dec(m[2] as string))),
  },
  {
    method: "POST",
    re: /^\/api\/queues\/([^/]+)\/pause$/,
    handler: (m) => json(setPaused(dec(m[1] as string), true)),
  },
  {
    method: "POST",
    re: /^\/api\/queues\/([^/]+)\/resume$/,
    handler: (m) => json(setPaused(dec(m[1] as string), false)),
  },
  {
    method: "GET",
    re: /^\/api\/queues\/([^/]+)$/,
    handler: (m) => {
      const qs = WORLD.get(dec(m[1] as string));
      return qs ? json(summary(qs)) : json({ error: "queue not found" }, 404);
    },
  },
];

/** Replace window.fetch with the demo router. Idempotent. */
export function installMockFetch(): void {
  const w = window as typeof window & { __bwMockInstalled?: boolean };
  if (w.__bwMockInstalled) return;
  w.__bwMockInstalled = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    let url: URL;
    try {
      url = new URL(rawUrl, window.location.href);
    } catch {
      return original(input, init);
    }

    const apiIdx = url.pathname.indexOf("/api/");
    const isPrometheus = apiIdx === -1 && url.pathname.endsWith("/metrics");
    if (apiIdx === -1 && !isPrometheus) return original(input, init);

    const route = isPrometheus ? "/metrics" : url.pathname.slice(apiIdx);

    if (isPrometheus) {
      await delay(60, init?.signal);
      return new Response("# bullwatch demo — metrics collected in-memory\n", {
        status: 200,
        headers: { "content-type": "text/plain; version=0.0.4" },
      });
    }

    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }

    for (const r of ROUTES) {
      if (r.method !== method) continue;
      const m = route.match(r.re);
      if (!m) continue;
      await delay(90 + Math.floor(mulberry32(hashStr(route + method))() * 160), init?.signal);
      try {
        return r.handler(m, url, body);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "demo error" }, 500);
      }
    }

    return json({ error: `no demo route for ${method} ${route}` }, 404);
  };
}
