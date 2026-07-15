/**
 * Deploy markers. Pure — no Redis. A marker is a small, timestamped, structured
 * record ("deployed v1.2.3 at T") the UI overlays on metric charts to correlate
 * deploys with behavior changes. Markers are operator-supplied deploy metadata,
 * NOT job payloads — but they still pass a strict, length-capped validator so a
 * payload can't be smuggled in through this door: the never-persist invariant is
 * upheld here by the same construction (short, bounded, structured) that
 * {@link assertPersistable} uses for aggregates.
 */

import { randomUUID } from "node:crypto";
import { InvalidLabelError, MAX_LABEL_LENGTH, assertLabel } from "./labels.js";

export interface DeployMarker {
  readonly id: string;
  readonly ts: number;
  readonly label: string;
  readonly version: string | null;
  readonly sha: string | null;
  /** Optional scope: null = global (matches every queue's chart). */
  readonly queue: string | null;
  readonly metadata: Readonly<Record<string, string>> | null;
}

export interface MarkerInput {
  readonly ts?: number;
  readonly label: string;
  readonly version?: string | null;
  readonly sha?: string | null;
  readonly queue?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
}

export interface MarkerQuery {
  readonly from: number;
  readonly to: number;
  /** When set, returns global markers plus markers scoped to this queue. */
  readonly queue?: string;
}

export const MAX_MARKER_METADATA_KEYS = 16;
export const MAX_MARKER_METADATA_VALUE_LENGTH = 512;

export class InvalidMarkerError extends Error {
  constructor(reason: string) {
    super(`invalid deploy marker: ${reason}`);
    this.name = "InvalidMarkerError";
  }
}

/**
 * Validate a marker at the persistence boundary. Every store MUST call this
 * before persisting. Caps every field so a marker stays a marker.
 */
export function assertMarkerPersistable(m: DeployMarker): void {
  if (typeof m.id !== "string" || m.id.length === 0) {
    throw new InvalidMarkerError("id must be a non-empty string");
  }
  if (!Number.isFinite(m.ts) || m.ts < 0) {
    throw new InvalidMarkerError(`invalid ts: ${m.ts}`);
  }
  // Reuse the dimension-label caps for the short text fields.
  try {
    assertLabel("label", m.label, { nullable: false });
    assertLabel("version", m.version, { nullable: true });
    assertLabel("sha", m.sha, { nullable: true });
    assertLabel("queue", m.queue, { nullable: true });
  } catch (err) {
    throw new InvalidMarkerError(err instanceof InvalidLabelError ? err.message : String(err));
  }
  if (m.metadata !== null) {
    const keys = Object.keys(m.metadata);
    if (keys.length > MAX_MARKER_METADATA_KEYS) {
      throw new InvalidMarkerError(
        `metadata has ${keys.length} keys, max ${MAX_MARKER_METADATA_KEYS}`,
      );
    }
    for (const key of keys) {
      if (key.length > MAX_LABEL_LENGTH) {
        throw new InvalidMarkerError(`metadata key too long (len=${key.length})`);
      }
      const value = m.metadata[key];
      if (typeof value !== "string") {
        throw new InvalidMarkerError(`metadata value for "${key}" must be a string`);
      }
      if (value.length > MAX_MARKER_METADATA_VALUE_LENGTH) {
        throw new InvalidMarkerError(
          `metadata value for "${key}" exceeds ${MAX_MARKER_METADATA_VALUE_LENGTH} chars — a payload may have leaked into a marker`,
        );
      }
    }
  }
}

/**
 * Build a validated {@link DeployMarker} from operator input, assigning a random
 * id and defaulting ts to now. Throws {@link InvalidMarkerError} on bad input.
 */
export function createMarker(input: MarkerInput, now: number): DeployMarker {
  if (
    input.metadata != null &&
    (typeof input.metadata !== "object" || Array.isArray(input.metadata))
  ) {
    throw new InvalidMarkerError("metadata must be an object");
  }
  const metadata =
    input.metadata && Object.keys(input.metadata).length > 0 ? { ...input.metadata } : null;
  const marker: DeployMarker = {
    id: randomUUID(),
    ts: input.ts ?? now,
    label: input.label,
    version: input.version ?? null,
    sha: input.sha ?? null,
    queue: input.queue ?? null,
    metadata,
  };
  assertMarkerPersistable(marker);
  return marker;
}

/** Global markers (queue===null) match every query; scoped markers match their queue. */
export function markerMatchesQueue(m: DeployMarker, queue: string | undefined): boolean {
  if (queue === undefined) return true;
  return m.queue === null || m.queue === queue;
}
