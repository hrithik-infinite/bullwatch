import { describe, expect, it, vi } from "vitest";
import type { AlertNotification } from "./rules.js";
import { createWebhookDeliver } from "./webhook.js";

const NOTIFICATION: AlertNotification = {
  schemaVersion: 1,
  event: "firing",
  ruleId: "r",
  type: "failure_rate",
  queue: "email",
  jobName: null,
  value: 0.42,
  threshold: 0.2,
  unit: "ratio",
  windowMs: 60_000,
  saturated: true,
  message: '[firing] failure_rate on queue "email"',
  firstBreachAt: 1_000,
  at: 2_000,
};

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

describe("createWebhookDeliver", () => {
  it("POSTs JSON to every configured url", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const deliver = createWebhookDeliver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await deliver(["http://a.local/hook", "http://b.local/hook"], NOTIFICATION);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://a.local/hook");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ ruleId: "r", event: "firing" });
  });

  it("does nothing when there are no urls", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const deliver = createWebhookDeliver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await deliver([], NOTIFICATION);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries on failure up to maxAttempts, then reports via onError without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const onError = vi.fn();
    const deliver = createWebhookDeliver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
      onError,
      sleep: async () => {}, // no real backoff in tests
    });
    await expect(deliver(["http://a.local/hook"], NOTIFICATION)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("treats a non-2xx response as a failure and retries", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const onError = vi.fn();
    const deliver = createWebhookDeliver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
      onError,
      sleep: async () => {},
    });
    await deliver(["http://a.local/hook"], NOTIFICATION);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once a delivery succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls === 1 ? new Response(null, { status: 503 }) : okResponse();
    });
    const onError = vi.fn();
    const deliver = createWebhookDeliver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 5,
      onError,
      sleep: async () => {},
    });
    await deliver(["http://a.local/hook"], NOTIFICATION);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
});
