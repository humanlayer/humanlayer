import { ContractBuilder, isContractProcedure } from "@orpc/contract";
import { describe, expect, expectTypeOf, it } from "vitest";

import { effectErrorMapToErrorMap, eoc } from "../index";
import {
  baseErrorMap,
  baseMeta,
  baseRoute,
  generalSchema,
  inputSchema,
  outputSchema,
  ping,
  pong,
} from "./shared";

const builder = eoc
  .$meta(baseMeta)
  .$route(baseRoute)
  .$input(inputSchema)
  .errors(baseErrorMap);

describe("parity: @orpc/contract builder.test.ts", () => {
  it("is a contract procedure", () => {
    expect(eoc).toSatisfy(isContractProcedure);
  });

  it(".$meta", () => {
    const meta = { dev: true, log: true };
    const applied = builder.$meta(meta);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      meta,
    });
  });

  it(".$route", () => {
    const route = { method: "GET", path: "/api" } as const;
    const applied = builder.$route(route);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      route,
    });
  });

  it(".$input", () => {
    const applied = builder.$input(generalSchema);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      inputSchema: generalSchema,
    });
  });

  it(".errors", () => {
    const errors = {
      BAD_GATEWAY: { data: outputSchema },
      OVERRIDE: { message: "override" },
    } as const;
    const applied = builder.errors(errors);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      errorMap: effectErrorMapToErrorMap({
        ...baseErrorMap,
        ...errors,
      }),
    });
  });

  it(".meta", () => {
    const meta = { dev: true, log: true };
    const applied = builder.meta(meta);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      meta: { ...builder["~orpc"].meta, ...meta },
    });
  });

  it(".route", () => {
    const route = { method: "GET", path: "/path" } as const;
    const applied = builder.route(route);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      route: { ...builder["~orpc"].route, ...route },
    });
  });

  it(".input", () => {
    const applied = builder.input(generalSchema);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      inputSchema: generalSchema,
    });
  });

  it(".output", () => {
    const applied = builder.output(generalSchema);

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      outputSchema: generalSchema,
    });
  });

  it(".prefix", () => {
    const applied = builder.prefix("/api") as any;

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      prefix: "/api",
    });
  });

  it(".tag", () => {
    const applied = builder.tag("tag1", "tag2") as any;

    expect(applied).toBeInstanceOf(ContractBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~orpc"]).toEqual({
      ...builder["~orpc"],
      tags: ["tag1", "tag2"],
    });
  });

  it(".router", () => {
    const router = builder.router({ ping, pong });

    expect(router.ping["~orpc"].route.path).toBe("/base");
    expect(router.ping["~orpc"].meta).toEqual(baseMeta);
    expect(router.ping["~orpc"].errorMap).toEqual(baseErrorMap);
  });
});

describe("parity: @orpc/contract builder.test-d.ts", () => {
  const typedBuilder = builder;

  it("is a contract procedure", () => {
    expectTypeOf(typedBuilder["~orpc"]).toBeObject();
  });

  it("preserves ContractBuilder typing for root methods", () => {
    expectTypeOf(typedBuilder.$meta<{ auth?: boolean }>({})).toBeObject();

    expectTypeOf(typedBuilder.$route({ method: "GET", path: "/api" })).toExtend<
      typeof typedBuilder
    >();

    expectTypeOf(typedBuilder.$input(generalSchema)).toBeObject();

    expectTypeOf(
      typedBuilder.errors({
        INVALID: { message: "invalid" },
        OVERRIDE: { message: "override" },
      }),
    ).toBeObject();

    expectTypeOf(typedBuilder.meta({ log: true })).toBeObject();
    expectTypeOf(typedBuilder.route({ method: "GET" })).toBeObject();
    expectTypeOf(typedBuilder.input(generalSchema)).toBeObject();
    expectTypeOf(typedBuilder.output(generalSchema)).toBeObject();
    expectTypeOf(typedBuilder.prefix("/api")).toBeObject();
    expectTypeOf(typedBuilder.tag("tag1", "tag2")).toBeObject();
    expectTypeOf(typedBuilder.router({ ping, pong })).toExtend<{
      ping: typeof ping;
      pong: typeof pong;
    }>();
  });

  it("preserves ContractBuilder constraints", () => {
    // @ts-expect-error - initial meta is required
    typedBuilder.$meta<{ auth?: boolean }>();
    // @ts-expect-error - auth is missing in initial meta
    typedBuilder.$meta<{ auth: boolean }>({});
    // @ts-expect-error - invalid method
    typedBuilder.$route({ method: "INVALID" });
    // @ts-expect-error - invalid schema
    typedBuilder.$input({});
    // @ts-expect-error - schema is invalid
    typedBuilder.errors({ TOO_MANY_REQUESTS: { data: {} } });
    // @ts-expect-error - invalid meta
    typedBuilder.meta({ meta: "INVALID" });
    // @ts-expect-error - invalid method
    typedBuilder.route({ method: "INVALID" });
    // @ts-expect-error - invalid schema
    typedBuilder.input({});
    // @ts-expect-error - invalid schema
    typedBuilder.output({});
    // @ts-expect-error - invalid prefix
    typedBuilder.prefix(1);
    // @ts-expect-error - invalid tag
    typedBuilder.tag(1);
  });

  it("keeps eoc-specific tagged error normalization separate", () => {
    const applied = eoc.errors(baseErrorMap);

    expectTypeOf(applied["~orpc"].errorMap).toBeObject();
  });
});
