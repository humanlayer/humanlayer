import { describe, expect, it, vi } from "vitest";

async function makeSplitProcedure(options: {
  readonly installNodeBridge: boolean;
}) {
  vi.resetModules();

  if (options.installNodeBridge) {
    await import("../node");
  } else {
    const { installFiberContextBridge } =
      await import("../fiber-context-bridge");
    installFiberContextBridge(undefined);
  }

  const [
    { call },
    { Context, Effect, Layer, ManagedRuntime },
    { makeEffectORPC },
  ] = await Promise.all([
    import("@orpc/server"),
    import("effect"),
    import("../effect-builder"),
  ]);

  class CurrentUser extends Context.Service<
    CurrentUser,
    { readonly id: string }
  >()("SideEffectImportCurrentUser") {}

  const runtime = ManagedRuntime.make(Layer.empty);
  const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
  const procedure = makeEffectORPC(runtime)
    .$context<{ readonly user: { readonly id: string } }>()
    .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
    .use(function* ({ next }) {
      return yield* next();
    })
    .use(({ next }) => next())
    .use(function* ({ next }) {
      const user = yield* CurrentUser;
      return yield* next({ context: { userId: user.id } });
    })
    .effect(function* ({ context }) {
      const user = yield* CurrentUser;
      return `${context.userId}:${user.id}`;
    });

  return { call, procedure, runPromiseExit, runtime };
}

describe("node side-effect bridge", () => {
  it("propagates FiberRefs across split Effect groups with only the side-effect import", async () => {
    const { call, procedure, runPromiseExit, runtime } =
      await makeSplitProcedure({ installNodeBridge: true });

    try {
      await expect(
        call(procedure, undefined, { context: { user: { id: "u-side" } } }),
      ).resolves.toBe("u-side:u-side");
      expect(runPromiseExit).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
    }
  }, 30_000);

  it("does not propagate FiberRefs across split Effect groups without the bridge", async () => {
    const { call, procedure, runPromiseExit, runtime } =
      await makeSplitProcedure({ installNodeBridge: false });

    try {
      await expect(
        call(procedure, undefined, { context: { user: { id: "u-side" } } }),
      ).rejects.toThrow();
      expect(runPromiseExit).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
    }
  });
});
