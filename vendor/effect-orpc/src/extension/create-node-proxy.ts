import {
  effectInternalsSymbol,
  getEffectInternals,
  type EffectExtensionState,
  type EffectProxyTarget,
} from "./state";

const unhandledProperty = Symbol("effect-orpc/unhandledProperty");

export type UnhandledProperty = typeof unhandledProperty;

export interface NodeProxyContext<
  TTarget extends EffectProxyTarget<TSource>,
  TSource extends object,
> {
  methodCache: Map<PropertyKey, unknown>;
  state: EffectExtensionState;
  target: TTarget;
  upstream: TSource;
}

interface NodeProxyInternalConfig<
  TTarget extends EffectProxyTarget<TSource>,
  TSource extends object,
> {
  getProperty?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    receiver: unknown,
  ) => unknown | UnhandledProperty;
  getVirtual?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    receiver: unknown,
  ) => unknown | UnhandledProperty;
  virtualDescriptors?: Partial<
    Record<string | symbol, Pick<PropertyDescriptor, "enumerable">>
  >;
  virtualKeys?: readonly (string | symbol)[];
  wrapResult?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    result: unknown,
    receiver: unknown,
  ) => unknown;
  wrapArgs?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    args: unknown[],
    receiver: unknown,
  ) => unknown[];
}

/**
 * Configures how an Effect-aware node proxy exposes virtual properties and
 * rewrites returned values while the upstream builder/procedure remains the
 * source of truth for passthrough behavior.
 */
export interface NodeProxyConfig<
  TTarget extends EffectProxyTarget<TSource>,
  TSource extends object,
> extends NodeProxyInternalConfig<TTarget, TSource> {
  /**
   * Returns a value for virtual properties such as `~effect` or custom
   * proxy-backed methods. Return `unhandled()` to fall back to the next step.
   */
  getVirtual?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    receiver: unknown,
  ) => unknown | UnhandledProperty;
  /**
   * Intercepts property access before upstream passthrough. Return
   * `unhandled()` to delegate to the wrapped upstream node.
   */
  getProperty?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    receiver: unknown,
  ) => unknown | UnhandledProperty;
  /**
   * Declares which virtual keys should appear in reflection APIs like `in`,
   * `Object.keys`, and descriptor lookup.
   */
  virtualKeys?: readonly (string | symbol)[];
  /**
   * Controls enumerability for virtual keys exposed through the proxy.
   */
  virtualDescriptors?: Partial<
    Record<string | symbol, Pick<PropertyDescriptor, "enumerable">>
  >;
  /**
   * Rewraps upstream method results when they should stay inside the Effect
   * extension model.
   */
  wrapResult?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    result: unknown,
    receiver: unknown,
  ) => unknown;
  /**
   * Rewrites arguments before forwarding upstream methods.
   */
  wrapArgs?: (
    context: NodeProxyContext<TTarget, TSource>,
    prop: PropertyKey,
    args: unknown[],
    receiver: unknown,
  ) => unknown[];
}

function createNodeProxyContext<
  TTarget extends EffectProxyTarget<TSource>,
  TSource extends object,
>(target: TTarget): NodeProxyContext<TTarget, TSource> {
  const internals = getEffectInternals(target);
  return {
    methodCache: internals.methodCache,
    state: internals.state,
    target,
    upstream: internals.upstream as TSource,
  };
}

function createBoundMethod<
  TTarget extends EffectProxyTarget<TSource>,
  TSource extends object,
>(
  context: NodeProxyContext<TTarget, TSource>,
  prop: PropertyKey,
  value: (...args: unknown[]) => unknown,
  config: NodeProxyInternalConfig<TTarget, TSource>,
  receiver: unknown,
): (...args: unknown[]) => unknown {
  const cache = context.methodCache;
  if (cache.has(prop)) {
    return cache.get(prop) as (...args: unknown[]) => unknown;
  }

  const wrapped = (...args: unknown[]) => {
    const nextArgs = config.wrapArgs?.(context, prop, args, receiver) ?? args;
    const result = Reflect.apply(value, context.upstream, nextArgs);
    return config.wrapResult?.(context, prop, result, receiver) ?? result;
  };

  cache.set(prop, wrapped);
  return wrapped;
}

/**
 * Creates an Effect-aware proxy around a local shell object.
 *
 * @param target The local Effect wrapper instance that already has upstream and
 * state symbols attached via `attachEffectState`.
 * @param config The extension hooks that define virtual properties,
 * interception points, and result rewrapping behavior for the proxy.
 */
export function createNodeProxy<
  TTarget extends EffectProxyTarget<TSource>,
  TSource extends object,
>(target: TTarget, config: NodeProxyConfig<TTarget, TSource>): TTarget {
  const privateKeys = new Set<PropertyKey>([effectInternalsSymbol]);
  const virtualKeys = new Set(config.virtualKeys ?? []);

  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (privateKeys.has(prop)) {
        return Reflect.get(currentTarget, prop, receiver);
      }

      const context = createNodeProxyContext<TTarget, TSource>(
        currentTarget as TTarget,
      );

      const virtualValue = config.getVirtual?.(context, prop, receiver);
      if (virtualValue !== undefined && virtualValue !== unhandledProperty) {
        return virtualValue;
      }

      const propertyValue = config.getProperty?.(context, prop, receiver);
      if (propertyValue !== undefined && propertyValue !== unhandledProperty) {
        return propertyValue;
      }

      const sourceValue = Reflect.get(context.upstream, prop, context.upstream);

      if (Reflect.has(context.upstream, prop)) {
        if (typeof sourceValue === "function") {
          return createBoundMethod(
            context,
            prop,
            sourceValue as (...args: unknown[]) => unknown,
            config,
            receiver,
          );
        }

        return sourceValue;
      }

      return Reflect.get(currentTarget, prop, receiver);
    },

    has(currentTarget, prop) {
      if (virtualKeys.has(prop)) {
        return true;
      }

      const context = createNodeProxyContext<TTarget, TSource>(currentTarget);
      return (
        Reflect.has(context.upstream, prop) || Reflect.has(currentTarget, prop)
      );
    },

    ownKeys(currentTarget) {
      const keys = new Set<string | symbol>();

      for (const key of Reflect.ownKeys(currentTarget)) {
        if (!privateKeys.has(key)) {
          keys.add(key);
        }
      }

      const context = createNodeProxyContext<TTarget, TSource>(
        currentTarget as TTarget,
      );

      for (const key of Reflect.ownKeys(context.upstream)) {
        keys.add(key);
      }

      for (const key of virtualKeys) {
        keys.add(key);
      }

      return [...keys];
    },

    getOwnPropertyDescriptor(currentTarget, prop) {
      const context = createNodeProxyContext<TTarget, TSource>(
        currentTarget as TTarget,
      );

      if (virtualKeys.has(prop)) {
        const value = config.getVirtual?.(context, prop, currentTarget);
        if (value !== undefined && value !== unhandledProperty) {
          return {
            configurable: true,
            enumerable: config.virtualDescriptors?.[prop]?.enumerable ?? false,
            value,
            writable: false,
          };
        }
      }

      const descriptor = Reflect.getOwnPropertyDescriptor(
        context.upstream,
        prop,
      );

      if (descriptor === undefined) {
        return Reflect.getOwnPropertyDescriptor(currentTarget, prop);
      }

      if ("value" in descriptor && typeof descriptor.value === "function") {
        return {
          ...descriptor,
          value: createBoundMethod(
            context,
            prop,
            descriptor.value as (...args: unknown[]) => unknown,
            config,
            currentTarget,
          ),
        };
      }

      return descriptor;
    },
  });
}

export function unhandled(): UnhandledProperty {
  return unhandledProperty;
}
