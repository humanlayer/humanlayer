import type { OmitChainMethodDeep } from "@orpc/shared";
import { describe, expectTypeOf, it } from "vitest";

import type {
  EffectContractProcedureBuilderWithInputOutput,
  EffectContractRouterBuilder,
} from "../index";
import { eoc } from "../index";
import {
  type BaseMeta,
  baseErrorMap,
  generalSchema,
  inputSchema,
  outputSchema,
  ping,
  pong,
} from "./shared";

const generalBuilder = eoc
  .$meta({ mode: "dev" } as BaseMeta)
  .$input(inputSchema)
  .errors(baseErrorMap);

describe("parity: @orpc/contract builder-variants.test-d.ts", () => {
  describe("EffectContractProcedureBuilder", () => {
    const builder = eoc.errors(baseErrorMap).meta({ mode: "dev" } as BaseMeta);

    it("backward compatibility", () => {
      const expected = {} as OmitChainMethodDeep<
        typeof generalBuilder,
        "$meta" | "$route" | "$input" | "prefix" | "tag" | "router"
      >;

      expectTypeOf<keyof typeof builder>().toEqualTypeOf<
        keyof typeof expected
      >();
    });

    it(".errors / .meta / .route / .input / .output", () => {
      expectTypeOf(
        builder.errors({ INVALID: { message: "invalid" } }),
      ).toBeObject();
      expectTypeOf(builder.meta({ log: true })).toBeObject();
      expectTypeOf(builder.route({ method: "GET" })).toBeObject();
      expectTypeOf(builder.input(generalSchema)).toBeObject();
      expectTypeOf(builder.output(generalSchema)).toBeObject();

      // @ts-expect-error - schema is invalid
      builder.errors({ TOO_MANY_REQUESTS: { data: {} } });
      // @ts-expect-error - invalid method
      builder.route({ method: "INVALID" });
      // @ts-expect-error - schema is invalid
      builder.input({});
      // @ts-expect-error - schema is invalid
      builder.output({});
    });
  });

  describe("EffectContractProcedureBuilderWithInput", () => {
    const builder = eoc
      .errors(baseErrorMap)
      .meta({ mode: "dev" })
      .input(inputSchema);

    it("backward compatibility", () => {
      const expected = {} as OmitChainMethodDeep<
        typeof generalBuilder,
        "$meta" | "$route" | "$input" | "prefix" | "tag" | "router" | "input"
      >;

      expectTypeOf<keyof typeof builder>().toEqualTypeOf<
        keyof typeof expected
      >();
    });

    it(".errors / .meta / .route / .output", () => {
      expectTypeOf(
        builder.errors({ INVALID: { message: "invalid" } }),
      ).toBeObject();
      expectTypeOf(builder.meta({ log: true })).toBeObject();
      expectTypeOf(builder.route({ method: "GET" })).toBeObject();
      expectTypeOf(builder.output(generalSchema)).toExtend<
        EffectContractProcedureBuilderWithInputOutput<
          typeof inputSchema,
          typeof generalSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >();
    });
  });

  describe("EffectContractProcedureBuilderWithOutput", () => {
    const builder = eoc
      .errors(baseErrorMap)
      .meta({ mode: "dev" })
      .output(outputSchema);

    it("backward compatibility", () => {
      const expected = {} as OmitChainMethodDeep<
        typeof generalBuilder,
        "$meta" | "$route" | "$input" | "prefix" | "tag" | "router" | "output"
      >;

      expectTypeOf<keyof typeof builder>().toEqualTypeOf<
        keyof typeof expected
      >();
    });

    it(".errors / .meta / .route / .input", () => {
      expectTypeOf(
        builder.errors({ INVALID: { message: "invalid" } }),
      ).toBeObject();
      expectTypeOf(builder.meta({ log: true })).toBeObject();
      expectTypeOf(builder.route({ method: "GET" })).toBeObject();
      expectTypeOf(builder.input(generalSchema)).toExtend<
        EffectContractProcedureBuilderWithInputOutput<
          typeof generalSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >();
    });
  });

  describe("EffectContractProcedureBuilderWithInputOutput", () => {
    const builder = eoc
      .errors(baseErrorMap)
      .meta({ mode: "dev" })
      .input(inputSchema)
      .output(outputSchema);

    it("backward compatibility", () => {
      const expected = {} as OmitChainMethodDeep<
        typeof generalBuilder,
        | "$meta"
        | "$route"
        | "$input"
        | "prefix"
        | "tag"
        | "router"
        | "input"
        | "output"
      >;

      expectTypeOf<keyof typeof builder>().toEqualTypeOf<
        keyof typeof expected
      >();
    });

    it(".errors / .meta / .route", () => {
      expectTypeOf(
        builder.errors({ INVALID: { message: "invalid" } }),
      ).toBeObject();
      expectTypeOf(builder.meta({ log: true })).toBeObject();
      expectTypeOf(builder.route({ method: "GET" })).toBeObject();
    });
  });

  describe("EffectContractRouterBuilder", () => {
    const builder = eoc.errors(baseErrorMap).prefix("/api");

    it("backward compatibility", () => {
      expectTypeOf(builder.errors).toBeFunction();
      expectTypeOf(builder.prefix).toBeFunction();
      expectTypeOf(builder.tag).toBeFunction();
      expectTypeOf(builder.router).toBeFunction();
    });

    it(".errors / .prefix / .tag / .router", () => {
      expectTypeOf(
        builder.errors({ INVALID: { message: "invalid" } }),
      ).toBeObject();
      expectTypeOf(builder.prefix("/api")).toExtend<
        EffectContractRouterBuilder<typeof baseErrorMap, BaseMeta>
      >();
      expectTypeOf(builder.tag("tag1", "tag2")).toExtend<
        EffectContractRouterBuilder<typeof baseErrorMap, BaseMeta>
      >();
      expectTypeOf(builder.router({ ping, pong })).toExtend<{
        ping: typeof ping;
        pong: typeof pong;
      }>();

      // @ts-expect-error - invalid prefix
      builder.prefix(1);
      // @ts-expect-error - invalid tag
      builder.tag(1);
    });
  });
});
