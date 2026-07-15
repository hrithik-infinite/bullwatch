/**
 * Payload field masking. Pure — no Redis, no I/O. Given a set of dotted path
 * patterns, produce a redacted copy of a payload with matching fields replaced
 * by a sentinel. Applied in two places that must agree:
 *
 *   1. At render — `toJobDTO` masks `data`/`returnvalue` before they leave the
 *      process, so a redacted field is never shown.
 *   2. Before search matching — `searchJobs` masks each job's payload before the
 *      predicate runs, so search cannot be used as an oracle to extract a masked
 *      value one character at a time.
 *
 * The privacy invariant (never persist payloads) is unchanged: masking narrows
 * what is *rendered*, on top of the guarantee that nothing is written at all.
 *
 * Pattern grammar (dotted segments):
 *   - a literal segment matches an object key or an array index (as a string)
 *   - `*`  matches exactly one segment
 *   - `**` matches zero or more segments (any depth)
 * Examples: `password` · `user.ssn` · `**.token` (a `token` anywhere) ·
 * `items.*.cardNumber` (per array element).
 */

/** Replacement written in place of a matched field. */
export const MASKED = "[masked]" as const;

export interface MaskConfig {
  /** Compiled patterns, each a list of segments. */
  readonly patterns: ReadonlyArray<ReadonlyArray<string>>;
  /** False when there are no patterns — `applyMask` is then identity. */
  readonly active: boolean;
}

/** Compile dotted path patterns into a reusable config. */
export function compileMask(patterns: ReadonlyArray<string>): MaskConfig {
  const compiled = patterns
    .map((p) => p.split(".").filter((s) => s.length > 0))
    .filter((segs) => segs.length > 0);
  return { patterns: compiled, active: compiled.length > 0 };
}

type Segs = ReadonlyArray<string>;

/** A pattern matches the current node when every remaining segment is `**`. */
function matchesHere(patterns: ReadonlyArray<Segs>): boolean {
  return patterns.some((p) => p.every((s) => s === "**"));
}

/** Live patterns after descending into a child keyed by `key`. */
function advance(patterns: ReadonlyArray<Segs>, key: string): Segs[] {
  const next: Segs[] = [];
  for (const p of patterns) {
    const head = p[0];
    if (head === undefined) continue;
    const rest = p.slice(1);
    if (head === "**") {
      next.push(p); // `**` consumes this segment and stays live for deeper nodes
      const rHead = rest[0]; // `**` also matches zero segments here
      if (rHead === "*" || rHead === key) next.push(rest.slice(1));
    } else if (head === "*" || head === key) {
      next.push(rest);
    }
  }
  return next;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maskNode(value: unknown, patterns: ReadonlyArray<Segs>): unknown {
  if (matchesHere(patterns)) return MASKED;
  if (patterns.length === 0) return value; // nothing live below — share the subtree
  if (Array.isArray(value)) {
    return value.map((el, i) => maskNode(el, advance(patterns, String(i))));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = maskNode(value[key], advance(patterns, key));
    }
    return out;
  }
  return value; // primitive with a live-but-unmatched pattern — unchanged
}

/**
 * Return a redacted copy of `value` per `mask`. Never mutates the input; shares
 * subtrees that contain no matched field. Identity when the config is inactive.
 */
export function applyMask(value: unknown, mask: MaskConfig): unknown {
  if (!mask.active) return value;
  return maskNode(value, mask.patterns);
}
