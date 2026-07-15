/**
 * Derive wait/run/total durations from a BullMQ job's instants. Pure: no Redis,
 * no clock unless you pass `now`. Used by both the job DTO (UI columns) and the
 * metrics pipeline (latency histograms of finished jobs).
 *
 * BullMQ instants: `timestamp` = enqueued, `processedOn` = processing started,
 * `finishedOn` = completed or failed. Wait = processedOn − timestamp,
 * run = finishedOn − processedOn.
 */
export interface JobTimings {
  readonly createdAt: number;
  readonly processedAt: number | null;
  readonly finishedAt: number | null;
  /** Time spent waiting: final once processing began, else elapsed to `now`. */
  readonly waitMs: number | null;
  /** Processing duration: final once finished, else elapsed to `now`. */
  readonly runMs: number | null;
  /** End-to-end duration; null until the job is finished. */
  readonly totalMs: number | null;
}

export interface DeriveTimingsInput {
  readonly timestamp: number;
  readonly processedOn?: number | null;
  readonly finishedOn?: number | null;
  /** Reference clock for in-flight jobs. Omit to get null for open-ended spans. */
  readonly now?: number;
}

function isSet(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clampNonNegative(v: number): number {
  return v < 0 ? 0 : v;
}

export function deriveTimings(input: DeriveTimingsInput): JobTimings {
  const { timestamp, now } = input;
  const processedAt = isSet(input.processedOn) ? input.processedOn : null;
  const finishedAt = isSet(input.finishedOn) ? input.finishedOn : null;

  let waitMs: number | null;
  if (processedAt !== null) waitMs = clampNonNegative(processedAt - timestamp);
  else if (isSet(now)) waitMs = clampNonNegative(now - timestamp);
  else waitMs = null;

  let runMs: number | null;
  if (processedAt !== null && finishedAt !== null)
    runMs = clampNonNegative(finishedAt - processedAt);
  else if (processedAt !== null && isSet(now)) runMs = clampNonNegative(now - processedAt);
  else runMs = null;

  const totalMs = finishedAt !== null ? clampNonNegative(finishedAt - timestamp) : null;

  return { createdAt: timestamp, processedAt, finishedAt, waitMs, runMs, totalMs };
}
