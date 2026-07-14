/**
 * Dimension-label validation for the persistence boundary.
 *
 * Every string that reaches a {@link MetricsStore} is a dimension label. Two
 * risks we guard against:
 *   1. A caller accidentally routing payload-derived text into a label field —
 *      caught by the length cap (payloads are large and unbounded; labels are
 *      short identifiers).
 *   2. Unbounded label cardinality (a job name built from a user id, say)
 *      exploding memory — the store applies a top-N cap; this module caps
 *      length so a single label can't be pathological.
 */

/** Labels are short identifiers. Anything longer is rejected, not truncated. */
export const MAX_LABEL_LENGTH = 256;

export class InvalidLabelError extends Error {
  constructor(field: string, reason: string) {
    super(`invalid dimension label for "${field}": ${reason}`);
    this.name = "InvalidLabelError";
  }
}

/**
 * Assert a value is a valid dimension label. Nullable labels (jobName,
 * errorSignature) accept null; queue names must be non-empty.
 */
export function assertLabel(
  field: string,
  value: string | null,
  { nullable }: { nullable: boolean },
): void {
  if (value === null) {
    if (!nullable) throw new InvalidLabelError(field, "must not be null");
    return;
  }
  if (typeof value !== "string") {
    throw new InvalidLabelError(field, "must be a string");
  }
  if (value.length === 0) {
    throw new InvalidLabelError(field, "must not be empty");
  }
  if (value.length > MAX_LABEL_LENGTH) {
    throw new InvalidLabelError(
      field,
      `exceeds ${MAX_LABEL_LENGTH} chars (len=${value.length}) — a payload may have leaked into a label`,
    );
  }
}
