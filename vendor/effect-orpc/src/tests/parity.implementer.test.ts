import type { ORPCError } from "@orpc/client";
import type { Meta, Schema } from "@orpc/contract";
import type { Middleware, Router } from "@orpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EffectImplementer,
  EffectImplementerInternal,
  EffectProcedureImplementer,
} from "../index";
import { implementEffect } from "../index";
import type { CurrentContext, InitialContext } from "./parity-shared";
import { runtime, typedContract } from "./parity-shared";
import type { AssertExtends } from "./shared";
import {
  baseErrorMap,
  type BaseMeta,
  inputSchema,
  outputSchema,
} from "./shared";

const rootImplementer = implementEffect(typedContract, runtime);
const implementer = rootImplementer
  .$context<InitialContext>()
  .use(({ next }) => next({ context: { auth: true as boolean } }));

describe("parity: @orpc/server implementer.test-d.ts", () => {
  describe("root level", () => {
    it(".$context", () => {
      expectTypeOf(rootImplementer.$context<{ anything: string }>()).toExtend<
        EffectImplementer<
          typeof typedContract,
          { anything: string } & Record<never, never>,
          { anything: string },
          never,
          never
        >
      >();
    });

    it(".$config", () => {
      expectTypeOf(
        rootImplementer.$config({
          initialInputValidationIndex: Number.NEGATIVE_INFINITY,
        }),
      ).toExtend<
        EffectImplementer<
          typeof typedContract,
          Record<never, never>,
          Record<never, never>,
          never,
          never
        >
      >();
    });
  });

  describe("router level", () => {
    it(".middleware", () => {
      expectTypeOf(
        rootImplementer
          .$context<InitialContext>()
          .nested.middleware(
            (
              { context, next, path, procedure, errors, signal },
              input,
              output,
            ) => {
              expectTypeOf(context).toExtend<InitialContext>();
              expectTypeOf(input).toEqualTypeOf<unknown>();
              expectTypeOf(path).toExtend<readonly string[]>();
              expectTypeOf(procedure).toBeObject();
              expectTypeOf(output).toBeFunction();
              expectTypeOf(errors).toBeObject();
              expectTypeOf(signal).toExtend<AbortSignal | undefined>();

              return next({ context: { extra: true } });
            },
          ),
      ).toBeObject();
    });

    it(".use", () => {
      expectTypeOf(
        implementer.nested.use(
          (
            { context, next, path, procedure, errors, signal },
            input,
            output,
          ) => {
            expectTypeOf(context).toEqualTypeOf<CurrentContext>();
            expectTypeOf(input).toEqualTypeOf<unknown>();
            expectTypeOf(path).toExtend<readonly string[]>();
            expectTypeOf(procedure).toBeObject();
            expectTypeOf(output).toBeFunction();
            expectTypeOf(errors).toBeObject();
            expectTypeOf(signal).toExtend<AbortSignal | undefined>();

            return next({ context: { extra: true } });
          },
        ),
      ).toBeObject();

      const mid = {} as Middleware<
        { cacheable?: boolean } & Record<never, never>,
        Record<never, never>,
        unknown,
        unknown,
        any,
        BaseMeta
      >;

      expectTypeOf(implementer.use(mid)).toExtend<
        EffectImplementerInternal<
          typeof typedContract,
          InitialContext & { cacheable?: boolean },
          Omit<CurrentContext, never> & Record<never, never>,
          never,
          never
        >
      >();
    });

    it(".router / .lazy", () => {
      const implementedRouter = {
        ping: implementer.ping.handler(({ input }) => ({
          output: Number(input.input),
        })),
        pong: implementer.pong.handler(() => undefined),
        nested: {
          ping: implementer.nested.ping.handler(({ input }) => ({
            output: Number(input.input),
          })),
          pong: implementer.nested.pong.handler(() => undefined),
        },
      };
      const router = implementer.router(implementedRouter);

      expectTypeOf<
        AssertExtends<
          typeof router,
          Router<typeof typedContract, CurrentContext>
        >
      >().toEqualTypeOf<true>();

      expectTypeOf(
        implementer.lazy(async () => ({ default: implementedRouter })),
      ).toBeObject();

      // @ts-expect-error - meta def is not match
      implementer.router({ ping: {} });

      // @ts-expect-error - missing implementation
      implementer.router({ ping: implementedRouter.ping });
    });
  });

  it("each procedure is a ProcedureImplementer", () => {
    type ExpectedPing = EffectProcedureImplementer<
      InitialContext & Record<never, never>,
      CurrentContext,
      typeof inputSchema,
      typeof outputSchema,
      typeof baseErrorMap,
      BaseMeta,
      never,
      never
    >;

    type ExpectedPong = EffectProcedureImplementer<
      InitialContext & Record<never, never>,
      CurrentContext,
      Schema<unknown, unknown>,
      Schema<unknown, unknown>,
      Record<never, never>,
      Meta,
      never,
      never
    >;

    expectTypeOf(implementer.ping).toExtend<ExpectedPing>();
    expectTypeOf(implementer.nested.ping).toExtend<ExpectedPing>();
    expectTypeOf(implementer.pong).toExtend<ExpectedPong>();
    expectTypeOf(implementer.nested.pong).toExtend<ExpectedPong>();
  });

  it("procedure .use preserves the leaf error map", () => {
    implementer.ping.use(({ errors, next }) => {
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
      // @ts-expect-error - leaf middleware errors should not widen to arbitrary keys
      expect(errors.MISSING).toBeUndefined();

      return next({});
    });

    implementer.ping.use(
      ({ errors, next }) => {
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
        // @ts-expect-error - mapped input overload should keep the same leaf error map
        expect(errors.MISSING).toBeUndefined();

        return next({});
      },
      () => ({ mapped: true }),
    );
  });

  it("procedure .handler preserves upstream handler option typing", () => {
    implementer.ping.handler(
      ({ context, input, path, procedure, errors, signal }) => {
        expectTypeOf(context).toExtend<CurrentContext>();
        expectTypeOf(input).toEqualTypeOf<{ input: string }>();
        expectTypeOf(path).toExtend<readonly string[]>();
        expectTypeOf(procedure).toBeObject();
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
        // @ts-expect-error - handler errors should not widen beyond the leaf error map
        expect(errors.MISSING).toBeUndefined();

        return {
          output: Number(input.input),
        };
      },
    );

    implementer.ping.handler(
      // @ts-expect-error - handler output must match the contract output shape
      () => ({ output: "wrong" }),
    );

    implementer.ping.handler(
      // @ts-expect-error - handler input should be the parsed contract input
      ({ input }: { input: { invalid: true } }) => ({
        output: Number(input.invalid),
      }),
    );
  });

  it("procedure leaves do not expose .middleware", () => {
    expect(
      (implementer.ping as { middleware?: unknown }).middleware,
    ).toBeUndefined();
    // @ts-expect-error - procedure implementer leaves should not expose middleware
    expect(implementer.ping.middleware).toBeUndefined();
    expectTypeOf(implementer.nested).toHaveProperty("middleware");
  });
});
