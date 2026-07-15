/**
 * Parse and evaluate the bullwatch search language. Pure — no Redis. The Redis
 * side (a budgeted read-through scan over job states) applies this predicate to
 * each fetched job; nothing is ever indexed, upholding the never-persist rule.
 *
 * Grammar (space-separated, AND semantics):
 *   - `field:value` — substring match (case-insensitive) at a path. `id` and
 *     `name` are job-level; any other dotted path resolves into the payload.
 *   - `"quoted phrase"` or bare `term` — free-text match against id, name, and
 *     the stringified payload.
 */

export interface FieldPredicate {
  readonly path: string;
  readonly value: string;
}

export interface SearchQuery {
  readonly terms: ReadonlyArray<string>;
  readonly fields: ReadonlyArray<FieldPredicate>;
  readonly raw: string;
}

export interface SearchableJob {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly data?: unknown;
}

const FIELD_RE = /^([a-zA-Z_][\w.-]*):(.*)$/s;

/** Split input into tokens, treating quoted spans as literal (spaces kept). */
function scan(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let started = false;
  for (const ch of input) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

export function parseSearchQuery(input: string): SearchQuery {
  const terms: string[] = [];
  const fields: FieldPredicate[] = [];
  for (const token of scan(input)) {
    const m = FIELD_RE.exec(token);
    const path = m?.[1];
    const value = m?.[2];
    // A value starting with "/" is almost certainly a URL/path, not a predicate.
    if (path !== undefined && value !== undefined && value.length > 0 && !value.startsWith("/")) {
      fields.push({ path, value });
    } else {
      terms.push(token);
    }
  }
  return { terms, fields, raw: input };
}

function resolvePath(data: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = data;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function includesCI(haystack: string | null, needle: string): boolean {
  return haystack?.toLowerCase().includes(needle.toLowerCase()) ?? false;
}

function matchesField(job: SearchableJob, pred: FieldPredicate): boolean {
  let haystack: string | null;
  if (pred.path === "id") haystack = job.id ?? null;
  else if (pred.path === "name") haystack = job.name ?? null;
  else haystack = stringify(resolvePath(job.data, pred.path));
  return includesCI(haystack, pred.value);
}

export function matchesQuery(job: SearchableJob, query: SearchQuery): boolean {
  const freeHaystack = [job.id ?? "", job.name ?? "", stringify(job.data) ?? ""].join(" ");
  for (const term of query.terms) {
    if (!includesCI(freeHaystack, term)) return false;
  }
  for (const pred of query.fields) {
    if (!matchesField(job, pred)) return false;
  }
  return true;
}
