import { type ConnectionOptions, FlowProducer, Queue } from "bullmq";
import IORedis, { type Redis, type RedisOptions } from "ioredis";
import { metaScanPattern, queueNameFromMetaKey } from "../domain/discovery.js";

export interface QueueRegistryOptions {
  /** ioredis options or an existing instance. Options => the registry owns its clients. */
  readonly connection: ConnectionOptions;
  /** BullMQ key prefix. Default "bull". */
  readonly prefix?: string;
  /** Explicit queue names to expose. */
  readonly queues?: ReadonlyArray<string>;
  /** SCAN for `{prefix}:*:meta` and expose whatever is found. Default false. */
  readonly discover?: boolean;
}

const SCAN_COUNT = 200;

/**
 * Owns BullMQ `Queue` instances and queue discovery. Queues are created lazily
 * and cached. Discovery uses SCAN (never KEYS) over meta keys — the same
 * approach BullMQ's own connector uses — bounded and cursor-based so it is safe
 * on large keyspaces.
 */
export class QueueRegistry {
  private readonly prefix: string;
  private readonly explicit: ReadonlyArray<string>;
  private readonly discover: boolean;
  private readonly connection: ConnectionOptions;
  private readonly queues = new Map<string, Queue>();
  private flowProducer: FlowProducer | null = null;
  private adminClient: Redis | null = null;
  private readonly ownsAdminClient: boolean;

  constructor(opts: QueueRegistryOptions) {
    this.prefix = opts.prefix ?? "bull";
    this.explicit = opts.queues ?? [];
    this.discover = opts.discover ?? false;
    this.connection = opts.connection;
    // If handed a live ioredis instance, reuse it for admin SCANs; otherwise
    // build one from options and take responsibility for closing it.
    if (opts.connection instanceof IORedis) {
      this.adminClient = opts.connection;
      this.ownsAdminClient = false;
    } else {
      this.ownsAdminClient = true;
    }
  }

  getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, prefix: this.prefix });
      this.queues.set(name, queue);
    }
    return queue;
  }

  getFlowProducer(): FlowProducer {
    if (!this.flowProducer) {
      this.flowProducer = new FlowProducer({ connection: this.connection, prefix: this.prefix });
    }
    return this.flowProducer;
  }

  private admin(): Redis {
    if (!this.adminClient) {
      // Only reached when `connection` was options (an instance path sets
      // adminClient in the constructor), so this cast is sound.
      this.adminClient = new IORedis(this.connection as RedisOptions);
    }
    return this.adminClient;
  }

  /** Whether a queue's meta hash exists in Redis (without creating it). */
  async queueExists(name: string): Promise<boolean> {
    const exists = await this.admin().exists(`${this.prefix}:${name}:meta`);
    return exists === 1;
  }

  /** Whether the dashboard is permitted to expose this queue. */
  async isAllowed(name: string): Promise<boolean> {
    if (this.explicit.includes(name)) return true;
    if (!this.discover) return false;
    return this.queueExists(name);
  }

  async discoverQueueNames(): Promise<string[]> {
    const pattern = metaScanPattern(this.prefix);
    const found = new Set<string>();
    let cursor = "0";
    do {
      const [next, keys] = await this.admin().scan(cursor, "MATCH", pattern, "COUNT", SCAN_COUNT);
      cursor = next;
      for (const key of keys) {
        const name = queueNameFromMetaKey(key, this.prefix);
        if (name !== null) found.add(name);
      }
    } while (cursor !== "0");
    return [...found];
  }

  async listQueueNames(): Promise<string[]> {
    const names = new Set<string>(this.explicit);
    if (this.discover) {
      for (const name of await this.discoverQueueNames()) names.add(name);
    }
    return [...names].sort();
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
    if (this.flowProducer) {
      await this.flowProducer.close();
      this.flowProducer = null;
    }
    if (this.ownsAdminClient && this.adminClient) {
      await this.adminClient.quit().catch(() => this.adminClient?.disconnect());
      this.adminClient = null;
    }
  }
}
