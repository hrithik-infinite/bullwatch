# @bullwatch/fastify

Fastify plugin for **[bullwatch](https://github.com/hrithik-infinite/bullwatch)** — a deep, local-first [BullMQ](https://bullmq.io) dashboard.

**[▶ Live demo](https://hrithik-infinite.github.io/bullwatch/)**

```sh
npm i @bullwatch/fastify@beta
```

```ts
import Fastify from "fastify";
import { bullwatchFastify } from "@bullwatch/fastify";

const app = Fastify();
app.register(bullwatchFastify({
  connection: { host: "localhost", port: 6379 },
  // queues: ["email", "payments"],   // omit to auto-discover
}), { prefix: "/admin/queues" });
```

Accepts the full [`BullwatchOptions`](https://www.npmjs.com/package/@bullwatch/core)
(`connection`, `prefix`, `queues`, `readOnly`, `collectMetrics`, `mask`, `auth`, …).
Payloads are read live from Redis and never persisted; zero external network calls.

## License

MIT
