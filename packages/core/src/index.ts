// Public API surface for @bullwatch/core.

// --- storage / persistence boundary ---
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

// --- pure domain ---
export { type DeriveTimingsInput, type JobTimings, deriveTimings } from "./domain/timings.js";
export { errorSignature } from "./domain/error-signature.js";
export {
  type FieldPredicate,
  type SearchableJob,
  type SearchQuery,
  matchesQuery,
  parseSearchQuery,
} from "./domain/search-query.js";
export { metaScanPattern, queueNameFromMetaKey } from "./domain/discovery.js";
export { type MetricEvent, type QueueEventKind, eventToAggregates } from "./domain/events.js";

// --- BullMQ readers / actions / search ---
export { QueueRegistry, type QueueRegistryOptions } from "./bullmq/registry.js";
export { type JobDTO, type JobLike, toJobDTO } from "./bullmq/job-dto.js";
export {
  type JobRange,
  type QueueSummary,
  getJobDetail,
  getQueueSummary,
  listJobs,
} from "./bullmq/readers.js";
export {
  type ActionContext,
  JobNotFoundError,
  ReadOnlyError,
  cleanQueue,
  promoteJob,
  removeJob,
  retryJob,
} from "./bullmq/actions.js";
export { type SearchOptions, type SearchResult, searchJobs } from "./bullmq/search.js";
export { MetricsCollector, type MetricsCollectorOptions } from "./bullmq/metrics-collector.js";

// --- server ---
export { type BullwatchApp, type BullwatchOptions, createBullwatch } from "./server/app.js";
