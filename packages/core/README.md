# @bullwatch/core

Core server, storage, and framework-agnostic HTTP handler for **[bullwatch](https://github.com/hrithik-infinite/bullwatch)** — a deep, local-first dashboard for [BullMQ](https://bullmq.io).

**[▶ Live demo](https://hrithik-infinite.github.io/bullwatch/)**

Most users want a framework adapter or the standalone server, not this package directly:

- [`bullwatch`](https://www.npmjs.com/package/bullwatch) — standalone `npx` / Docker server
- [`@bullwatch/express`](https://www.npmjs.com/package/@bullwatch/express)
- [`@bullwatch/fastify`](https://www.npmjs.com/package/@bullwatch/fastify)
- [`@bullwatch/hono`](https://www.npmjs.com/package/@bullwatch/hono)

## Direct use

`createBullwatch` returns an app exposing a standard `fetch(request): Promise<Response>` handler, so it mounts anywhere the Web Fetch API is available.

```ts
import { createBullwatch } from "@bullwatch/core";

const app = createBullwatch({
  connection: { host: "localhost", port: 6379 },
  // queues: ["email", "payments"],   // omit to auto-discover
  readOnly: false,
  collectMetrics: true,
  mask: ["**.token", "user.ssn"],     // redacted at render AND before search matching
});

const res = await app.fetch(new Request("http://x/api/queues"));
```

Payloads are read live from Redis, rendered, and never written to disk; the store boundary is typed so nothing sensitive can be persisted. Shipped bundles make **zero external network calls** (enforced in CI).

## License

MIT
