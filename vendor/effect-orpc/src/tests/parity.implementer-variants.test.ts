import type { Client, ORPCError } from "@orpc/client";
import type { ErrorFromErrorMap } from "@orpc/contract";
import type {
  ActionableClient,
  ActionableError,
  ImplementedProcedure,
  Middleware,
  MiddlewareOutputFn,
  ProcedureImplementer,
} from "@orpc/server";
import { describe, expectTypeOf, it } from "vitest";

import { implementEffect } from "../index";
import type { InitialContext } from "./parity-shared";
import { runtime, typedContract } from "./parity-shared";
import {
  type AssertExtends,
  baseErrorMap,
  type BaseMeta,
  inputSchema,
  outputSchema,
} from "./shared";

const implementer = implementEffect(typedContract, runtime)
  .$context<InitialContext>()
  .use(({ next }) => next({ context: { auth: true as boolean } }));

describe("parity: @orpc/server implementer-procedure.test-d.ts", () => {
  const builder = implementer.ping;

  it("backward compatibility", () => {
		expectTypeOf<keyof typeof builder>().toEqualTypeOf<
			"~orpc" | "handler" | "use" | "effect" | "annotateSpan"
		>();
	});

  it("is a contract procedure", () => {
    expectTypeOf(builder["~orpc"]).toBeObject();
  });

  it("extends the matching upstream implementer interface", () => {
    expectTypeOf<
      AssertExtends<
        typeof builder,
        ProcedureImplementer<
          InitialContext & Record<never, never>,
          InitialContext & { auth: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >
    >().toEqualTypeOf<true>();
  });

  describe(".use", () => {
    it("without map input", () => {
      expectTypeOf(
        builder.use(
          (
            { context, next, path, procedure, errors, signal },
            input,
            output,
          ) => {
            expectTypeOf(input).toEqualTypeOf<{ input: string }>();
            expectTypeOf(context).toEqualTypeOf<
              InitialContext & { auth: boolean }
            >();
            expectTypeOf(path).toExtend<readonly string[]>();
            expectTypeOf(procedure).toBeObject();
            expectTypeOf(output).toBeFunction();
            expectTypeOf<
              AssertExtends<
                ReturnType<typeof errors.BASE>,
                ORPCError<"BASE", { output: number }>
              >
            >().toEqualTypeOf<true>();
            expectTypeOf<
              AssertExtends<
                ReturnType<typeof errors.OVERRIDE>,
                ORPCError<"OVERRIDE", any>
              >
            >().toEqualTypeOf<true>();
            expectTypeOf(signal).toExtend<AbortSignal | undefined>();

            return next({ context: { extra: true } });
          },
        ),
      ).toBeObject();

      builder.use(
        // @ts-expect-error - invalid TInContext
        {} as Middleware<{ auth: "invalid" }, any, any, any, any, any>,
      );
      // @ts-expect-error - input is not match
      builder.use(({ next }, _input: "invalid") => next({}));
      // @ts-expect-error - output is not match
      builder.use(({ next }, _input, _output: MiddlewareOutputFn<"invalid">) =>
        next({}),
      );
      // @ts-expect-error - conflict context
      builder.use(({ next }) => next({ context: { db: undefined } }));
    });

    it("with map input", () => {
      expectTypeOf(
        builder.use(
          (
            { context, next, path, procedure, errors, signal },
            input: { mapped: boolean },
            output,
          ) => {
            expectTypeOf(input).toEqualTypeOf<{ mapped: boolean }>();
            expectTypeOf(context).toEqualTypeOf<
              InitialContext & { auth: boolean }
            >();
            expectTypeOf(path).toExtend<readonly string[]>();
            expectTypeOf(procedure).toBeObject();
            expectTypeOf(output).toBeFunction();
            expectTypeOf<
              AssertExtends<
                ReturnType<typeof errors.BASE>,
                ORPCError<"BASE", { output: number }>
              >
            >().toEqualTypeOf<true>();
            expectTypeOf<
              AssertExtends<
                ReturnType<typeof errors.OVERRIDE>,
                ORPCError<"OVERRIDE", any>
              >
            >().toEqualTypeOf<true>();
            expectTypeOf(signal).toExtend<AbortSignal | undefined>();

            return next({ context: { extra: true } });
          },
          (input) => {
            expectTypeOf(input).toEqualTypeOf<{ input: string }>();
            return { mapped: true };
          },
        ),
      ).toBeObject();
    });

    it("with TInContext", () => {
      const mid = {} as Middleware<
        { cacheable?: boolean } & Record<never, never>,
        Record<never, never>,
        unknown,
        any,
        any,
        BaseMeta
      >;

      expectTypeOf(builder.use(mid)).toBeObject();
    });
  });

  it(".handler returns an implemented procedure", () => {
    const handled = builder.handler(
      ({ input, context, procedure, path, signal, errors }) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>();
        expectTypeOf(context).toEqualTypeOf<
          InitialContext & { auth: boolean }
        >();
        expectTypeOf(procedure).toBeObject();
        expectTypeOf(path).toExtend<readonly string[]>();
        expectTypeOf(signal).toExtend<AbortSignal | undefined>();
        expectTypeOf<
          AssertExtends<
            ReturnType<typeof errors.BASE>,
            ORPCError<"BASE", { output: number }>
          >
        >().toEqualTypeOf<true>();
        expectTypeOf<
          AssertExtends<
            ReturnType<typeof errors.OVERRIDE>,
            ORPCError<"OVERRIDE", any>
          >
        >().toEqualTypeOf<true>();

        return { output: 456 };
      },
    );

    expectTypeOf<
      AssertExtends<
        typeof handled,
        ImplementedProcedure<
          InitialContext & Record<never, never>,
          InitialContext & { auth: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >
    >().toEqualTypeOf<true>();

    expectTypeOf(handled.use).toBeFunction();
    expectTypeOf(handled.callable).toBeFunction();
    expectTypeOf(handled.actionable).toBeFunction();
    const callable = handled.callable({
      context: async (_clientContext: { batch?: boolean }) => ({
        db: "postgres",
      }),
    });

    expectTypeOf<
      AssertExtends<
        typeof callable,
        Client<
          { batch?: boolean },
          { input: number },
          { output: string },
          ErrorFromErrorMap<typeof baseErrorMap>
        >
      >
    >().toEqualTypeOf<true>();

    const actionable = handled.actionable({
      context: async (_clientContext: { batch?: boolean }) => ({
        db: "postgres",
      }),
    });

    expectTypeOf<
      AssertExtends<
        typeof actionable,
        ActionableClient<
          { input: number },
          { output: string },
          ActionableError<ErrorFromErrorMap<typeof baseErrorMap>>
        >
      >
    >().toEqualTypeOf<true>();
  });
});

describe("parity: @orpc/server implementer-variants.test-d.ts", () => {
  it("router-level .use returns an internal implementer", () => {
    const applied = implementer.nested.use(({ next }) =>
      next({ context: { extra: true } }),
    );

    expectTypeOf(applied).toBeObject();
    expectTypeOf(applied.ping.handler).toBeFunction();
  });
});
