import {
  enhanceRoute,
  mergePrefix,
  type EnhanceRouteOptions,
} from "@orpc/contract";
import {
  createAccessibleLazyRouter,
  getLazyMeta,
  isLazy,
  isProcedure,
  lazy,
  mergeMiddlewares,
  unlazy,
  type AnyMiddleware,
  type AnyRouter,
  type Context,
  type Lazyable,
} from "@orpc/server";
import type { ManagedRuntime } from "effect/ManagedRuntime";

import { EffectProcedure } from "./effect-procedure";
import { getEffectErrorMap, unwrapEffectUpstream } from "./extension/state";
import { effectErrorMapToErrorMap, type EffectErrorMap } from "./tagged-error";
import type { EffectErrorMapToErrorMap, EnhancedEffectRouter } from "./types";

interface EnhanceEffectRouterOptions<
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
> extends EnhanceRouteOptions {
  middlewares: readonly AnyMiddleware[];
  errorMap: TEffectErrorMap;
  dedupeLeadingMiddlewares: boolean;
  runtime: ManagedRuntime<TRequirementsProvided, TRuntimeError>;
}

export function enhanceEffectRouter<
  T extends Lazyable<AnyRouter>,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
>(
  router: T,
  options: EnhanceEffectRouterOptions<
    TEffectErrorMap,
    TRequirementsProvided,
    TRuntimeError
  >,
): EnhancedEffectRouter<T, TInitialContext, TCurrentContext, TEffectErrorMap> {
  if (isLazy(router)) {
    const laziedMeta = getLazyMeta(router);
    const enhancedPrefix = laziedMeta?.prefix
      ? mergePrefix(options.prefix, laziedMeta.prefix)
      : options.prefix;

    const enhanced = lazy(
      async () => {
        const { default: unlaziedRouter } = await unlazy(router);
        const wrappedRouter = enhanceEffectRouter(unlaziedRouter, options);
        return unlazy(wrappedRouter);
      },
      {
        ...laziedMeta,
        prefix: enhancedPrefix,
      },
    );

    return createAccessibleLazyRouter(enhanced) as any;
  }

  if (isProcedure(router)) {
    const source = unwrapEffectUpstream(router);
    const sourceEffectErrorMap = getEffectErrorMap(router);
    const middlewares = mergeMiddlewares(
      options.middlewares,
      source["~orpc"].middlewares,
      { dedupeLeading: options.dedupeLeadingMiddlewares },
    );
    const newMiddlewareAdded =
      middlewares.length - source["~orpc"].middlewares.length;
    const effectErrorMap = {
      ...options.errorMap,
      ...sourceEffectErrorMap,
    };
    const errorMap: EffectErrorMapToErrorMap<typeof effectErrorMap> =
      effectErrorMapToErrorMap(effectErrorMap);

    return new EffectProcedure({
      ...source["~orpc"],
      route: enhanceRoute(source["~orpc"].route, options),
      effectErrorMap,
      errorMap: errorMap as EffectErrorMapToErrorMap<typeof effectErrorMap>,
      middlewares,
      inputValidationIndex:
        source["~orpc"].inputValidationIndex + newMiddlewareAdded,
      outputValidationIndex:
        source["~orpc"].outputValidationIndex + newMiddlewareAdded,
      runtime: options.runtime,
    }) as any;
  }

  const enhanced: Record<string, any> = {};

  for (const key in router) {
    enhanced[key] = enhanceEffectRouter(router[key]!, options);
  }

  return enhanced as any;
}
