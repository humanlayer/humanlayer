import type { ContractProcedure, Schema } from "@orpc/contract";
import type {
  Builder,
  DecoratedMiddleware,
  Middleware,
  MiddlewareOutputFn,
} from "@orpc/server";
import type { OmitChainMethodDeep } from "@orpc/shared";
import { describe, expectTypeOf, it } from "vitest";
import z from "zod";

import {
  EffectBuilder,
  EffectDecoratedProcedure,
  makeEffectORPC,
} from "../index";
import type { CurrentContext, InitialContext } from "./parity-shared";
import { runtime } from "./parity-shared";
import type { AssertExtends } from "./shared";
import {
  baseErrorMap,
  baseMeta,
  type BaseMeta,
  inputSchema,
  outputSchema,
} from "./shared";

const typedBuilder = {} as EffectBuilder<
  InitialContext,
  CurrentContext,
  typeof inputSchema,
  typeof outputSchema,
  typeof baseErrorMap,
  BaseMeta,
  never,
  never
>;

const rootBuilder = makeEffectORPC(runtime)
  .$context<InitialContext>()
  .$meta(baseMeta)
  .$input(inputSchema)
  .errors(baseErrorMap);

const authMiddleware: Middleware<
  InitialContext,
  { auth: boolean },
  { input: string },
  unknown,
  any,
  BaseMeta
> = ({ next }) => next({ context: { auth: true as boolean } });

const withMiddlewares = rootBuilder.use(authMiddleware);

const procedureBuilder = withMiddlewares.meta(baseMeta);
const withInput = procedureBuilder.input(inputSchema);
const withOutput = procedureBuilder.output(outputSchema);
const withInputOutput = withInput.output(outputSchema);

describe("parity: @orpc/server builder.test-d.ts", () => {
  it("exposes every upstream builder key", () => {
    type MissingEffectBuilderKeys = Exclude<
      keyof Builder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >,
      keyof typeof typedBuilder
    >;

    expectTypeOf<MissingEffectBuilderKeys>().toEqualTypeOf<never>();
  });

  it("is a contract procedure", () => {
    expectTypeOf<
      AssertExtends<
        typeof typedBuilder,
        ContractProcedure<
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >
    >().toEqualTypeOf<true>();
  });

  it(".$config / .$context / .$meta / .$route / .$input", () => {
    expectTypeOf(
      rootBuilder.$config({
        initialInputValidationIndex: Number.NEGATIVE_INFINITY,
        initialOutputValidationIndex: Number.POSITIVE_INFINITY,
      }),
    ).toBeObject();

    expectTypeOf(rootBuilder.$context()).toBeObject();
    expectTypeOf(rootBuilder.$context<{ anything: string }>()).toBeObject();
    expectTypeOf(rootBuilder.$meta<{ auth?: boolean }>({})).toBeObject();
    expectTypeOf(rootBuilder.$route({ method: "GET" })).toBeObject();

    const schema = z.void();
    expectTypeOf(rootBuilder.$input(schema)).toBeObject();
    expectTypeOf(rootBuilder.$input<Schema<void, unknown>>()).toBeObject();

    rootBuilder.$config({
      // @ts-expect-error - must be number
      initialInputValidationIndex: "INVALID",
    });
    // @ts-expect-error - initial meta is required
    rootBuilder.$meta<{ auth?: boolean }>();
    // @ts-expect-error - invalid method
    rootBuilder.$route({ method: "INVALID" });
    // @ts-expect-error - invalid schema
    rootBuilder.$input<"invalid">();
  });

  it(".middleware", () => {
    expectTypeOf(
      rootBuilder.middleware(
        ({ next }, input: "input", output: MiddlewareOutputFn<"output">) => {
          expectTypeOf(input).toEqualTypeOf<"input">();
          expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<"output">>();
          return next({ context: { extra: true } });
        },
      ),
    ).toExtend<
      DecoratedMiddleware<
        InitialContext,
        { extra: boolean },
        "input",
        "output",
        any,
        BaseMeta
      >
    >();
  });

  it(".errors / .use / .meta / .route / .input / .output", () => {
    expectTypeOf(
      rootBuilder.errors({ BAD_GATEWAY: { message: "BAD" } }),
    ).toBeObject();
    expectTypeOf(withMiddlewares.use).toBeFunction();
    expectTypeOf(withMiddlewares.meta).toBeFunction();
    expectTypeOf(withMiddlewares.route).toBeFunction();
    expectTypeOf(withMiddlewares.input).toBeFunction();
    expectTypeOf(withMiddlewares.output).toBeFunction();

    const mid = {} as Middleware<
      { cacheable?: boolean } & Record<never, never>,
      Record<never, never>,
      unknown,
      unknown,
      any,
      BaseMeta
    >;
    expectTypeOf(withMiddlewares.use(mid)).toBeObject();
  });

  it(".handler / .effect / .prefix / .tag / .router / .lazy", () => {
    expectTypeOf(withOutput.handler(() => ({ output: 456 }))).toExtend<
      EffectDecoratedProcedure<
        InitialContext & Record<never, never>,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta,
        never,
        never
      >
    >();

    expectTypeOf(
      withOutput.effect(function* () {
        return { output: 456 };
      }),
    ).toExtend<
      EffectDecoratedProcedure<
        InitialContext & Record<never, never>,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta,
        never,
        never
      >
    >();

    expectTypeOf(rootBuilder.prefix("/api")).toBeObject();
    expectTypeOf(rootBuilder.tag("tag1", "tag2")).toBeObject();
  });
});

describe("parity: @orpc/server builder-variants.test-d.ts", () => {
  it("keeps variant method surface aligned with upstream", () => {
    void ({} as OmitChainMethodDeep<
      typeof typedBuilder,
      "$config" | "$context" | "$meta" | "$route" | "$input" | "middleware"
    >);

    expectTypeOf(withMiddlewares.errors).toBeFunction();
    expectTypeOf(withMiddlewares.use).toBeFunction();
    expectTypeOf(withMiddlewares.handler).toBeFunction();
    expectTypeOf(withMiddlewares.effect).toBeFunction();

    expectTypeOf(withMiddlewares.handler).toBeFunction();
    expectTypeOf(procedureBuilder.traced).toBeFunction();
    expectTypeOf(withInput.output).toBeFunction();
    expectTypeOf(withOutput.input).toBeFunction();
    expectTypeOf(withInputOutput.effect).toBeFunction();
  });
});
