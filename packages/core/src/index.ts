// Public API surface for @bullwatch/core.

export type {
  AggregateRecord,
  AggregateSeries,
  AggregateValue,
  MetricKind,
} from "./storage/aggregate.js";
export {
  assertPersistable,
  type MetricsQuery,
  type MetricsStore,
} from "./storage/metrics-store.js";
export { assertLabel, InvalidLabelError, MAX_LABEL_LENGTH } from "./storage/labels.js";
export { MemoryMetricsStore } from "./storage/memory-store.js";
export {
  BUCKET_COUNT,
  LATENCY_BOUNDS_MS,
  bucketIndex,
  emptyHistogram,
  mergeValues,
  observe,
  percentile,
} from "./storage/histogram.js";
export {
  type BullwatchApp,
  type BullwatchOptions,
  createBullwatch,
} from "./server/app.js";
