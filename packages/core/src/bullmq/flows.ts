import type { FlowProducer, JobNode } from "bullmq";
import { type JobDTO, toJobDTO } from "./job-dto.js";

/** A parent-child job tree node for flow visualization. */
export interface FlowNodeDTO {
  readonly job: JobDTO;
  readonly children: FlowNodeDTO[];
}

function mapNode(node: JobNode, fallbackQueue: string, now: number): FlowNodeDTO {
  const queue = node.job.queueName ?? fallbackQueue;
  return {
    job: toJobDTO(node.job, queue, now),
    children: (node.children ?? []).map((child) => mapNode(child, queue, now)),
  };
}

/**
 * Fetch a flow (parent-child job DAG) as a DTO tree. Read-only; payloads pass
 * through for live rendering. `depth` and `maxChildren` bound the traversal so a
 * pathological flow can't produce an unbounded read.
 */
export async function getFlowTree(
  flow: FlowProducer,
  queueName: string,
  jobId: string,
  prefix: string,
  now: number,
  opts: { depth?: number; maxChildren?: number } = {},
): Promise<FlowNodeDTO | null> {
  const node = await flow.getFlow({
    queueName,
    id: jobId,
    prefix,
    depth: opts.depth ?? 10,
    maxChildren: opts.maxChildren ?? 50,
  });
  if (!node?.job) return null;
  return mapNode(node, queueName, now);
}
