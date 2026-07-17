import { type DynamicModule, Inject, Module, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { type BullwatchOptions, bullwatchExpress } from "bullwatch-express";

export type { BullwatchOptions } from "bullwatch-express";

export interface BullwatchModuleOptions extends BullwatchOptions {
  /** Base path to mount the dashboard on. Default: `/admin/queues`. */
  path?: string;
}

const BULLWATCH_OPTIONS = "BULLWATCH_MODULE_OPTIONS";

/**
 * NestJS module for the bullwatch dashboard.
 *
 *   @Module({
 *     imports: [
 *       BullwatchModule.forRoot({
 *         path: "/admin/queues",
 *         connection: { host: "localhost", port: 6379 },
 *       }),
 *     ],
 *   })
 *   export class AppModule {}
 *
 * Requires the default Express platform (`@nestjs/platform-express`). The module
 * mounts the thin `bullwatch-express` middleware on the underlying Express
 * instance, so Express strips the base path and the framework-agnostic core
 * handler in `bullwatch-core` sees `/api/...` regardless of the mount point.
 *
 * Every constructor dependency is injected by explicit token, so the module
 * works without `emitDecoratorMetadata`.
 */
@Module({})
export class BullwatchModule implements OnModuleInit {
  constructor(
    @Inject(BULLWATCH_OPTIONS) private readonly options: BullwatchModuleOptions,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  static forRoot(options: BullwatchModuleOptions): DynamicModule {
    return {
      module: BullwatchModule,
      providers: [{ provide: BULLWATCH_OPTIONS, useValue: options }],
    };
  }

  onModuleInit(): void {
    const { path = "/admin/queues", ...options } = this.options;
    const instance = this.adapterHost.httpAdapter?.getInstance<{
      use: (path: string, handler: unknown) => unknown;
    }>();
    if (!instance || typeof instance.use !== "function") {
      throw new Error(
        "bullwatch-nestjs requires the Express platform (@nestjs/platform-express); " +
          "the HTTP adapter did not expose an Express `use()`.",
      );
    }
    instance.use(path, bullwatchExpress(options));
  }
}
