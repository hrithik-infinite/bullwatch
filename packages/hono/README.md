# bullwatch-hono

Hono sub-app for **[bullwatch](https://github.com/hrithik-infinite/bullwatch)** — a deep, local-first [BullMQ](https://bullmq.io) dashboard. Works on Node, Bun, Deno, and edge runtimes.

**[▶ Live demo](https://hrithik-infinite.github.io/bullwatch/)**

```sh
npm i bullwatch-hono@beta
```

```ts
import { Hono } from "hono";
import { bullwatchHono } from "bullwatch-hono";

const app = new Hono();
app.route("/admin/queues", bullwatchHono({
  connection: { host: "localhost", port: 6379 },
  // queues: ["email", "payments"],   // omit to auto-discover
}));
```

Accepts the full [`BullwatchOptions`](https://www.npmjs.com/package/bullwatch-core)
(`connection`, `prefix`, `queues`, `readOnly`, `collectMetrics`, `mask`, `auth`, …).
Payloads are read live from Redis and never persisted; zero external network calls.

## License

MIT
