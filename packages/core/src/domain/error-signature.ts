/**
 * Normalize a job's failure reason into a stable signature that groups similar
 * failures for DLQ analysis. Pure. Variable data (ids, numbers, quoted values,
 * paths, urls) is replaced with placeholders so "Timeout of 5000ms" and
 * "Timeout of 3000ms" collapse to one group.
 *
 * The output is bounded in length, making it a safe dimension label for the
 * persistence boundary (see storage/labels.ts) — a raw error message never is.
 */

const MAX_SIGNATURE_LENGTH = 200;

// Order matters: broad, content-bearing patterns first so their contents aren't
// partially rewritten by later number/hex rules.
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/"[^"]*"|'[^']*'/g, "<str>"], // quoted strings
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>"], // urls
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>"], // emails
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"], // uuids
  [/\b0x[0-9a-f]+\b/gi, "<addr>"], // hex addresses
  [/(?:\/[\w.-]+)+(?::\d+)*/g, "<path>"], // unix paths, optional :line:col
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"], // long hex blobs
  [/\d+/g, "<n>"], // any remaining number
];

export function errorSignature(
  failedReason: string | null | undefined,
  opts: { maxLength?: number } = {},
): string | null {
  if (failedReason === null || failedReason === undefined) return null;

  const firstLine = failedReason.split("\n")[0] ?? "";
  let s = firstLine.trim();
  if (s.length === 0) return null;

  for (const [pattern, replacement] of RULES) {
    s = s.replace(pattern, replacement);
  }

  s = s.replace(/\s+/g, " ").trim();
  if (s.length === 0) return null;

  const max = opts.maxLength ?? MAX_SIGNATURE_LENGTH;
  return s.length > max ? s.slice(0, max) : s;
}
