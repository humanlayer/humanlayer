import { AsyncLocalStorage } from "node:async_hooks";

import type { Context } from "effect";
import { Effect } from "effect";

import {
  installFiberContextBridge,
  type FiberContextBridge,
} from "./fiber-context-bridge";

const contextStorage = new AsyncLocalStorage<Context.Context<never>>();

const bridge: FiberContextBridge = {
  getCurrentContext: () => contextStorage.getStore(),
  runWithContext: (context, fn) => contextStorage.run(context, fn),
};

installFiberContextBridge(bridge);

export function withFiberContext<T>(fn: () => Promise<T>): Effect.Effect<T> {
  return Effect.flatMap(Effect.context<never>(), (context) =>
    Effect.promise(() => bridge.runWithContext!(context, fn)),
  );
}
