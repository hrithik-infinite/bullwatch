/**
 * Alert evaluator: the one background loop for alerting. Mirrors
 * {@link MetricsCollector}'s lifecycle — constructed with injectable deps and an
 * optional clock, owns a timer it clears in close(), and is owned by the app so
 * it tears down with everything else. It is a pure READER (store.query +
 * getQueueSummary) plus an outbound POST, so it never mutates queues and fires
 * even in read-only mode. All rule state lives in-process and is never persisted.
 */

import type { Queue } from "bullmq";
import { getQueueSummary } from "../bullmq/readers.js";
import type { MetricsStore } from "../storage/metrics-store.js";
import {
  type AlertRule,
  type AlertsConfig,
  INITIAL_RULE_STATE,
  type RuleEvaluation,
  type RuleState,
  buildNotification,
  cooldownFor,
  decide,
  evaluateDepth,
  evaluateFailureRate,
  evaluateLatency,
} from "./rules.js";
import { type AlertDeliver, createWebhookDeliver } from "./webhook.js";

export interface AlertEvaluatorOptions {
  readonly store: MetricsStore;
  readonly getQueue: (name: string) => Queue;
  readonly config: AlertsConfig;
  /** Injectable delivery (tests). Defaults to a webhook POSTer. */
  readonly deliver?: AlertDeliver;
  readonly now?: () => number;
  readonly onError?: (err: unknown) => void;
}

export interface RuleSnapshot {
  readonly ruleId: string;
  readonly type: AlertRule["type"];
  readonly queue: string;
  readonly status: RuleState["status"];
  readonly lastValue: number;
  readonly firstBreachAt: number | null;
}

const DEFAULT_INTERVAL_MS = 15_000;

export class AlertEvaluator {
  private readonly store: MetricsStore;
  private readonly getQueue: (name: string) => Queue;
  private readonly config: AlertsConfig;
  private readonly deliver: AlertDeliver;
  private readonly now: () => number;
  private readonly onError?: (err: unknown) => void;
  private readonly intervalMs: number;
  private readonly states = new Map<string, RuleState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(opts: AlertEvaluatorOptions) {
    this.store = opts.store;
    this.getQueue = opts.getQueue;
    this.config = opts.config;
    this.now = opts.now ?? (() => Date.now());
    this.onError = opts.onError;
    this.intervalMs = opts.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.deliver =
      opts.deliver ??
      createWebhookDeliver({
        timeoutMs: opts.config.deliveryTimeoutMs,
        maxAttempts: opts.config.maxAttempts,
        onError: (_url, err) => this.onError?.(err),
      });
  }

  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  private tick(): void {
    if (this.running || this.closed) return;
    this.running = true;
    this.inFlight = this.evaluateOnce().finally(() => {
      this.running = false;
    });
  }

  /** One full evaluation pass over all rules. Public for deterministic tests. */
  async evaluateOnce(): Promise<void> {
    const now = this.now();
    for (const rule of this.config.rules) {
      try {
        const ev = await this.evaluateRule(rule, now);
        const prev = this.states.get(rule.id) ?? INITIAL_RULE_STATE;
        const decision = decide(prev, ev, now, cooldownFor(rule));
        this.states.set(rule.id, decision.next);
        if (decision.kind === "notify") {
          const notification = buildNotification(
            rule,
            decision.event,
            ev,
            decision.next.firstBreachAt ?? now,
            now,
          );
          await this.deliver(this.config.webhookUrls, notification);
        }
      } catch (err) {
        // One bad rule must not stop the loop or crash the process.
        this.onError?.(err);
      }
    }
  }

  private async evaluateRule(rule: AlertRule, now: number): Promise<RuleEvaluation> {
    if (rule.type === "queue_depth") {
      return evaluateDepth(rule, await getQueueSummary(this.getQueue(rule.queue)));
    }
    if (rule.type === "failure_rate") {
      const from = now - rule.windowMs;
      const jobName = rule.jobName ?? null;
      const [completed, failed] = await Promise.all([
        this.store.query({ queue: rule.queue, jobName, metric: "completed", from, to: now }),
        // errorSignature:null → the signature-less TOTAL only, not the per-signature
        // series too (which would double-count the failures).
        this.store.query({
          queue: rule.queue,
          jobName,
          errorSignature: null,
          metric: "failed",
          from,
          to: now,
        }),
      ]);
      return evaluateFailureRate(rule, completed, failed);
    }
    // latency
    const from = now - rule.windowMs;
    const hist = await this.store.query({
      queue: rule.queue,
      jobName: rule.jobName ?? null,
      metric: rule.metric,
      from,
      to: now,
    });
    return evaluateLatency(rule, hist);
  }

  /** Current per-rule status, for a read surface (e.g. GET /api/alerts). */
  snapshot(): RuleSnapshot[] {
    return this.config.rules.map((rule) => {
      const state = this.states.get(rule.id) ?? INITIAL_RULE_STATE;
      return {
        ruleId: rule.id,
        type: rule.type,
        queue: rule.queue,
        status: state.status,
        lastValue: state.lastValue,
        firstBreachAt: state.firstBreachAt,
      };
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }
}
