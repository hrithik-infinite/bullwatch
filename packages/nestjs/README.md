# bullwatch-nestjs

NestJS module for **[bullwatch](https://github.com/hrithik-infinite/bullwatch)** — a deep, local-first [BullMQ](https://bullmq.io) dashboard.

**[▶ Live demo](https://hrithik-infinite.github.io/bullwatch/)**

```sh
npm i bullwatch-nestjs@beta
```

```ts
import { Module } from "@nestjs/common";
import { BullwatchModule } from "bullwatch-nestjs";

@Module({
  imports: [
    BullwatchModule.forRoot({
      path: "/admin/queues",                       // default: /admin/queues
      connection: { host: "localhost", port: 6379 },
      // queues: ["email", "payments"],            // omit to auto-discover
      // readOnly: true, mask: ["**.token", "user.ssn"],
    }),
  ],
})
export class AppModule {}
```

The dashboard is then served under the mount path (e.g. `GET /admin/queues/api/health`).

Requires the default **Express platform** (`@nestjs/platform-express`). Under the hood the module mounts the thin `bullwatch-express` middleware on the underlying Express instance, so the framework-agnostic core handler sees `/api/...` regardless of the mount point. Accepts the full [`BullwatchOptions`](https://www.npmjs.com/package/bullwatch-core) (`connection`, `prefix`, `queues`, `readOnly`, `collectMetrics`, `mask`, `auth`, …) plus `path`.

Payloads are read live from Redis and never persisted; zero external network calls.

## License

MIT
