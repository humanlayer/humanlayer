import type { Middleware, MiddlewareOutputFn, Procedure } from "@orpc/server";
import { describe, expectTypeOf, it } from "vitest";

import { makeEffectORPC } from "../index";
import type { CurrentContext, InitialContext } from "./parity-shared";
import { runtime } from "./parity-shared";
import {
  type AssertExtends,
  baseErrorMap,
  type BaseMeta,
  inputSchema,
  outputSchema,
} from "./shared";

const authMiddleware: Middleware<
  InitialContext,
  { auth: boolean },
  { input: string },
  unknown,
  any,
  BaseMeta
> = ({ next }) => next({ context: { auth: true as boolean } });

const procedure = makeEffectORPC(runtime)
  .$context<InitialContext>()
  .$meta({ mode: "dev" } as BaseMeta)
  .$input(inputSchema)
  .errors(baseErrorMap)
  .use(authMiddleware)
  .output(outputSchema)
  .effect(function* () {
    return { output: 456 };
  });

describe("parity: @orpc/server procedure-decorated.test-d.ts", () => {
  it("is a procedure", () => {
    expectTypeOf<
      AssertExtends<
        typeof procedure,
        Procedure<
          InitialContext & Record<never, never>,
          CurrentContext,
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >
    >().toEqualTypeOf<true>();
  });

  it(".errors / .meta / .route", () => {
    expectTypeOf(
      procedure.errors({
        BAD_GATEWAY: { message: "BAD_GATEWAY" },
        OVERRIDE: { message: "OVERRIDE" },
      }),
    ).toBeObject();

    expectTypeOf(procedure.meta({ mode: "dev", log: true })).toBeObject();
    expectTypeOf(
      procedure.route({ method: "POST", path: "/v2/users", tags: ["tag"] }),
    ).toBeObject();

    // @ts-expect-error - invalid meta
    procedure.meta({ log: "INVALID" });
    // @ts-expect-error - invalid method
    procedure.route({ method: "INVALID" });
  });

  describe(".use", () => {
    it("without map input", () => {
      const middleware: Middleware<
        CurrentContext,
        { extra: boolean },
        { input: string },
        { output: number },
        any,
        BaseMeta
      > = ({ next }, input, output) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>();
        expectTypeOf(output).toBeFunction();
        return next({ context: { extra: true } });
      };

      expectTypeOf(procedure.use(middleware)).toBeObject();

      procedure.use(
        // @ts-expect-error - invalid TInContext
        {} as Middleware<{ auth: "invalid" }, any, any, any, any, any>,
      );
      // @ts-expect-error - input is not match
      procedure.use(({ next }, _input: "invalid") => next({}));
      procedure.use(
        // @ts-expect-error - output is not match
        ({ next }, _input, _output: MiddlewareOutputFn<"invalid">) => next({}),
      );
      // @ts-expect-error - conflict context
      procedure.use(({ next }) => next({ context: { db: undefined } }));
    });

    it("with map input", () => {
      expectTypeOf(
        procedure.use(
          ({ next }, input: { mapped: string }, output) => {
            expectTypeOf(input).toEqualTypeOf<{ mapped: string }>();
            expectTypeOf(output).toBeFunction();
            return next({ context: { extra: true } });
          },
          (input) => ({ mapped: input.input }),
        ),
      ).toBeObject();
    });
  });

  it(".callable / .actionable", () => {
    expectTypeOf(
      procedure.callable({
        context: async (_clientContext: { batch?: boolean }) => ({
          db: "postgres",
        }),
      }),
    ).toBeFunction();

    expectTypeOf(
      procedure.actionable({
        context: async (_clientContext: { batch?: boolean }) => ({
          db: "postgres",
        }),
      }),
    ).toBeFunction();

    procedure.actionable({
      // @ts-expect-error - all clientContext must be optional
      context: async (_clientContext: { batch: boolean }) => ({
        db: "postgres",
      }),
    });
  });
});
