import type { JobType, Queue } from "bullmq";

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

/** Bulk-clean jobs in a state older than graceMs. Returns removed job ids. */
export async function cleanQueue(
  queue: Queue,
  state: "completed" | "failed" | "delayed" | "wait" | "active" | "paused" | "prioritized",
  graceMs: number,
  limit: number,
  ctx: ActionContext,
): Promise<string[]> {
  assertWritable(ctx, "clean");
  return queue.clean(graceMs, limit, state as Parameters<Queue["clean"]>[2]);
}

export type { JobType };
