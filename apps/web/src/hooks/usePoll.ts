import { useEffect, useRef, useState } from "react";
import { useApp } from "../state.js";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Fetch on mount + whenever `deps` change, and re-poll every `intervalMs` while
 * the app's live toggle is on. Aborts in-flight requests on unmount/refetch.
 */
export function usePoll<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  intervalMs = 4_000,
): PollState<T> {
  const { live } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are spread by callers
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    fetcherRef.current(ac.signal).then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (cancelled || ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [...deps, tick]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [live, intervalMs]);

  return { data, error, loading, refetch: () => setTick((t) => t + 1) };
}
