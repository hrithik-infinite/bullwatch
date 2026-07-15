import type { JobType, JobsOptions, Queue } from "bullmq";

/** Thrown when a mutating action is attempted while the dashboard is read-only. */
export class ReadOnlyError extends Error {
  constructor(action: string) {
    super(`action "${action}" is not allowed in read-only mode`);
    this.name = "ReadOnlyError";
  }
}

/** Thrown when an action targets a job id that does not exist. */
export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`job "${id}" not found`);
    this.name = "JobNotFoundError";
  }
}

/** Thrown when replay targets a job that is not in a replayable state. */
export class JobNotReplayableError extends Error {
  constructor(id: string, state: string) {
    super(`job "${id}" is "${state}"; only failed jobs can be replayed`);
    this.name = "JobNotReplayableError";
  }
}

export interface ActionContext {
  readonly readOnly: boolean;
}

function assertWritable(ctx: ActionContext, action: string): void {
  if (ctx.readOnly) throw new ReadOnlyError(action);
}

async function requireJob(queue: Queue, id: string) {
  const job = await queue.getJob(id);
  if (!job) throw new JobNotFoundError(id);
  return job;
}

/** Move a failed job back to waiting (or a completed job, if allowed by opts). */
export async function retryJob(queue: Queue, id: string, ctx: ActionContext): Promise<void> {
  assertWritable(ctx, "retry");
  const job = await requireJob(queue, id);
  await job.retry();
}

export interface ReplayOptions {
  /** The overridden payload for the new job. May be any JSON value, incl. null. */
  readonly data: unknown;
  /** Remove the original failed job after enqueuing the replay. Default false. */
  readonly removeOriginal?: boolean;
}

export interface ReplayResult {
  readonly originalId: string;
  readonly newJobId: string | null;
  readonly removedOriginal: boolean;
}

// Execution-shape opts we carry from the failed job onto the replay. We
// deliberately DROP identity/scheduling/linkage opts (jobId, delay, repeat,
// parent, deduplication/debounce, telemetry): carrying jobId would collide,
// a dedup key could silently swallow the replay, and repeat/parent would spawn
// a scheduler or re-link a flow child — none of which "re-run this once" means.
const REPLAY_CARRY_KEYS = [
  "attempts",
  "backoff",
  "priority",
  "lifo",
  "removeOnComplete",
  "removeOnFail",
  "sizeLimit",
  "keepLogs",
  "stackTraceLimit",
] as const satisfies ReadonlyArray<keyof JobsOptions>;

function carryOverOpts(opts: JobsOptions): JobsOptions {
  const out: Record<string, unknown> = {};
  for (const key of REPLAY_CARRY_KEYS) {
    if (opts[key] !== undefined) out[key] = opts[key];
  }
  return out as JobsOptions;
}

/**
 * Replay a failed job with an overridden payload. Adds a NEW job (new id) on
 * the same queue/name rather than editing the failed job in place, so the
 * original failure — data, reason, stacktrace — survives for audit; the replay
 * is modeled honestly as a distinct execution. Only failed jobs are replayable.
 * The override payload goes straight to queue.add and is never persisted by
 * bullwatch.
 */
export async function replayJob(
  queue: Queue,
  id: string,
  replay: ReplayOptions,
  ctx: ActionContext,
): Promise<ReplayResult> {
  assertWritable(ctx, "replay");
  const job = await requireJob(queue, id);
  const state = await job.getState();
  if (state !== "failed") throw new JobNotReplayableError(id, state);
  const opts = carryOverOpts((job.opts ?? {}) as JobsOptions);
  const newJob = await queue.add(job.name, replay.data, opts);
  let removedOriginal = false;
  if (replay.removeOriginal) {
    await job.remove();
    removedOriginal = true;
  }
  return { originalId: id, newJobId: newJob.id ?? null, removedOriginal };
}

/** Promote a delayed job to run immediately. */
export async function promoteJob(queue: Queue, id: string, ctx: ActionContext): Promise<void> {
  assertWritable(ctx, "promote");
  const job = await requireJob(queue, id);
  await job.promote();
}

/** Remove a job entirely. */
export async function removeJob(queue: Queue, id: string, ctx: ActionContext): Promise<void> {
  assertWritable(ctx, "remove");
  const job = await requireJob(queue, id);
  await job.remove();
}

/** Pause a queue (workers stop picking up new jobs). */
export async function pauseQueue(queue: Queue, ctx: ActionContext): Promise<void> {
  assertWritable(ctx, "pause");
  await queue.pause();
}

/** Resume a paused queue. */
export async function resumeQueue(queue: Queue, ctx: ActionContext): Promise<void> {
  assertWritable(ctx, "resume");
  await queue.resume();
}

export type CleanState =
  | "completed"
  | "failed"
  | "delayed"
  | "wait"
  | "active"
  | "paused"
  | "prioritized";

/** Bulk-clean jobs in a state older than graceMs. Returns removed job ids. */
export async function cleanQueue(
  queue: Queue,
  state: CleanState,
  graceMs: number,
  limit: number,
  ctx: ActionContext,
): Promise<string[]> {
  assertWritable(ctx, "clean");
  return queue.clean(graceMs, limit, state as Parameters<Queue["clean"]>[2]);
}

export interface BulkResult {
  readonly requested: number;
  readonly succeeded: string[];
  readonly failed: Array<{ readonly id: string; readonly error: string }>;
}

async function runBulk(
  queue: Queue,
  ids: ReadonlyArray<string>,
  ctx: ActionContext,
  action: string,
  each: (queue: Queue, id: string, ctx: ActionContext) => Promise<void>,
): Promise<BulkResult> {
  assertWritable(ctx, action);
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  // Sequential: keeps Redis load predictable and errors attributable per id.
  for (const id of ids) {
    try {
      await each(queue, id, ctx);
      succeeded.push(id);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { requested: ids.length, succeeded, failed };
}

export function bulkRetry(
  queue: Queue,
  ids: ReadonlyArray<string>,
  ctx: ActionContext,
): Promise<BulkResult> {
  return runBulk(queue, ids, ctx, "retry", retryJob);
}

export function bulkRemove(
  queue: Queue,
  ids: ReadonlyArray<string>,
  ctx: ActionContext,
): Promise<BulkResult> {
  return runBulk(queue, ids, ctx, "remove", removeJob);
}

export type { JobType };
