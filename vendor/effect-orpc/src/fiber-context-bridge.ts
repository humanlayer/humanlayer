import type { Context } from "effect";

export interface FiberContextBridge {
  readonly getCurrentContext: () => Context.Context<never> | undefined;
  readonly runWithContext?: <T>(
    context: Context.Context<never>,
    fn: () => Promise<T>,
  ) => Promise<T>;
}

let bridge: FiberContextBridge | undefined;

export function installFiberContextBridge(
  nextBridge: FiberContextBridge | undefined,
): void {
  bridge = nextBridge;
}

export function getCurrentContext(): Context.Context<never> | undefined {
  return bridge?.getCurrentContext();
}

export function runWithContext<T>(
  context: Context.Context<never>,
  fn: () => Promise<T>,
): Promise<T> {
  return bridge?.runWithContext
    ? bridge.runWithContext(context, fn)
    : fn();
}
