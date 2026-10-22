import { oc, type InferSchemaOutput } from "@orpc/contract";
import { call, ORPCError, type Router } from "@orpc/server";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import z from "zod";

import { eoc, implementEffect, ORPCTaggedError } from "../index";
import { withFiberContext } from "../node";

class Counter extends Context.Service<
  Counter,
  {
    readonly increment: (n: number) => Effect.Effect<number>;
  }
>()("Counter") {}

class OtherService extends Context.Service<
  OtherService,
  {
    readonly value: string;
  }
>()("OtherService") {}

const requestIdRef = Context.Reference<string>("RequestId", {
  defaultValue: () => "missing",
});

const runtime = ManagedRuntime.make(
  Layer.succeed(Counter, {
    increment: (n: number) => Effect.succeed(n + 1),
  }),
);

const overrideRuntime = ManagedRuntime.make(
  Layer.succeed(Counter, {
    increment: (n: number) => Effect.succeed(n + 10),
  }),
);

const incompatibleRuntime = ManagedRuntime.make(
  Layer.succeed(OtherService, {
    value: "nope",
  }),
);

const contract = {
  users: {
    list: oc
      .input(z.object({ amount: z.number() }))
      .output(z.object({ next: z.number(), requestId: z.string() })),
  },
};

describe("implementEffect", () => {
  it("mirrors the contract tree and adds effect support on leaves", async () => {
    const oe = implementEffect(contract, runtime);

    expect(oe.users).toBeDefined();
    expect(oe.users.list).toBeDefined();
    expect(oe.users.list.handler).toBeTypeOf("function");
    expect(oe.users.list.effect).toBeTypeOf("function");

    const procedure = oe.users.list.effect(function* ({ input }) {
      const counter = yield* Counter;
      const requestId = yield* requestIdRef;

      return {
        next: yield* counter.increment(input.amount),
        requestId,
      };
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* withFiberContext(() => call(procedure, { amount: 2 }));
      }).pipe(Effect.provideService(requestIdRef, "req-123")),
    );

    expect(result).toEqual({
      next: 3,
      requestId: "req-123",
    });
  });

  it("can implement a contract directly from a Layer", async () => {
    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const oe = implementEffect(contract, CounterLive);
    const procedure = oe.users.list.effect(function* ({ input }) {
      const counter = yield* Counter;

      return {
        next: yield* counter.increment(input.amount),
        requestId: "layer",
      };
    });

    try {
      await expect(call(procedure, { amount: 2 })).resolves.toEqual({
        next: 3,
        requestId: "layer",
      });
    } finally {
      await procedure["~effect"].runtime.dispose();
    }
  });

  it("preserves contract enforcement at the root router", async () => {
    const oe = implementEffect(contract, runtime);

    const router = oe.router({
      users: {
        list: oe.users.list.effect(function* ({ input }) {
          const counter = yield* Counter;

          return {
            next: yield* counter.increment(input.amount),
            requestId: yield* requestIdRef,
          };
        }),
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* withFiberContext(() =>
          call(router.users.list, { amount: 4 }),
        );
      }).pipe(Effect.provideService(requestIdRef, "req-456")),
    );

    expect(result).toEqual({
      next: 5,
      requestId: "req-456",
    });

    expectTypeOf(router.users.list["~effect"]).toBeObject();
    expectTypeOf(router).toExtend<
      Router<typeof contract, Record<string, never>>
    >();
  });

  it("executes a procedure with the runtime from the invoked procedure", async () => {
    const oe = implementEffect(contract, runtime);

    const procedure = oe.users.list.effect(function* ({ input }) {
      const counter = yield* Counter;

      return {
        next: yield* counter.increment(input.amount),
        requestId: yield* requestIdRef,
      };
    });

    const reboundProcedure = procedure.withRuntime(overrideRuntime);

    // @ts-expect-error replacement runtimes must provide the same services as the original procedure runtime
    procedure.withRuntime(incompatibleRuntime);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* withFiberContext(() =>
          call(reboundProcedure, { amount: 2 }),
        );
      }).pipe(Effect.provideService(requestIdRef, "req-runtime-override")),
    );

    expect(result).toEqual({
      next: 12,
      requestId: "req-runtime-override",
    });
  });

  it("maps tagged errors and raw ORPCError values the same way as EffectBuilder", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ userId: z.string() }),
    }) {}

    const taggedContract = {
      users: {
        find: eoc
          .errors({
            NOT_FOUND: UserNotFoundError,
          })
          .input(z.object({ userId: z.string() }))
          .output(z.object({ userId: z.string() })),
      },
    };

    const oe = implementEffect(taggedContract, runtime);

    const taggedProcedure = oe.users.find.effect(function* ({ input }) {
      return yield* Effect.fail(
        new UserNotFoundError({ data: { userId: input.userId } }),
      );
    });

    await expect(
      call(taggedProcedure, { userId: "u-1" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { userId: "u-1" },
    });

    const rawProcedure = oe.users.find.effect(function* () {
      return yield* Effect.fail(
        new ORPCError("FORBIDDEN", {
          data: { userId: "nope" },
        }),
      );
    });

    await expect(call(rawProcedure, { userId: "u-2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { userId: "nope" },
    });
  });

  it("preserves tagged error constructors from eoc inside effect handlers", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
    }) {}

    const taggedContract = {
      users: {
        find: eoc
          .errors({
            NOT_FOUND: UserNotFoundError,
            FORBIDDEN: {},
          })
          .input(z.object({ userId: z.string() }))
          .output(z.object({ userId: z.string() })),
      },
    };

    const oe = implementEffect(taggedContract, runtime);
    let taggedError:
      | ORPCError<"USER_NOT_FOUND_ERROR", { userId: string }>
      | undefined;
    let forbiddenError: ORPCError<"FORBIDDEN", unknown> | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.NOT_FOUND({
        data: { userId: input.userId },
      });
      forbiddenError = errors.FORBIDDEN();

      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-3" });
    await expect(result).rejects.toMatchObject({
      code: "USER_NOT_FOUND_ERROR",
      data: { userId: "u-3" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
    expect(forbiddenError).toBeInstanceOf(ORPCError);
  });

  it("preserves tagged error constructors with custom code from eoc inside effect handlers", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
      code: "NOT_FOUND",
    }) {}

    const taggedContract = {
      users: {
        find: eoc
          .errors({
            UserNotFoundError,
            FORBIDDEN: {},
          })
          .input(z.object({ userId: z.string() }))
          .output(z.object({ userId: z.string() })),
      },
    };

    const oe = implementEffect(taggedContract, runtime);
    let taggedError: ORPCError<"NOT_FOUND", { userId: string }> | undefined;
    let forbiddenError: ORPCError<"FORBIDDEN", unknown> | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.UserNotFoundError({
        data: { userId: input.userId },
      });
      forbiddenError = errors.FORBIDDEN();

      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-3" });
    await expect(result).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { userId: "u-3" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
    expect(forbiddenError).toBeInstanceOf(ORPCError);
  });

  it("preserves tagged error constructors through eoc.router contracts", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
    }) {}

    const routedContract = eoc
      .errors({
        NOT_FOUND: UserNotFoundError,
      })
      .router({
        users: {
          find: oc
            .input(z.object({ userId: z.string() }))
            .output(z.object({ userId: z.string() })),
        },
      });

    const oe = implementEffect(routedContract, runtime);
    let taggedError:
      | ORPCError<"USER_NOT_FOUND_ERROR", { userId: string }>
      | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.NOT_FOUND({ data: { userId: input.userId } });
      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-4" });
    await expect(result).rejects.toMatchObject({
      code: "USER_NOT_FOUND_ERROR",
      data: { userId: "u-4" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
  });

  it("preserves tagged error constructors with custom code through eoc.router contracts", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
      code: "NOT_FOUND",
    }) {}

    const routedContract = eoc
      .errors({
        UserNotFoundError,
      })
      .router({
        users: {
          find: oc
            .input(z.object({ userId: z.string() }))
            .output(z.object({ userId: z.string() })),
        },
      });

    const oe = implementEffect(routedContract, runtime);
    let taggedError: ORPCError<"NOT_FOUND", { userId: string }> | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.UserNotFoundError({
        data: { userId: input.userId },
      });
      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-4" });
    await expect(result).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { userId: "u-4" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
  });

  it("retains contract-first restrictions at the type level", () => {
    const oe = implementEffect(contract, runtime);

    expectTypeOf(oe.users.list.handler).toBeFunction();
    expectTypeOf(oe.users.list.effect).toBeFunction();
    // @ts-expect-error input is not a property of the implementer
    expect(oe.users.list.input).toBeUndefined();
  });

  it("enforces contract output typing for handlers", () => {
    const oe = implementEffect(contract, runtime);

    oe.users.list.effect(
      // @ts-expect-error effect() must return the contract output shape
      function* () {
        return { next: "wrong", requestId: 123 };
      },
    );

    oe.users.list.handler(
      // @ts-expect-error handler() must return the contract output shape
      () => ({ next: "wrong", requestId: 123 }),
    );

    const procedure = oe.users.list.effect(function* ({ input }) {
      return {
        next: input.amount + 1,
        requestId: "req-ok",
      };
    });

    type ProcedureOutput = InferSchemaOutput<
      NonNullable<(typeof procedure)["~orpc"]["outputSchema"]>
    >;
    expectTypeOf<ProcedureOutput>().toEqualTypeOf<{
      next: number;
      requestId: string;
    }>();
  });
});
