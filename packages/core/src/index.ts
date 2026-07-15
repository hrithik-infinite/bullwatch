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
export {
  type DeployMarker,
  type MarkerInput,
  type MarkerQuery,
  InvalidMarkerError,
  MAX_MARKER_METADATA_KEYS,
  MAX_MARKER_METADATA_VALUE_LENGTH,
  assertMarkerPersistable,
  createMarker,
  markerMatchesQueue,
} from "./storage/markers.js";
export { MemoryMetricsStore } from "./storage/memory-store.js";
export { RedisMetricsStore, type RedisMetricsStoreOptions } from "./storage/redis-store.js";
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
export { MASKED, type MaskConfig, applyMask, compileMask } from "./domain/mask.js";
export {
  type FailureSignatureSummary,
  type FailureSummary,
  type FailureTrendWindow,
  type SummarizeFailuresOptions,
  summarizeFailures,
} from "./domain/failure-summary.js";
export { type MetricEvent, type QueueEventKind, eventToAggregates } from "./domain/events.js";

// --- BullMQ readers / actions / search ---
export { QueueRegistry, type QueueRegistryOptions } from "./bullmq/registry.js";
export { type JobDTO, type JobLike, type ToJobDTOOptions, toJobDTO } from "./bullmq/job-dto.js";
export { type FlowNodeDTO, getFlowTree } from "./bullmq/flows.js";
export {
  type JobRange,
  type QueueSummary,
  type SchedulerDTO,
  type WorkerDTO,
  getJobDetail,
  getQueueSummary,
  getWorkers,
  listJobSchedulers,
  listJobs,
} from "./bullmq/readers.js";
export {
  type ActionContext,
  type BulkResult,
  type CleanState,
  JobNotFoundError,
  JobNotReplayableError,
  ReadOnlyError,
  type ReplayOptions,
  type ReplayResult,
  bulkRemove,
  bulkRetry,
  cleanQueue,
  pauseQueue,
  promoteJob,
  removeJob,
  replayJob,
  resumeQueue,
  retryJob,
} from "./bullmq/actions.js";
export { type SearchOptions, type SearchResult, searchJobs } from "./bullmq/search.js";
export {
  type FailureSampleOptions,
  type FailureSampleResult,
  sampleFailedJobsBySignature,
} from "./bullmq/failure-samples.js";
export { MetricsCollector, type MetricsCollectorOptions } from "./bullmq/metrics-collector.js";

// --- alerts ---
export {
  type AlertDecision,
  type AlertEventKind,
  type AlertNotification,
  type AlertRule,
  type AlertRuleType,
  type AlertsConfig,
  type AlertUnit,
  type FailureRateRule,
  type LatencyRule,
  type QueueDepthRule,
  type RuleEvaluation,
  type RuleState,
  buildNotification,
  decide,
  evaluateDepth,
  evaluateFailureRate,
  evaluateLatency,
} from "./alerts/rules.js";
export {
  type AlertDeliver,
  type WebhookDeliverOptions,
  createWebhookDeliver,
} from "./alerts/webhook.js";
export {
  type AlertEvaluatorOptions,
  type RuleSnapshot,
  AlertEvaluator,
} from "./alerts/evaluator.js";

// --- server ---
export { type BullwatchApp, type BullwatchOptions, createBullwatch } from "./server/app.js";
export { renderPrometheus } from "./server/prometheus.js";
