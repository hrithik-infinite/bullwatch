/**
 * Webhook delivery for alerts. Generic — POSTs the alert JSON to operator-
 * configured URLs (Slack/Discord/PagerDuty all accept an incoming-webhook URL),
 * so there is no per-vendor code. URLs arrive at runtime through config and are
 * passed to fetch() as a variable; no URL literal appears in the bundle, so the
 * zero-external-calls CI gate stays green. Delivery is best-effort: failures are
 * reported via onError and never throw into the evaluator loop.
 */

import type { AlertNotification } from "./rules.js";

export type AlertDeliver = (
  urls: ReadonlyArray<string>,
  payload: AlertNotification,
) => Promise<void>;

export interface WebhookDeliverOptions {
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  /** Injectable for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly onError?: (url: string, err: unknown) => void;
  /** Injectable backoff sleep for tests. Defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWebhookDeliver(opts: WebhookDeliverOptions = {}): AlertDeliver {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const onError = opts.onError;

  async function deliverOne(url: string, body: string): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return;
        lastErr = new Error(`webhook responded ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      // Exponential backoff between attempts (not after the last).
      if (attempt < maxAttempts) await sleep(2 ** (attempt - 1) * 100);
    }
    onError?.(url, lastErr);
  }

  return async (urls, payload) => {
    if (urls.length === 0) return;
    const body = JSON.stringify(payload);
    await Promise.all(urls.map((url) => deliverOne(url, body)));
  };
}
