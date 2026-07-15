import type { Queue } from "bullmq";
import { errorSignature } from "../domain/error-signature.js";

/**
 * Budgeted, read-through sampling of failed job ids grouped by error signature.
 * The DLQ summary comes from persisted aggregates; this reader exists only to
 * attach a few *representative job ids* per signature so an operator can jump
 * from "this signature is spiking" to actual failed jobs. It computes
 * {@link errorSignature} per fetched job with the SAME normalization the
 * collector used, so the join key matches. Returns ids only — never payloads,
 * nothing persisted — and surfaces its cost as `scanned`/`truncated`, mirroring
 * {@link searchJobs}.
 */
export interface FailureSampleOptions {
  /** Signatures to collect ids for (from the failure summary). */
  readonly signatures: ReadonlyArray<string>;
  /** Max ids to collect per signature. */
  readonly perSignature: number;
  /** Max failed jobs to fetch — the scan budget. */
  readonly scanLimit: number;
}

export interface FailureSampleResult {
  /** signature -> up to perSignature representative job ids. */
  readonly samples: Readonly<Record<string, string[]>>;
  readonly scanned: number;
  /** True if the scan budget was hit before every signature filled. */
  readonly truncated: boolean;
}

export async function sampleFailedJobsBySignature(
  queue: Queue,
  opts: FailureSampleOptions,
): Promise<FailureSampleResult> {
  const wanted = new Set(opts.signatures);
  const samples: Record<string, string[]> = {};
  for (const sig of wanted) samples[sig] = [];
  if (wanted.size === 0 || opts.perSignature <= 0 || opts.scanLimit <= 0) {
    return { samples, scanned: 0, truncated: false };
  }

  const jobs = await queue.getJobs(["failed"], 0, opts.scanLimit - 1);
  const scanned = jobs.length;
  let remaining = wanted.size * opts.perSignature;

  for (const job of jobs) {
    if (remaining === 0) break;
    const sig = errorSignature(job.failedReason ?? null);
    if (sig === null || !wanted.has(sig)) continue;
    const bucket = samples[sig] as string[];
    if (bucket.length >= opts.perSignature) continue;
    if (job.id) {
      bucket.push(job.id);
      remaining--;
    }
  }

  // Budget hit before we could fill every signature: more matches may exist.
  const filledAll = Object.values(samples).every((ids) => ids.length >= opts.perSignature);
  const truncated = scanned >= opts.scanLimit && !filledAll;
  return { samples, scanned, truncated };
}
