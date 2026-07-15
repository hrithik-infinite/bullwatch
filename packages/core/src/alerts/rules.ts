/**
 * Alert rules and evaluation. Pure — no Redis, no fetch, no clock of its own.
 * The evaluator (alerts/evaluator.ts) reads metrics and feeds them here; this
 * module decides whether a rule is breached and, via a pure state reducer,
 * whether that warrants a notification. Keeping it pure makes the alerting
 * logic — the part most likely to be wrong — fully unit-testable without a
 * running queue.
 */

import type { QueueSummary } from "../bullmq/readers.js";
import type { AggregateSeries, AggregateValue } from "../storage/aggregate.js";
import { emptyHistogram, mergeValues, percentile } from "../storage/histogram.js";

export type AlertRuleType = "failure_rate" | "queue_depth" | "latency";
export type AlertUnit = "ratio" | "count" | "ms";
export type AlertEventKind = "firing" | "resolved";

export interface AlertRuleBase {
  readonly id: string;
  readonly queue: string;
  /** Min ms between repeat notifications for the same firing rule. */
  readonly cooldownMs?: number;
}

export interface FailureRateRule extends AlertRuleBase {
  readonly type: "failure_rate";
  readonly jobName?: string | null;
  readonly windowMs: number;
  /** Breach when failed/(completed+failed) exceeds this (0..1). */
  readonly threshold: number;
  /** Don't fire until at least this many finished jobs in the window. Default 1. */
  readonly minSample?: number;
}

export interface QueueDepthRule extends AlertRuleBase {
  readonly type: "queue_depth";
  /** A specific state's count, or total when omitted. */
  readonly state?: string;
  readonly threshold: number;
}

export interface LatencyRule extends AlertRuleBase {
  readonly type: "latency";
  readonly jobName?: string | null;
  readonly metric: "wait_ms" | "run_ms";
  readonly windowMs: number;
  readonly thresholdMs: number;
  /** Percentile to test, 0..1. Default 0.95. */
  readonly percentile?: number;
}

export type AlertRule = FailureRateRule | QueueDepthRule | LatencyRule;

export interface AlertsConfig {
  readonly rules: ReadonlyArray<AlertRule>;
  /** Where breaches are POSTed. Empty = evaluate but deliver nowhere. */
  readonly webhookUrls: ReadonlyArray<string>;
  readonly intervalMs?: number;
  readonly deliveryTimeoutMs?: number;
  readonly maxAttempts?: number;
}

export interface RuleEvaluation {
  readonly value: number;
  readonly breached: boolean;
  readonly threshold: number;
  readonly unit: AlertUnit;
  readonly windowMs: number | null;
  /** True when the sample was large enough to trust (failure_rate minSample). */
  readonly saturated: boolean;
}

export interface AlertNotification {
  readonly schemaVersion: 1;
  readonly event: AlertEventKind;
  readonly ruleId: string;
  readonly type: AlertRuleType;
  readonly queue: string;
  readonly jobName: string | null;
  readonly value: number;
  readonly threshold: number;
  readonly unit: AlertUnit;
  readonly windowMs: number | null;
  readonly saturated: boolean;
  readonly message: string;
  readonly firstBreachAt: number;
  readonly at: number;
}

export interface RuleState {
  readonly status: "ok" | "firing";
  readonly firstBreachAt: number | null;
  readonly lastNotifiedAt: number | null;
  readonly lastValue: number;
}

export const INITIAL_RULE_STATE: RuleState = {
  status: "ok",
  firstBreachAt: null,
  lastNotifiedAt: null,
  lastValue: 0,
};

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function counterCount(value: AggregateValue): number {
  return value.kind === "counter" ? value.count : 0;
}

export function sumCounterSeries(series: ReadonlyArray<AggregateSeries>): number {
  let sum = 0;
  for (const s of series) {
    for (const p of s.points) sum += counterCount(p.value);
  }
  return sum;
}

export function mergeHistogramSeries(series: ReadonlyArray<AggregateSeries>): AggregateValue {
  let acc: AggregateValue = emptyHistogram();
  for (const s of series) {
    for (const p of s.points) {
      if (p.value.kind === "histogram") acc = mergeValues(acc, p.value);
    }
  }
  return acc;
}

export function evaluateFailureRate(
  rule: FailureRateRule,
  completed: ReadonlyArray<AggregateSeries>,
  failed: ReadonlyArray<AggregateSeries>,
): RuleEvaluation {
  const completedN = sumCounterSeries(completed);
  const failedN = sumCounterSeries(failed);
  const total = completedN + failedN;
  const minSample = rule.minSample ?? 1;
  const saturated = total >= minSample;
  const value = total > 0 ? failedN / total : 0;
  return {
    value,
    breached: saturated && value > rule.threshold,
    threshold: rule.threshold,
    unit: "ratio",
    windowMs: rule.windowMs,
    saturated,
  };
}

export function evaluateDepth(rule: QueueDepthRule, summary: QueueSummary): RuleEvaluation {
  const value = rule.state ? (summary.counts[rule.state] ?? 0) : summary.total;
  return {
    value,
    breached: value > rule.threshold,
    threshold: rule.threshold,
    unit: "count",
    windowMs: null,
    saturated: true,
  };
}

export function evaluateLatency(
  rule: LatencyRule,
  hist: ReadonlyArray<AggregateSeries>,
): RuleEvaluation {
  const merged = mergeHistogramSeries(hist);
  const count = merged.kind === "histogram" ? merged.totalCount : 0;
  const value = count > 0 ? percentile(merged, rule.percentile ?? 0.95) : 0;
  return {
    value,
    breached: count > 0 && value > rule.thresholdMs,
    threshold: rule.thresholdMs,
    unit: "ms",
    windowMs: rule.windowMs,
    saturated: count > 0,
  };
}

export type AlertDecision =
  | { readonly kind: "none"; readonly next: RuleState }
  | { readonly kind: "notify"; readonly event: AlertEventKind; readonly next: RuleState };

/**
 * Pure state reducer: given the prior state and a fresh evaluation, decide
 * whether to notify (and of what) and produce the next state. Notifies once on
 * firing, re-notifies only after cooldown while still firing, and once on
 * resolve.
 */
export function decide(
  prev: RuleState,
  evaluation: RuleEvaluation,
  now: number,
  cooldownMs: number,
): AlertDecision {
  if (evaluation.breached) {
    if (prev.status === "ok") {
      return {
        kind: "notify",
        event: "firing",
        next: {
          status: "firing",
          firstBreachAt: now,
          lastNotifiedAt: now,
          lastValue: evaluation.value,
        },
      };
    }
    // Already firing: re-notify only after cooldown elapses.
    const due = prev.lastNotifiedAt === null || now - prev.lastNotifiedAt >= cooldownMs;
    return {
      kind: due ? "notify" : "none",
      event: "firing",
      next: {
        status: "firing",
        firstBreachAt: prev.firstBreachAt ?? now,
        lastNotifiedAt: due ? now : prev.lastNotifiedAt,
        lastValue: evaluation.value,
      },
    } as AlertDecision;
  }
  // Not breached.
  if (prev.status === "firing") {
    return {
      kind: "notify",
      event: "resolved",
      next: { status: "ok", firstBreachAt: null, lastNotifiedAt: now, lastValue: evaluation.value },
    };
  }
  return {
    kind: "none",
    next: {
      status: "ok",
      firstBreachAt: null,
      lastNotifiedAt: prev.lastNotifiedAt,
      lastValue: evaluation.value,
    },
  };
}

function ruleJobName(rule: AlertRule): string | null {
  return rule.type === "queue_depth" ? null : (rule.jobName ?? null);
}

export function buildNotification(
  rule: AlertRule,
  event: AlertEventKind,
  ev: RuleEvaluation,
  firstBreachAt: number,
  now: number,
): AlertNotification {
  const rounded = ev.unit === "ratio" ? ev.value.toFixed(4) : Math.round(ev.value).toString();
  const message =
    event === "firing"
      ? `[firing] ${rule.type} on queue "${rule.queue}" = ${rounded}${ev.unit === "ms" ? "ms" : ""} > ${ev.threshold} threshold`
      : `[resolved] ${rule.type} on queue "${rule.queue}" back within threshold (${rounded})`;
  return {
    schemaVersion: 1,
    event,
    ruleId: rule.id,
    type: rule.type,
    queue: rule.queue,
    jobName: ruleJobName(rule),
    value: ev.value,
    threshold: ev.threshold,
    unit: ev.unit,
    windowMs: ev.windowMs,
    saturated: ev.saturated,
    message,
    firstBreachAt,
    at: now,
  };
}

export function cooldownFor(rule: AlertRule): number {
  return rule.cooldownMs ?? DEFAULT_COOLDOWN_MS;
}
