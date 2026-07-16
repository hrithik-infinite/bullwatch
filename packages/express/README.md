# @bullwatch/express

Express adapter for **[bullwatch](https://github.com/hrithik-infinite/bullwatch)** — a deep, local-first [BullMQ](https://bullmq.io) dashboard. Mount it on any route in one line.

**[▶ Live demo](https://hrithik-infinite.github.io/bullwatch/)**

```sh
npm i @bullwatch/express@beta
```

```ts
import express from "express";
import { bullwatchExpress } from "@bullwatch/express";

const app = express();
app.use("/admin/queues", bullwatchExpress({
  connection: { host: "localhost", port: 6379 },
  // queues: ["email", "payments"],   // omit to auto-discover
  // readOnly: true,
  // mask: ["**.token", "user.ssn"],
}));
```

Accepts the full [`BullwatchOptions`](https://www.npmjs.com/package/@bullwatch/core)
(`connection`, `prefix`, `queues`, `readOnly`, `collectMetrics`, `mask`, `auth`, …).
Payloads are read live from Redis and never persisted; zero external network calls.

## License

MIT
