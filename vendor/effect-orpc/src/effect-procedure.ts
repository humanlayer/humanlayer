import type { ClientContext } from "@orpc/client";
import type { AnySchema, Meta, Route } from "@orpc/contract";
import { mergeMeta, mergeRoute } from "@orpc/contract";
import type {
  AnyMiddleware,
  Context,
  CreateProcedureClientOptions,
  MapInputMiddleware,
  ProcedureDef,
} from "@orpc/server";
import {
  Procedure,
  addMiddleware,
  createActionableClient,
  createProcedureClient,
  decorateMiddleware,
} from "@orpc/server";
import type { MaybeOptionalOptions } from "@orpc/shared";
import { Layer } from "effect";
import type { ManagedRuntime } from "effect";

import {
  createEffectOptionalProviderMiddleware,
  createEffectPipelineMiddleware,
  createEffectProcedureHandler,
  createEffectProviderMiddleware,
  isEffectMiddleware,
} from "./effect-runtime";
import { composeSurfaceProxy } from "./extension/compose-surfaces";
import {
  createNodeProxy,
  unhandled,
  type NodeProxyContext,
} from "./extension/create-node-proxy";
import {
  assertEffectState,
  attachEffectState,
  type EffectProxyTarget,
} from "./extension/state";
import type { EffectErrorMap, MergedEffectErrorMap } from "./tagged-error";
import { effectErrorMapToErrorMap } from "./tagged-error";
import type {
  EffectErrorMapToErrorMap,
  EffectPipelineStep,
  EffectProcedureDef,
} from "./types";
import type { EffectDecoratedProcedureSurface } from "./types/effect-procedure-surface";

type AnyProcedureLike = Procedure<any, any, any, any, any, any>;
type AnyEffectProcedure = EffectProcedure<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;
type AnyEffectDecoratedProcedure = EffectDecoratedProcedure<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;
type EffectProcedureTarget<
  T extends AnyEffectProcedure | AnyEffectDecoratedProcedure =
    | AnyEffectProcedure
    | AnyEffectDecoratedProcedure,
> = T & EffectProxyTarget<AnyProcedureLike>;

const procedureVirtualDescriptors = {
  "~effect": { enumerable: true },
  actionable: { enumerable: false },
  callable: { enumerable: false },
  errors: { enumerable: false },
  meta: { enumerable: false },
  provide: { enumerable: false },
  provideOptional: { enumerable: false },
  route: { enumerable: false },
  use: { enumerable: false },
  withRuntime: { enumerable: false },
} as const;

const baseProcedureVirtualKeys = ["~effect"] as const;
const decoratedProcedureVirtualKeys = [
  ...baseProcedureVirtualKeys,
  "errors",
  "meta",
  "provide",
  "provideOptional",
  "route",
  "use",
  "withRuntime",
  "callable",
  "actionable",
] as const;

function getOrCreateVirtualMethod<T>(
  context: NodeProxyContext<EffectProcedureTarget, AnyProcedureLike>,
  prop: PropertyKey,
  factory: () => T,
): T {
  const cache = context.methodCache;
  if (cache.has(prop)) {
    return cache.get(prop) as T;
  }

  const value = factory();
  cache.set(prop, value);
  return value;
}

function getEffectProcedureDef(
  context: NodeProxyContext<EffectProcedureTarget, AnyProcedureLike>,
): EffectProcedureDef<any, any, any, any, any, any, any, any> {
  return {
    ...context.upstream["~orpc"],
    effectSteps: context.state.effectSteps,
    effectHandler: context.state.effectHandler,
    effectErrorMap: context.state.effectErrorMap,
    runtime: context.state.runtime,
  };
}

function makeEffectProcedureHandler(
  def: EffectProcedureDef<any, any, any, any, any, any, any, any>,
) {
  if (!def.effectHandler) {
    return def.handler;
  }

  return createEffectProcedureHandler({
    defaultCaptureStackTrace: def.effectHandler.defaultCaptureStackTrace,
    effectErrorMap: def.effectErrorMap,
    effectFn: def.effectHandler.effectFn,
    effectSteps: def.effectSteps,
    runtime: def.runtime,
    spanAnnotations: def.effectHandler.spanAnnotations,
    spanConfig: def.effectHandler.spanConfig,
  });
}

function withRebuiltEffectHandler(
  def: EffectProcedureDef<any, any, any, any, any, any, any, any>,
): EffectProcedureDef<any, any, any, any, any, any, any, any> {
  return {
    ...def,
    handler: makeEffectProcedureHandler(def),
  };
}

function appendEffectStep(
  def: EffectProcedureDef<any, any, any, any, any, any, any, any>,
  step: EffectPipelineStep,
): EffectProcedureDef<any, any, any, any, any, any, any, any> {
  return withRebuiltEffectHandler({
    ...def,
    effectSteps: [...(def.effectSteps ?? []), step],
  });
}

function flushEffectSteps(
  def: EffectProcedureDef<any, any, any, any, any, any, any, any>,
): EffectProcedureDef<any, any, any, any, any, any, any, any> {
  if (!def.effectSteps?.length) {
    return def;
  }

  const middleware = createEffectPipelineMiddleware({
    effectErrorMap: def.effectErrorMap,
    runtime: def.runtime,
    steps: def.effectSteps,
  });

  return withRebuiltEffectHandler({
    ...def,
    effectSteps: undefined,
    middlewares: addMiddleware(def.middlewares, middleware),
  });
}

function createEffectProcedureProxy<
  T extends AnyEffectProcedure | AnyEffectDecoratedProcedure,
>(
  target: EffectProcedureTarget<T>,
  decorated: boolean,
): EffectProcedureTarget<T> {
  return createNodeProxy<EffectProcedureTarget<T>, AnyProcedureLike>(target, {
    getVirtual(context, prop, receiver) {
      if (prop === "~effect") {
        return getEffectProcedureDef(context);
      }

      if (!decorated) {
        return unhandled();
      }

      const state = context.state;

      switch (prop) {
        case "errors":
          return getOrCreateVirtualMethod(context, prop, () => {
            return <U extends EffectErrorMap>(errors: U) => {
              const nextEffectErrorMap: MergedEffectErrorMap<
                typeof state.effectErrorMap,
                U
              > = {
                ...state.effectErrorMap,
                ...errors,
              };
              return new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                effectErrorMap: nextEffectErrorMap,
                errorMap: effectErrorMapToErrorMap(nextEffectErrorMap),
              });
            };
          });
        case "meta":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (meta: Meta) =>
              new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                meta: mergeMeta(getEffectProcedureDef(context).meta, meta),
              });
          });
        case "route":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (route: Route) =>
              new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                route: mergeRoute(getEffectProcedureDef(context).route, route),
              });
          });
        case "provide":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (tagOrLayer: any, provider?: any) => {
              const def = getEffectProcedureDef(context);

              if (Layer.isLayer(tagOrLayer)) {
                const step = {
                  _tag: "provideLayer" as const,
                  layer: tagOrLayer,
                };

                if (def.effectHandler) {
                  return new EffectDecoratedProcedure(
                    appendEffectStep(def, step),
                  );
                }

                return new EffectDecoratedProcedure({
                  ...def,
                  middlewares: addMiddleware(
                    def.middlewares,
                    createEffectPipelineMiddleware({
                      effectErrorMap: state.effectErrorMap,
                      runtime: state.runtime,
                      steps: [step],
                    }),
                  ),
                });
              }

              if (def.effectHandler) {
                return new EffectDecoratedProcedure(
                  appendEffectStep(def, {
                    _tag: "provide",
                    provider,
                    tag: tagOrLayer,
                  }),
                );
              }

              return new EffectDecoratedProcedure({
                ...def,
                middlewares: addMiddleware(
                  def.middlewares,
                  createEffectProviderMiddleware({
                    effectErrorMap: state.effectErrorMap,
                    provider,
                    runtime: state.runtime,
                    tag: tagOrLayer,
                  }),
                ),
              });
            };
          });
        case "provideOptional":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (tag: any, provider: any) => {
              const def = getEffectProcedureDef(context);

              if (def.effectHandler) {
                return new EffectDecoratedProcedure(
                  appendEffectStep(def, {
                    _tag: "provideOptional",
                    provider,
                    tag,
                  }),
                );
              }

              return new EffectDecoratedProcedure({
                ...def,
                middlewares: addMiddleware(
                  def.middlewares,
                  createEffectOptionalProviderMiddleware({
                    effectErrorMap: state.effectErrorMap,
                    provider,
                    runtime: state.runtime,
                    tag,
                  }),
                ),
              });
            };
          });
        case "use":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              middleware: AnyMiddleware,
              mapInput?: MapInputMiddleware<any, any>,
            ) => {
              const def = getEffectProcedureDef(context);
              if (!mapInput && isEffectMiddleware(middleware)) {
                return new EffectDecoratedProcedure(
                  appendEffectStep(def, {
                    _tag: "middleware",
                    middleware,
                  }),
                );
              }

              const flushedDef = flushEffectSteps(def);
              const mapped = mapInput
                ? decorateMiddleware(middleware).mapInput(mapInput)
                : middleware;

              return new EffectDecoratedProcedure({
                ...flushedDef,
                middlewares: addMiddleware(flushedDef.middlewares, mapped),
              });
            };
          });
        case "withRuntime":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (runtime: ManagedRuntime.ManagedRuntime<any, any>) =>
              new EffectDecoratedProcedure(
                withRebuiltEffectHandler({
                  ...getEffectProcedureDef(context),
                  runtime,
                }),
              );
          });
        case "callable":
          return <TClientContext extends ClientContext>(
            ...rest: MaybeOptionalOptions<
              CreateProcedureClientOptions<any, any, any, any, TClientContext>
            >
          ) => {
            const client = createProcedureClient(
              receiver as AnyProcedureLike,
              ...rest,
            );
            return composeSurfaceProxy(
              receiver as EffectDecoratedProcedure<
                any,
                any,
                any,
                any,
                any,
                any,
                any,
                any
              >,
              client,
            );
          };
        case "actionable":
          return (
            ...rest: MaybeOptionalOptions<
              CreateProcedureClientOptions<
                any,
                any,
                any,
                any,
                Record<never, never>
              >
            >
          ) => {
            const client = createProcedureClient(
              receiver as AnyProcedureLike,
              ...rest,
            );
            const action = createActionableClient(client);
            return composeSurfaceProxy(
              receiver as EffectDecoratedProcedure<
                any,
                any,
                any,
                any,
                any,
                any,
                any,
                any
              >,
              action,
            );
          };
        default:
          return unhandled();
      }
    },
    virtualDescriptors: procedureVirtualDescriptors,
    virtualKeys: decorated
      ? decoratedProcedureVirtualKeys
      : baseProcedureVirtualKeys,
  });
}

/**
 * Effect-aware base procedure that carries the upstream procedure definition
 * together with Effect runtime and error metadata.
 */
export class EffectProcedure<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends Procedure<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  EffectErrorMapToErrorMap<TEffectErrorMap>,
  TMeta
> {
  /**
   * This property holds the defined options and the effect-specific properties.
   */
  declare "~effect": EffectProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * This property holds the defined options.
   */
  declare "~orpc": ProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
  >;

  constructor(
    def: EffectProcedureDef<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >,
    procedure?: AnyProcedureLike,
  ) {
    const { effectSteps, effectHandler, ...procedureDef } = def;
    super(procedureDef);
    attachEffectState(this, procedure ?? new Procedure(procedureDef), {
      effectSteps,
      effectHandler,
      effectErrorMap: def.effectErrorMap,
      runtime: def.runtime,
    });

    if (new.target === EffectProcedure) {
      return createEffectProcedureProxy(this, false);
    }
  }
}

/**
 * An Effect-native decorated procedure that preserves Effect error and requirements types.
 *
 * This class extends Procedure with additional type parameters for Effect-specific
 * type information, allowing full type inference of Effect errors and requirements.
 */
export class EffectDecoratedProcedure<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
>
  extends EffectProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >
  implements
    EffectDecoratedProcedureSurface<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >
{
  /**
   * Adds type-safe custom errors.
   * Supports both traditional oRPC error definitions and ORPCTaggedError classes.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  declare errors: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["errors"];
  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  declare meta: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["meta"];
  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  declare route: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["route"];
  /**
   * Provides a request-scoped Effect service to downstream procedures.
   */
  declare provide: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["provide"];
  /**
   * Optionally provides a request-scoped Effect service to downstream procedures.
   */
  declare provideOptional: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["provideOptional"];
  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  declare use: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["use"];
  /**
   * Returns a copy of this procedure that executes with the provided Effect runtime.
   */
  declare withRuntime: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["withRuntime"];
  /**
   * Make this procedure callable (works like a function while still being a procedure).
   *
   * @see {@link https://orpc.dev/docs/client/server-side Server-side Client Docs}
   */
  declare callable: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["callable"];
  /**
   * Make this procedure compatible with server action.
   *
   * @see {@link https://orpc.dev/docs/server-action Server Action Docs}
   */
  declare actionable: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["actionable"];
  constructor(
    def: EffectProcedureDef<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >,
    procedure?: AnyProcedureLike,
  ) {
    super(def, procedure);
    assertEffectState<AnyProcedureLike>(this);
    return createEffectProcedureProxy(this, true);
  }
}
