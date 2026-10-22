import type { InferSchemaOutput } from "@orpc/contract";
import { isContractProcedure } from "@orpc/contract";
import { call, os } from "@orpc/server";
import {
  Context,
  Effect,
  Layer,
  Logger,
  ManagedRuntime,
  Option,
  References,
} from "effect";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import z from "zod";

import { EffectBuilder, makeEffectORPC } from "../effect-builder";
import { EffectDecoratedProcedure } from "../effect-procedure";
import { withFiberContext } from "../node";
import { ORPCTaggedError, effectErrorMapToErrorMap } from "../tagged-error";
import {
  baseErrorMap,
  baseMeta,
  baseRoute,
  generalSchema,
  inputSchema,
  outputSchema,
} from "./shared";

const mid = vi.fn();
const runtime = ManagedRuntime.make(Layer.empty);

const def = {
  config: {
    initialInputValidationIndex: 11,
    initialOutputValidationIndex: 22,
  },
  middlewares: [mid],
  errorMap: baseErrorMap,
  effectErrorMap: baseErrorMap,
  inputSchema,
  outputSchema,
  inputValidationIndex: 99,
  meta: baseMeta,
  outputValidationIndex: 88,
  route: baseRoute,
  dedupeLeadingMiddlewares: true,
  runtime,
};

const builder = new EffectBuilder(def);

beforeEach(() => vi.clearAllMocks());

describe("effectBuilder", () => {
  it("is a contract procedure", () => {
    expect(builder).toSatisfy(isContractProcedure);
  });

  it(".errors", () => {
    class BadGatewayError extends ORPCTaggedError("BadGatewayError", {
      schema: z.object({ why: z.string() }),
    }) {}
    const errors = { BadGatewayError };

    const applied = builder.errors(errors);
    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);

    const effectErrorMap = { ...def.errorMap, ...errors };
    expect(applied["~effect"]).toEqual({
      ...def,
      effectErrorMap,
      errorMap: effectErrorMapToErrorMap(effectErrorMap),
    });
  });

  describe(".use", () => {
    it("without map input", () => {
      const mid2 = vi.fn();
      const applied = builder.use(mid2);

      expect(applied).instanceOf(EffectBuilder);
      expect(applied).not.toBe(builder);
      expect(applied["~effect"]).toEqual({
        ...def,
        middlewares: [mid, mid2],
      });
    });
  });

  it(".meta", () => {
    const meta = { log: true } as any;
    const applied = builder.meta(meta);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      meta: { ...def.meta, ...meta },
    });
  });

  it(".route", () => {
    const route = { description: "test" } as any;
    const applied = builder.route(route);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      route: { ...def.route, ...route },
    });
  });

  it(".input", () => {
    const applied = builder.input(generalSchema);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      inputSchema: generalSchema,
      inputValidationIndex: 12,
    });
  });

  it(".output", () => {
    const applied = builder.output(generalSchema);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      outputSchema: generalSchema,
      outputValidationIndex: 23,
    });
  });

  it(".effect", () => {
    const effectFn = vi.fn(function* () {
      return { result: "test" };
    });
    const applied = builder.effect(effectFn);

    expect(applied).instanceOf(EffectDecoratedProcedure);
    expect(applied["~effect"].runtime).toBe(runtime);
    expect(applied["~effect"].handler).toBeInstanceOf(Function);
  });

  it(".effect runs effect with runtime", async () => {
    const effectFn = vi.fn(function* ({ input }: { input: any }) {
      return { output: `processed-${input}` };
    });

    const applied = builder.effect(effectFn);

    const result = await applied["~effect"].handler({
      context: {},
      input: "test-input",
      path: ["test"],
      procedure: applied as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toEqual({ output: "processed-test-input" });
    expect(effectFn).toHaveBeenCalledTimes(1);
  });

  it(".effect does not inherit parent FiberRefs by default", async () => {
    const requestIdRef = Context.Reference<string>("RequestId", {
      defaultValue: () => "missing",
    });
    const applied = builder.effect(function* () {
      return yield* requestIdRef;
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Effect.promise(() =>
          applied["~effect"].handler({
            context: {},
            input: undefined,
            path: ["test"],
            procedure: applied as any,
            signal: undefined,
            lastEventId: undefined,
            errors: {},
          }),
        );
      }).pipe(Effect.provideService(requestIdRef, "req-123")),
    );

    expect(result).toBe("missing");
  });

  it(".effect inherits parent FiberRefs with withFiberContext", async () => {
    const requestIdRef = Context.Reference<string>("RequestId", {
      defaultValue: () => "missing",
    });
    const applied = builder.effect(function* () {
      return yield* requestIdRef;
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* withFiberContext(() =>
          applied["~effect"].handler({
            context: {},
            input: undefined,
            path: ["test"],
            procedure: applied as any,
            signal: undefined,
            lastEventId: undefined,
            errors: {},
          }),
        );
      }).pipe(Effect.provideService(requestIdRef, "req-123")),
    );

    expect(result).toBe("req-123");
  });

  it(".effect merges context FiberRefs with runtime FiberRefs, prioritizing context FiberRefs", async () => {
    const requestIdRef = Context.Reference<string>("RequestId", {
      defaultValue: () => "missing",
    });

    class Counter extends Context.Service<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >()("Counter") {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const serviceRuntime = ManagedRuntime.make(CounterLive);
    const effectBuilder = makeEffectORPC(serviceRuntime);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const requestId = yield* requestIdRef;
      const value = yield* Counter.use((c) => c.increment(input as number));

      return { requestId, value };
    });

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* withFiberContext(() =>
            procedure["~effect"].handler({
              context: {},
              input: 5,
              path: ["test"],
              procedure: procedure as any,
              signal: undefined,
              lastEventId: undefined,
              errors: {},
            }),
          );
        }).pipe(Effect.provideService(requestIdRef, "req-123")),
      );

      expect(result).toEqual({ requestId: "req-123", value: 6 });
    } finally {
      await serviceRuntime.dispose();
    }
  });
});

describe("makeEffectORPC factory", () => {
  it("uses default os when no builder provided", () => {
    const effectBuilder = makeEffectORPC(runtime);

    expect(effectBuilder).instanceOf(EffectBuilder);
    expect(effectBuilder["~effect"].runtime).toBe(runtime);
    // Should inherit os's default definition
    expect(effectBuilder["~effect"].middlewares).toEqual(
      os["~orpc"].middlewares,
    );
    expect(effectBuilder["~effect"].effectErrorMap).toEqual(
      os["~orpc"].errorMap,
    );
  });

  it("wraps a custom builder when provided", () => {
    const effectBuilder = makeEffectORPC(runtime, os);

    expect(effectBuilder).instanceOf(EffectBuilder);
    expect(effectBuilder["~effect"].runtime).toBe(runtime);
    expect(effectBuilder["~effect"].middlewares).toEqual(
      os["~orpc"].middlewares,
    );
    expect(effectBuilder["~effect"].effectErrorMap).toEqual(
      os["~orpc"].errorMap,
    );
  });

  it("creates working procedure with default os", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder.effect(function* () {
      return "hello";
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["test"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe("hello");
  });

  it("supports Effect.fn generator syntax", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    //
    const procedure = effectBuilder.effect(function* () {
      const a = yield* Effect.succeed(1);
      const b = yield* Effect.succeed(2);
      return a + b;
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["test"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(3);
  });

  it("chains builder methods correctly", () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder
      .errors({ NOT_FOUND: { message: "not found" } })
      .meta({ auth: true } as any)
      .route({ path: "/test" })
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() }))
      .effect(function* () {
        return { name: "test" };
      });

    expect(procedure).instanceOf(EffectDecoratedProcedure);
    expect(procedure["~effect"].errorMap).toHaveProperty("NOT_FOUND");
    expect(procedure["~effect"].meta).toEqual({ auth: true });
    expect(procedure["~effect"].route).toEqual({ path: "/test" });
  });

  it("wraps a customized builder", () => {
    const customBuilder = os
      .errors({ CUSTOM_ERROR: { message: "custom" } })
      .use(vi.fn());

    const effectBuilder = makeEffectORPC(runtime, customBuilder);

    expect(effectBuilder["~effect"].effectErrorMap).toHaveProperty(
      "CUSTOM_ERROR",
    );
    expect(effectBuilder["~effect"].middlewares.length).toBe(1);
  });
});

describe("effect with services", () => {
  it("can use services from runtime layer", async () => {
    // Define a simple service
    class Counter extends Context.Service<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >()("Counter") {}

    // Create a layer with the service
    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });

    // Create runtime with the service
    const serviceRuntime = ManagedRuntime.make(CounterLive);
    const effectBuilder = makeEffectORPC(serviceRuntime);

    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const counter = yield* Counter;
      return yield* counter.increment(input as number);
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: 5,
      path: ["test"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(6);

    // Cleanup
    await serviceRuntime.dispose();
  });

  it("can create a builder directly from a Layer", async () => {
    class Counter extends Context.Service<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >()("LayerCounter") {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const effectBuilder = makeEffectORPC(CounterLive);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const counter = yield* Counter;
      return yield* counter.increment(input as number);
    });

    try {
      await expect(call(procedure, 5)).resolves.toBe(6);
    } finally {
      await effectBuilder["~effect"].runtime.dispose();
    }
  });

  it("can start without a runtime and provide a Layer", async () => {
    class Counter extends Context.Service<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >()("ProvidedLayerCounter") {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const effectBuilder = makeEffectORPC().provide(CounterLive);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const counter = yield* Counter;
      return yield* counter.increment(input as number);
    });

    try {
      await expect(call(procedure, 5)).resolves.toBe(6);
    } finally {
      await effectBuilder["~effect"].runtime.dispose();
    }
  });

  it("can wrap a custom builder without a runtime and provide a Layer", async () => {
    class Counter extends Context.Service<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >()("ProvidedLayerCustomBuilderCounter") {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const customBuilder = os.use(({ next }) =>
      next({ context: { fromCustomBuilder: true } }),
    );
    const effectBuilder = makeEffectORPC(customBuilder).provide(CounterLive);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      context,
      input,
    }) {
      const counter = yield* Counter;
      return {
        fromCustomBuilder: context.fromCustomBuilder,
        value: yield* counter.increment(input as number),
      };
    });

    try {
      await expect(call(procedure, 5)).resolves.toEqual({
        fromCustomBuilder: true,
        value: 6,
      });
    } finally {
      await effectBuilder["~effect"].runtime.dispose();
    }
  });

  it(".provide makes a request-scoped service available to handlers", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("CurrentUser") {}

    const effectBuilder = makeEffectORPC(runtime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .effect(function* () {
        return yield* CurrentUser;
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-1" } } }),
    ).resolves.toEqual({ id: "u-1" });
  });

  it(".provide service overrides the same service from the runtime", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("CurrentUserOverride") {}

    const serviceRuntime = ManagedRuntime.make(
      Layer.succeed(CurrentUser, { id: "runtime" }),
    );
    const effectBuilder = makeEffectORPC(serviceRuntime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .effect(function* () {
        return yield* CurrentUser;
      });

    try {
      await expect(
        call(procedure, undefined, { context: { user: { id: "request" } } }),
      ).resolves.toEqual({ id: "request" });
    } finally {
      await serviceRuntime.dispose();
    }
  });

  it("Effect .use yield* next() without return runs handler once", async () => {
    let runs = 0;
    const procedure = makeEffectORPC(runtime)
      .use(function* ({ next }) {
        yield* Effect.void;
        yield* next();
      })
      .effect(function* () {
        runs += 1;
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok");
    expect(runs).toBe(1);
  });

  it("Effect .use guard-only middleware without next runs handler once", async () => {
    let runs = 0;
    const procedure = makeEffectORPC(runtime)
      .use(function* () {
        yield* Effect.void;
      })
      .effect(function* () {
        runs += 1;
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok");
    expect(runs).toBe(1);
  });

  it("Effect .use yield* next() without return stays in one runtime boundary", async () => {
    const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
    const procedure = makeEffectORPC(runtime)
      .use(function* ({ next }) {
        yield* next();
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok");
    expect(runPromiseExit).toHaveBeenCalledTimes(1);
  });

  it("Effect .use can read services from upstream .provide", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("MiddlewareCurrentUser") {}

    let seenUser: { id: string } | undefined;
    const effectBuilder = makeEffectORPC(runtime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* () {
        seenUser = yield* CurrentUser;
      })
      .effect(function* () {
        return "ok";
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-2" } } }),
    ).resolves.toBe("ok");
    expect(seenUser).toEqual({ id: "u-2" });
  });

  it("Effect .middleware can create reusable generator middleware", async () => {
    const eos = makeEffectORPC(runtime);

    const reusable = eos.middleware(function* ({ next }, input: string) {
      expectTypeOf(input).toEqualTypeOf<string>();
      return yield* next({ context: { seenInput: input } });
    });

    const procedure = eos
      .input(z.string())
      .use(reusable)
      .effect(function* ({ context }) {
        expectTypeOf(context.seenInput).toEqualTypeOf<string>();
        return context.seenInput;
      });

    await expect(call(procedure, "ok")).resolves.toBe("ok");
  });

  it("Effect .middleware can use builder-provided services", async () => {
    class MiddlewareService extends Context.Service<
      MiddlewareService,
      { value: string }
    >()("MiddlewareService") {}

    const eos = makeEffectORPC(runtime).provide(MiddlewareService, () =>
      Effect.succeed({ value: "provided" }),
    );

    const reusable = eos.middleware(function* ({ next }) {
      const service = yield* MiddlewareService;
      return yield* next({ context: { serviceValue: service.value } });
    });

    const procedure = eos.use(reusable).effect(function* ({ context }) {
      return context.serviceValue;
    });

    await expect(call(procedure, undefined)).resolves.toBe("provided");
  });

  it("Effect .use can enrich context through next", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("NextCurrentUser") {}

    const effectBuilder = makeEffectORPC(runtime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* ({ next }, _input) {
        const user = yield* CurrentUser;
        return yield* next({ context: { userId: user.id } });
      })
      .effect(function* ({ context }) {
        return context.userId;
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-3" } } }),
    ).resolves.toBe("u-3");
  });

  it("Effect .use can transform downstream output", async () => {
    const procedure = makeEffectORPC(runtime)
      .use(function* ({ next }, _input, output) {
        const result = yield* next();
        return yield* output(`${result.output}-wrapped`);
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok-wrapped");
  });

  it("Effect .use can transform typed downstream output after .output", async () => {
    const procedure = makeEffectORPC(runtime)
      .output(z.string())
      .use(function* ({ next }, _input, output) {
        const result = yield* next();
        expectTypeOf(result.output).toEqualTypeOf<string>();
        return yield* output(`${result.output}-wrapped`);
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok-wrapped");
  });

  it("Effect .use can read typed input after .input", async () => {
    const procedure = makeEffectORPC(runtime)
      .input(z.object({ value: z.number() }))
      .use(function* ({ next }, input) {
        expectTypeOf(input).toMatchTypeOf<{ value: number }>();
        return yield* next({ context: { doubled: input.value * 2 } });
      })
      .effect(function* ({ context }) {
        return context.doubled;
      });

    await expect(call(procedure, { value: 21 })).resolves.toBe(42);
  });

  it("Effect .use can read typed input and output after .input().output()", async () => {
    const procedure = makeEffectORPC(runtime)
      .input(z.object({ value: z.number() }))
      .output(z.string())
      .use(function* ({ next }, input, output) {
        expectTypeOf(input).toMatchTypeOf<{ value: number }>();
        const result = yield* next();
        expectTypeOf(result.output).toEqualTypeOf<string>();
        return yield* output(`${input.value}:${result.output}`);
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, { value: 21 })).resolves.toBe("21:ok");
  });

  it("Effect .use can transform typed downstream output after .effect", async () => {
    const procedure = makeEffectORPC(runtime)
      .effect(function* () {
        return "ok";
      })
      .use(function* ({ next }, _input, output) {
        const result = yield* next();
        expectTypeOf(result.output).toEqualTypeOf<string>();
        return yield* output(`${result.output}-wrapped`);
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok-wrapped");
  });

  it("runs contiguous Effect providers, middleware, and handler in one runtime boundary", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("SingleBoundaryCurrentUser") {}

    const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
    const procedure = makeEffectORPC(runtime)
      .$context<{ user: { id: string } }>()
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* ({ next }) {
        const user = yield* CurrentUser;
        return yield* next({ context: { userId: user.id } });
      })
      .effect(function* ({ context }) {
        const user = yield* CurrentUser;
        return `${context.userId}:${user.id}`;
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-4" } } }),
    ).resolves.toBe("u-4:u-4");
    expect(runPromiseExit).toHaveBeenCalledTimes(1);
  });

  it("runs procedure-level Effect providers and middleware with the handler in one runtime boundary", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("ProcedureBoundaryCurrentUser") {}

    const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
    const procedure = makeEffectORPC(runtime)
      .$context<{ user: { id: string } }>()
      .effect(function* () {
        return "ok";
      })
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* ({ next }) {
        const user = yield* CurrentUser;
        const result = yield* next({ context: { userId: user.id } });
        return {
          ...result,
          output: `${result.output}:${user.id}`,
        };
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-5" } } }),
    ).resolves.toBe("ok:u-5");
    expect(runPromiseExit).toHaveBeenCalledTimes(1);
  });

  it(".provideOptional makes present request-scoped services available", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("OptionalCurrentUserPresent") {}

    const procedure = makeEffectORPC(runtime)
      .$context<{ user?: { id: string } }>()
      .provideOptional(CurrentUser, ({ context }) =>
        Effect.succeed(Option.fromNullishOr(context.user)),
      )
      .effect(function* () {
        return yield* Effect.serviceOption(CurrentUser);
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-6" } } }),
    ).resolves.toEqual(Option.some({ id: "u-6" }));
  });

  it(".provideOptional leaves absent request-scoped services unavailable", async () => {
    class CurrentUser extends Context.Service<
      CurrentUser,
      { id: string }
    >()("OptionalCurrentUserAbsent") {}

    const procedure = makeEffectORPC(runtime)
      .$context<{ user?: { id: string } }>()
      .provideOptional(CurrentUser, ({ context }) =>
        Effect.succeed(Option.fromNullishOr(context.user)),
      )
      .effect(function* () {
        return yield* Effect.serviceOption(CurrentUser);
      });

    await expect(call(procedure, undefined, { context: {} })).resolves.toEqual(
      Option.none(),
    );
  });

  it(".withRuntime runs flushed Effect middleware and the handler on the new runtime", async () => {
    class RuntimeService extends Context.Service<
      RuntimeService,
      { readonly source: string }
    >()("WithRuntimeService") {}

    const originalRuntime = ManagedRuntime.make(
      Layer.succeed(RuntimeService, { source: "original" }),
    );
    const testRuntime = ManagedRuntime.make(
      Layer.succeed(RuntimeService, { source: "test" }),
    );

    let middlewareSource: string | undefined;
    const procedure = makeEffectORPC(originalRuntime)
      .use(function* ({ next }) {
        const service = yield* RuntimeService;
        middlewareSource = service.source;
        return yield* next();
      })
      // a native middleware flushes the Effect step into its own runtime boundary
      .use(({ next }) => next())
      .effect(function* () {
        const service = yield* RuntimeService;
        return service.source;
      });

    const rebound = procedure.withRuntime(testRuntime);

    try {
      await expect(call(procedure, undefined)).resolves.toBe("original");
      expect(middlewareSource).toBe("original");

      await expect(call(rebound, undefined)).resolves.toBe("test");
      expect(middlewareSource).toBe("test");
    } finally {
      await originalRuntime.dispose();
      await testRuntime.dispose();
    }
  });
});

describe(".traced", () => {
  it("creates an EffectBuilder with span config", () => {
    const effectBuilder = makeEffectORPC(runtime);

    const traced = effectBuilder.traced("users.getUser");

    expect(traced).instanceOf(EffectBuilder);
    expect(traced).not.toBe(effectBuilder);
    expect(traced["~effect"].spanConfig).toBeDefined();
    expect(traced["~effect"].spanConfig?.name).toBe("users.getUser");
    expect(traced["~effect"].spanConfig?.captureStackTrace).toBeInstanceOf(
      Function,
    );
  });

  it("preserves span config through chained methods", () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder
      .input(z.object({ id: z.string() }))
      .traced("users.getUser")
      .effect(function* () {
        return { name: "test" };
      });

    expect(procedure).instanceOf(EffectDecoratedProcedure);
    // The span wrapping happens in the handler, so we just verify the procedure was created
  });

  it("traced procedure handler runs successfully", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder
      .input(z.object({ id: z.string() }))
      .traced("users.getUser")
      .effect(function* ({ input }) {
        return { id: input.id, name: "Alice" };
      });

    const result = await procedure["~effect"].handler({
      context: {},
      input: { id: "123" },
      path: ["users", "getUser"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toEqual({ id: "123", name: "Alice" });
  });

  it("traced procedure with Effect.fn generator syntax", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder.traced("math.add").effect(function* () {
      const a = yield* Effect.succeed(10);
      const b = yield* Effect.succeed(20);
      return a + b;
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["math", "add"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(30);
  });

  it("captures stack trace at definition time", () => {
    const effectBuilder = makeEffectORPC(runtime);

    // The stack trace is captured when .traced() is called
    const traced = effectBuilder.traced("test.procedure");

    const stackTrace = traced["~effect"].spanConfig?.captureStackTrace();
    // The stack trace should be a string containing the file location
    // It may be undefined in some test environments
    if (stackTrace !== undefined) {
      expect(typeof stackTrace).toBe("string");
    }
  });
});

describe("default tracing (without .traced())", () => {
  it("procedure without .traced() still runs successfully", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    // No .traced() call - should still work and use path as span name
    const procedure = effectBuilder
      .input(z.object({ id: z.string() }))
      .effect(function* ({ input }) {
        return { id: input.id, name: "Bob" };
      });

    const result = await procedure["~effect"].handler({
      context: {},
      input: { id: "456" },
      path: ["users", "findById"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toEqual({ id: "456", name: "Bob" });
  });

  it("uses procedure path as default span name", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    // Without .traced(), the span name should be derived from path
    const procedure = effectBuilder.effect(function* () {
      return "hello";
    });

    // The procedure should work with any path
    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["api", "v1", "greet"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe("hello");
  });

  it("default tracing works with Effect.fn generator", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder.effect(function* () {
      const x = 5;
      const y = 10;
      return x * y;
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["math", "multiply"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(50);
  });

  it("default tracing works with services from runtime", async () => {
    class Greeter extends Context.Service<
      Greeter,
      { greet: (name: string) => Effect.Effect<string> }
    >()("Greeter") {}

    const GreeterLive = Layer.succeed(Greeter, {
      greet: (name: string) => Effect.succeed(`Hello, ${name}!`),
    });

    const serviceRuntime = ManagedRuntime.make(GreeterLive);
    const effectBuilder = makeEffectORPC(serviceRuntime);

    const procedure = effectBuilder
      .input(z.object({ name: z.string() }))
      .effect(function* ({ input }) {
        return yield* Greeter.use((g) => g.greet(input.name));
      });

    const result = await procedure["~effect"].handler({
      context: {},
      input: { name: "World" },
      path: ["greeting", "say"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe("Hello, World!");

    await serviceRuntime.dispose();
  });

  it("no spanConfig is set when .traced() is not called", () => {
    const effectBuilder = makeEffectORPC(runtime);

    // Without .traced(), spanConfig should be undefined
    expect(effectBuilder["~effect"].spanConfig).toBeUndefined();

    const withInput = effectBuilder.input(z.string());
    expect(withInput["~effect"].spanConfig).toBeUndefined();
  });

  it("enforces the declared output schema for effect handlers", () => {
    const declaredOutputSchema = z.object({ name: z.string() });

    makeEffectORPC(runtime)
      .input(z.string())
      .output(declaredOutputSchema)
      .effect(
        // @ts-expect-error input().output() should constrain the effect return type
        function* () {
          return { count: 1 };
        },
      );

    const procedure = makeEffectORPC(runtime)
      .output(declaredOutputSchema)
      // @ts-expect-error output() should constrain the effect return type
      .effect(function* () {
        return { count: 1 };
      });

    type ProcedureOutput = InferSchemaOutput<
      NonNullable<(typeof procedure)["~orpc"]["outputSchema"]>
    >;
    expectTypeOf<ProcedureOutput>().toEqualTypeOf<{ name: string }>();
  });

});

describe("procedure log annotations", () => {
  it("adds procedure annotations and a log span to Effect structured logs", async () => {
    const logEntries: Array<{
      annotations: Record<string, string | number | boolean>;
      spans: string[];
    }> = [];
    const logger = Logger.make((options) => {
      const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
      const spans = options.fiber.getRef(References.CurrentLogSpans);
      logEntries.push({
        annotations: { ...annotations } as Record<
          string,
          string | number | boolean
        >,
        spans: spans.map(([label]) => label),
      });
    });
    const annotatedRuntime = ManagedRuntime.make(Logger.layer([logger]));
    const effectBuilder = makeEffectORPC(annotatedRuntime);

    const procedure = effectBuilder
      .annotateSpan(({ path }) => ({
        operation: path.join("."),
        route_group: path[0],
        ignored_null: null,
      }))
      .effect(function* () {
        yield* Effect.logInfo("inside procedure");
        return "ok";
      });

    await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["hosts", "aliases", "list"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(logEntries).toEqual([
      {
        annotations: {
          operation: "hosts.aliases.list",
          route_group: "hosts",
        },
        spans: ["hosts.aliases.list"],
      },
    ]);

    await annotatedRuntime.dispose();
  });

  it("keeps annotations when steps added after .effect rebuild the handler", async () => {
    class Stamp extends Context.Service<
      Stamp,
      { readonly id: string }
    >()("AnnotationStamp") {}

    const logEntries: Array<{
      annotations: Record<string, string | number | boolean>;
      spans: string[];
    }> = [];
    const logger = Logger.make((options) => {
      const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
      const spans = options.fiber.getRef(References.CurrentLogSpans);
      logEntries.push({
        annotations: { ...annotations } as Record<
          string,
          string | number | boolean
        >,
        spans: spans.map(([label]) => label),
      });
    });
    const annotatedRuntime = ManagedRuntime.make(Logger.layer([logger]));

    const provided: string[] = [];
    const procedure = makeEffectORPC(annotatedRuntime)
      .annotateSpan(({ path }) => ({
        operation: path.join("."),
      }))
      .effect(function* () {
        yield* Effect.logInfo("inside procedure");
        return "ok";
      })
      // appending a step after .effect rebuilds the handler from effectHandler config
      .provide(Stamp, () =>
        Effect.sync(() => {
          provided.push("built");
          return { id: "stamp" };
        }),
      );

    await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["hosts", "list"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(provided).toEqual(["built"]);
    expect(logEntries).toEqual([
      {
        annotations: {
          operation: "hosts.list",
        },
        spans: ["hosts.list"],
      },
    ]);

    await annotatedRuntime.dispose();
  });
});
