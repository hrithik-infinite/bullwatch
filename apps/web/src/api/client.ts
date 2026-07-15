import type {
  AggregateSeries,
  DeployMarker,
  FailureSummary,
  JobDTO,
  MetricKind,
  QueueSummary,
  RuleSnapshot,
  SchedulerDTO,
  SearchResult,
  WorkerDTO,
} from "./types.js";

// The dashboard is served by the bullwatch server, so the API is same-origin.
// `base` is derived from the document so a mount under a sub-path still works.
const base = (() => {
  const path = window.location.pathname.replace(/\/[^/]*$/, "");
  return path === "/" ? "" : path;
})();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base}${path}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `${method} ${path} → ${res.status}`);
  return json;
}

const q = (params: Record<string, string | number | boolean | undefined>): string => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  health: (signal?: AbortSignal) =>
    get<{ status: string; readOnly: boolean; metricsStore: string }>("/api/health", signal),

  queues: (signal?: AbortSignal) => get<{ queues: QueueSummary[] }>("/api/queues", signal),

  queue: (name: string, signal?: AbortSignal) =>
    get<QueueSummary>(`/api/queues/${encodeURIComponent(name)}`, signal),

  jobs: (
    name: string,
    opts: { state: string; start?: number; end?: number; includeData?: boolean },
    signal?: AbortSignal,
  ) =>
    get<{ jobs: JobDTO[]; state: string; start: number; end: number }>(
      `/api/queues/${encodeURIComponent(name)}/jobs${q(opts)}`,
      signal,
    ),

  job: (name: string, id: string, signal?: AbortSignal) =>
    get<JobDTO | { error: string }>(
      `/api/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}`,
      signal,
    ),

  schedulers: (name: string, signal?: AbortSignal) =>
    get<{ schedulers: SchedulerDTO[] }>(
      `/api/queues/${encodeURIComponent(name)}/schedulers`,
      signal,
    ),

  search: (
    name: string,
    opts: { q: string; states?: string; limit?: number },
    signal?: AbortSignal,
  ) => get<SearchResult>(`/api/queues/${encodeURIComponent(name)}/search${q(opts)}`, signal),

  metrics: (
    name: string,
    opts: { metric: MetricKind; jobName?: string; from?: number; to?: number },
    signal?: AbortSignal,
  ) =>
    get<{ series: AggregateSeries[] }>(
      `/api/queues/${encodeURIComponent(name)}/metrics${q(opts)}`,
      signal,
    ),

  failures: (
    name: string,
    opts: { from?: number; to?: number; topN?: number; trendBuckets?: number; samples?: boolean },
    signal?: AbortSignal,
  ) => get<FailureSummary>(`/api/queues/${encodeURIComponent(name)}/failures${q(opts)}`, signal),

  workers: (name: string, signal?: AbortSignal) =>
    get<{ workers: WorkerDTO[] }>(`/api/queues/${encodeURIComponent(name)}/workers`, signal),

  alerts: (signal?: AbortSignal) => get<{ alerts: RuleSnapshot[] }>("/api/alerts", signal),

  deploys: (opts: { from?: number; to?: number; queue?: string }, signal?: AbortSignal) =>
    get<{ markers: DeployMarker[] }>(`/api/deploys${q(opts)}`, signal),

  // Mutations
  retry: (name: string, id: string) =>
    send("POST", `/api/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}/retry`),
  promote: (name: string, id: string) =>
    send("POST", `/api/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}/promote`),
  remove: (name: string, id: string) =>
    send("DELETE", `/api/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}`),
  replay: (name: string, id: string, data: unknown, removeOriginal = false) =>
    send<{ ok: boolean; newJobId: string | null }>(
      "POST",
      `/api/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}/replay`,
      { data, removeOriginal },
    ),
  pause: (name: string) => send("POST", `/api/queues/${encodeURIComponent(name)}/pause`),
  resume: (name: string) => send("POST", `/api/queues/${encodeURIComponent(name)}/resume`),
};
