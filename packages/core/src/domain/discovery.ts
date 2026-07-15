/**
 * Queue auto-discovery parsing. Pure. BullMQ keeps one `{prefix}:{queue}:meta`
 * hash per queue and there is no registry, so discovery means SCANning for meta
 * keys (never KEYS) and parsing the queue name out. The Redis SCAN itself lives
 * in the registry; this module is the parsing, which is where the edge cases
 * (colons in queue names, custom prefixes) live and must not regress.
 */

const META_SUFFIX = ":meta";

/** The glob a SCAN uses to find every queue's meta hash under a prefix. */
export function metaScanPattern(prefix: string): string {
  return `${prefix}:*${META_SUFFIX}`;
}

/**
 * Extract the queue name from a meta key, or null if the key is not a meta key
 * for this prefix. Queue names may themselves contain colons, so we strip only
 * the known prefix and suffix rather than splitting.
 */
export function queueNameFromMetaKey(key: string, prefix: string): string | null {
  const head = `${prefix}:`;
  if (!key.startsWith(head) || !key.endsWith(META_SUFFIX)) return null;
  const name = key.slice(head.length, key.length - META_SUFFIX.length);
  return name.length > 0 ? name : null;
}
