import { isLazy, isProcedure, os, unlazy } from "@orpc/server";
import { Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { EffectBuilder, makeEffectORPC } from "../effect-builder";
import { EffectDecoratedProcedure } from "../effect-procedure";
import { ORPCTaggedError } from "../tagged-error";
const runtime = ManagedRuntime.make(Layer.empty);

function makeCustomBuilder(meta: Record<string, unknown> = {}): {
  "~orpc": (typeof os)["~orpc"];
  customBuilderLike(label: string): any;
  customValue(): unknown;
} {
  return {
    "~orpc": {
      ...os["~orpc"],
      meta,
    },
    customBuilderLike(this: any, label: string) {
      return makeCustomBuilder({
        ...(this["~orpc"].meta as Record<string, unknown>),
        label,
      });
    },
    customValue(this: any) {
      return this["~orpc"].meta;
    },
  };
}

describe("effectBuilder proxy compatibility", () => {
  it("preserves instanceof and virtual reflection surface", () => {
    const builder = makeEffectORPC(runtime);

    expect(builder).toBeInstanceOf(EffectBuilder);
    expect("~orpc" in builder).toBe(true);
    expect("~effect" in builder).toBe(true);
    expect("errors" in builder).toBe(true);
    expect("effect" in builder).toBe(true);
    expect("traced" in builder).toBe(true);
    expect("handler" in builder).toBe(true);
    expect("router" in builder).toBe(true);
    expect("lazy" in builder).toBe(true);
    expect("middleware" in builder).toBe(true);

    expect(Object.keys(builder)).toEqual(
      expect.arrayContaining(["~effect", "~orpc"]),
    );
    expect(Reflect.ownKeys(builder)).toEqual(
      expect.arrayContaining([
        "~effect",
        "~orpc",
        "errors",
        "effect",
        "traced",
        "handler",
        "router",
        "lazy",
      ]),
    );

    expect(Object.prototype.hasOwnProperty.call(builder, "~orpc")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(builder, "~effect")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(builder, "effect")).toBe(true);

    const orpcDescriptor = Object.getOwnPropertyDescriptor(builder, "~orpc");
    expect(orpcDescriptor?.enumerable).toBe(true);
    expect(orpcDescriptor?.value).toBe(builder["~orpc"]);

    const effectDescriptor = Object.getOwnPropertyDescriptor(
      builder,
      "~effect",
    );
    expect(effectDescriptor?.enumerable).toBe(true);
    expect(effectDescriptor?.value).toStrictEqual(builder["~effect"]);

    const methodDescriptor = Object.getOwnPropertyDescriptor(builder, "effect");
    expect(methodDescriptor?.enumerable).toBe(false);
    expect(methodDescriptor?.value).toBeTypeOf("function");
  });

  it("keeps extracted forwarded and intercepted methods callable", () => {
    const builder = makeEffectORPC(runtime).$meta({ mode: "dev" });

    const meta = builder.meta;
    const prefixed = builder.prefix;
    const effect = builder.effect;

    const withMeta = meta({ log: true } as any);
    const withPrefix = prefixed("/api");
    const procedure = effect(function* () {
      return "ok";
    });

    expect(withMeta).toBeInstanceOf(EffectBuilder);
    expect(withMeta["~effect"].meta).toEqual({ mode: "dev", log: true });
    expect(withPrefix).toBeInstanceOf(EffectBuilder);
    expect((withPrefix as any)["~effect"].prefix).toBe("/api");
    expect(procedure).toBeInstanceOf(EffectDecoratedProcedure);
  });

  it("preserves wrapped chaining across forwarded and intercepted methods", () => {
    const routedBuilder = makeEffectORPC(runtime).prefix("/api").tag("users");
    const builder = makeEffectORPC(runtime)
      .$meta({ scope: "users" })
      .errors({ BAD_REQUEST: { message: "bad request" } })
      .traced("users.list")
      .input(z.object({ id: z.string() }))
      .output(z.object({ id: z.string() }));

    expect(routedBuilder).toBeInstanceOf(EffectBuilder);
    expect((routedBuilder as any)["~effect"].prefix).toBe("/api");
    expect((routedBuilder as any)["~effect"].tags).toEqual(["users"]);
    expect(builder).toBeInstanceOf(EffectBuilder);
    expect(builder["~effect"].meta).toEqual({ scope: "users" });
    expect(builder["~effect"].spanConfig?.name).toBe("users.list");

    const procedure = builder.handler(
      ({ input }: { input: { id: string } }) => input,
    );
    expect(procedure).toBeInstanceOf(EffectDecoratedProcedure);
    expect(procedure["~effect"].runtime).toBe(runtime);
  });

  it("preserves tagged class support in errors()", () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ userId: z.string() }),
    }) {}

    const builder = makeEffectORPC(runtime).errors({
      UserNotFoundError,
    });

    expect(builder["~effect"].effectErrorMap.UserNotFoundError).toBe(
      UserNotFoundError,
    );
    expect(builder["~orpc"].errorMap).toHaveProperty("NOT_FOUND");
  });

  it("keeps handler, effect, router, and lazy return behavior unchanged", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      return { output: "pong" };
    });

    const handled = builder.handler(() => "handled");
    const effected = builder.effect(function* () {
      return "effected";
    });
    const routed = builder.prefix("/v1").router({ ping: procedure });
    const lazied = builder.lazy(async () => ({ default: { ping: procedure } }));

    expect(handled).toBeInstanceOf(EffectDecoratedProcedure);
    expect(effected).toBeInstanceOf(EffectDecoratedProcedure);
    expect(routed.ping["~effect"].runtime).toBe(runtime);
    expect(isLazy(lazied)).toBe(true);

    const { default: resolved } = await unlazy(lazied as any);
    expect(resolved.ping["~effect"].runtime).toBe(runtime);
  });

  it("preserves decorated procedure proxy reflection and extracted methods", () => {
    const procedure = makeEffectORPC(runtime)
      .route({ path: "/users" })
      .handler(({ input }) => input);

    expect(procedure).toBeInstanceOf(EffectDecoratedProcedure);
    expect("~orpc" in procedure).toBe(true);
    expect("~effect" in procedure).toBe(true);
    expect("errors" in procedure).toBe(true);
    expect("meta" in procedure).toBe(true);
    expect("route" in procedure).toBe(true);
    expect("use" in procedure).toBe(true);
    expect("callable" in procedure).toBe(true);
    expect("actionable" in procedure).toBe(true);

    expect(Reflect.ownKeys(procedure)).toEqual(
      expect.arrayContaining([
        "~orpc",
        "~effect",
        "errors",
        "meta",
        "route",
        "use",
        "callable",
        "actionable",
      ]),
    );

    const meta = procedure.meta;
    const route = procedure.route;
    const errors = procedure.errors;

    expect(meta({ scope: "users" } as any)["~effect"].meta).toEqual({
      scope: "users",
    });
    expect(route({ method: "GET" })["~effect"].route).toEqual({
      method: "GET",
      path: "/users",
    });
    const withError = errors({ BAD_REQUEST: { message: "bad request" } });
    expect(withError["~orpc"].errorMap.BAD_REQUEST.message).toBe("bad request");
  });

  it("keeps callable procedure clients executable while exposing the procedure surface", async () => {
    const procedure = makeEffectORPC(runtime).handler(({ input }) => ({
      echoed: input,
    }));

    const callable = procedure.callable();

    await expect(callable("hello")).resolves.toEqual({ echoed: "hello" });
    expect(callable).toSatisfy(isProcedure);
    expect(callable["~effect"].runtime).toBe(runtime);
    expect(callable.route({ path: "/echo" })).toBeInstanceOf(
      EffectDecoratedProcedure,
    );
  });

  it("applies builder route and middleware enhancements to routed procedures", () => {
    const builder = makeEffectORPC(runtime);
    const middleware = builder.middleware(({ next }) => next({}));
    const procedure = builder.route({ path: "/ping" }).handler(() => "pong");

    const routed = builder.use(middleware).prefix("/api").router({ procedure });

    expect(routed.procedure["~orpc"].route.path).toBe("/api/ping");
    expect(routed.procedure["~effect"].route.path).toBe("/api/ping");
    expect(routed.procedure["~orpc"].middlewares).toHaveLength(
      procedure["~orpc"].middlewares.length + 1,
    );
    expect(routed.procedure["~effect"].middlewares).toHaveLength(
      procedure["~effect"].middlewares.length + 1,
    );
  });

  it("rewraps unknown builder-like methods and passes through non-builder results", () => {
    const builder = makeEffectORPC(runtime, makeCustomBuilder() as any) as any;

    const customBuilderLike = builder.customBuilderLike;
    const customValue = builder.customValue;

    const next = customBuilderLike("proxy");

    expect(next).toBeInstanceOf(EffectBuilder);
    expect(next["~effect"].meta).toEqual({ label: "proxy" });
    expect(customValue()).toEqual({});
    expect(next.customValue()).toEqual({ label: "proxy" });
  });
});
