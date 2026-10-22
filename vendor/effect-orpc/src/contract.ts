import type {
  AnyContractRouter,
  AnySchema,
  ContractProcedure,
  ErrorMap,
  InferContractRouterErrorMap,
  InferContractRouterMeta,
  InferSchemaInput,
  InferSchemaOutput,
  Meta,
} from "@orpc/contract";
import { isContractProcedure } from "@orpc/contract";
import type {
  BuilderConfig,
  BuilderDef,
  Context,
  DecoratedMiddleware,
  ImplementedProcedure,
  Lazy,
  MapInputMiddleware,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ORPCErrorConstructorMap,
  ProcedureHandler,
  Router,
} from "@orpc/server";
import { implement } from "@orpc/server";
import type { IntersectPick } from "@orpc/shared";
import type { Layer, ManagedRuntime } from "effect";

import { addSpanStackTrace } from "./effect-builder";
import { enhanceEffectRouter } from "./effect-enhance-router";
import { EffectDecoratedProcedure } from "./effect-procedure";
import { createEffectProcedureHandler } from "./effect-runtime";
import { effectContractSymbol, getEffectContractErrorMap } from "./eoc";
import type { EffectRuntimeSource } from "./runtime-source";
import { toManagedRuntime } from "./runtime-source";
import type { EffectErrorMap } from "./tagged-error";
import { effectErrorMapToErrorMap } from "./tagged-error";
import type {
  EffectErrorMapToErrorMap,
  EffectProcedureHandler,
  EffectSpanAnnotation,
} from "./types";

type ContractLeafEffectHandler<
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = EffectProcedureHandler<
  TCurrentContext,
  InferSchemaOutput<TInputSchema>,
  InferSchemaInput<TOutputSchema>,
  TErrorMap,
  TRequirementsProvided,
  TMeta
>;

type InferContractLeafEffectErrorMap<
  TContract,
  TErrorMap extends ErrorMap,
> = TContract extends {
  [effectContractSymbol]: {
    errorMap: infer TEffectErrorMap extends EffectErrorMap;
  };
}
  ? TEffectErrorMap
  : TErrorMap;

export interface EffectProcedureImplementer<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> {
  "~orpc": BuilderDef<
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TErrorMap>,
    TMeta
  >;
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<EffectErrorMapToErrorMap<TErrorMap>>,
      TMeta
    >,
  ): EffectProcedureImplementer<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInput,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      UInput,
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<EffectErrorMapToErrorMap<TErrorMap>>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): EffectProcedureImplementer<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  handler(
    handler: ProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      EffectErrorMapToErrorMap<TErrorMap>,
      TMeta
    >,
  ): ImplementedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TErrorMap>,
    TMeta
  >;
  annotateSpan(
    getSpanAttributes: EffectSpanAnnotation<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TErrorMap,
      TMeta
    >,
  ): EffectProcedureImplementer<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  effect(
    effectFn: ContractLeafEffectHandler<
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
}

export type EffectImplementerInternal<
  TContract extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TRequirementsProvided,
  TRuntimeError,
> =
  TContract extends ContractProcedure<
    infer TInputSchema,
    infer TOutputSchema,
    infer TErrorMap extends ErrorMap,
    infer TMeta extends Meta
  >
    ? EffectProcedureImplementer<
        TInitialContext,
        TCurrentContext,
        TInputSchema,
        TOutputSchema,
        InferContractLeafEffectErrorMap<TContract, TErrorMap>,
        TMeta,
        TRequirementsProvided,
        TRuntimeError
      >
    : {
        middleware<
          UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
          TInput,
          TOutput = any,
        >(
          middleware: Middleware<
            TInitialContext,
            UOutContext,
            TInput,
            TOutput,
            ORPCErrorConstructorMap<InferContractRouterErrorMap<TContract>>,
            InferContractRouterMeta<TContract>
          >,
        ): DecoratedMiddleware<
          TInitialContext,
          UOutContext,
          TInput,
          TOutput,
          any,
          InferContractRouterMeta<TContract>
        >;
        use<
          UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
          UInContext extends Context = TCurrentContext,
        >(
          middleware: Middleware<
            UInContext | TCurrentContext,
            UOutContext,
            unknown,
            unknown,
            ORPCErrorConstructorMap<InferContractRouterErrorMap<TContract>>,
            InferContractRouterMeta<TContract>
          >,
        ): EffectImplementerInternal<
          TContract,
          MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
          MergedCurrentContext<TCurrentContext, UOutContext>,
          TRequirementsProvided,
          TRuntimeError
        >;
        router<U extends Router<TContract, TCurrentContext>>(
          router: U,
        ): ReturnType<
          typeof enhanceEffectRouter<
            U,
            TInitialContext,
            TCurrentContext,
            Record<never, never>,
            TRequirementsProvided,
            TRuntimeError
          >
        >;
        lazy<U extends Router<TContract, TCurrentContext>>(
          loader: () => Promise<{ default: U }>,
        ): ReturnType<
          typeof enhanceEffectRouter<
            Lazy<U>,
            TInitialContext,
            TCurrentContext,
            Record<never, never>,
            TRequirementsProvided,
            TRuntimeError
          >
        >;
        annotateSpan(
          getSpanAttributes: EffectSpanAnnotation<
            TCurrentContext,
            unknown,
            EffectErrorMap,
            InferContractRouterMeta<TContract>
          >,
        ): EffectImplementerInternal<
          TContract,
          TInitialContext,
          TCurrentContext,
          TRequirementsProvided,
          TRuntimeError
        >;
      } & {
        [K in keyof TContract]: TContract[K] extends AnyContractRouter
          ? EffectImplementerInternal<
              TContract[K],
              TInitialContext,
              TCurrentContext,
              TRequirementsProvided,
              TRuntimeError
            >
          : never;
      };

export type EffectImplementer<
  TContract extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TRequirementsProvided,
  TRuntimeError,
> = {
  $context<U extends Context>(): EffectImplementer<
    TContract,
    U & Record<never, never>,
    U,
    TRequirementsProvided,
    TRuntimeError
  >;
  $config(
    config: BuilderConfig,
  ): EffectImplementer<
    TContract,
    TInitialContext,
    TCurrentContext,
    TRequirementsProvided,
    TRuntimeError
  >;
} & EffectImplementerInternal<
  TContract,
  TInitialContext,
  TCurrentContext,
  TRequirementsProvided,
  TRuntimeError
>;

const CONTRACT_HIDDEN_METHODS = new Set([
  "$config",
  "$context",
  "$input",
  "$meta",
  "$route",
  "errors",
  "input",
  "lazy",
  "meta",
  "middleware",
  "output",
  "prefix",
  "route",
  "router",
  "tag",
]);

function makeEnhanceOptions<TRequirementsProvided, TRuntimeError>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
) {
  return {
    middlewares: [],
    errorMap: {},
    dedupeLeadingMiddlewares: true,
    runtime,
  } as const;
}

function wrapContractNode<
  TContract extends AnyContractRouter,
  TRequirementsProvided,
  TRuntimeError,
>(
  contract: TContract,
  target: any,
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  spanAnnotations: readonly EffectSpanAnnotation<any, any, any, any>[] = [],
): EffectImplementerInternal<
  TContract,
  Context,
  Context,
  TRequirementsProvided,
  TRuntimeError
> {
  const cache = new Map<PropertyKey, unknown>();

  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (cache.has(prop)) {
        return cache.get(prop);
      }

      if (isContractProcedure(contract)) {
        if (prop === "effect") {
          const effect = (
            effectFn: ContractLeafEffectHandler<any, any, any, any, any, any>,
          ) => {
            const effectErrorMap =
              getEffectContractErrorMap(contract) ??
              currentTarget["~orpc"].errorMap;

            return new EffectDecoratedProcedure({
              ...currentTarget["~orpc"],
              errorMap: effectErrorMapToErrorMap(effectErrorMap),
              effectErrorMap,
              runtime,
              handler: createEffectProcedureHandler({
                runtime,
                effectErrorMap,
                effectFn,
                spanAnnotations,
                defaultCaptureStackTrace: addSpanStackTrace(),
              }),
            });
          };

          cache.set(prop, effect);
          return effect;
        }

        if (prop === "annotateSpan") {
          const annotateSpan = (
            getSpanAttributes: EffectSpanAnnotation<any, any, any, any>,
          ) =>
            wrapContractNode(contract, currentTarget, runtime, [
              ...spanAnnotations,
              getSpanAttributes,
            ]);

          cache.set(prop, annotateSpan);
          return annotateSpan;
        }

        if (prop === "use") {
          const use = (...args: unknown[]) =>
            wrapContractNode(
              contract,
              Reflect.apply(
                Reflect.get(currentTarget, prop, currentTarget),
                currentTarget,
                args,
              ),
              runtime,
              spanAnnotations,
            );

          cache.set(prop, use);
          return use;
        }

        if (CONTRACT_HIDDEN_METHODS.has(String(prop))) {
          return undefined;
        }
      } else {
        if (prop === "annotateSpan") {
          const annotateSpan = (
            getSpanAttributes: EffectSpanAnnotation<any, any, any, any>,
          ) =>
            wrapContractNode(contract, currentTarget, runtime, [
              ...spanAnnotations,
              getSpanAttributes,
            ]);

          cache.set(prop, annotateSpan);
          return annotateSpan;
        }

        if (prop === "$context" || prop === "$config" || prop === "use") {
          const wrappedMethod = (...args: unknown[]) =>
            wrapContractNode(
              contract,
              Reflect.apply(
                Reflect.get(currentTarget, prop, currentTarget),
                currentTarget,
                args,
              ),
              runtime,
              spanAnnotations,
            );

          cache.set(prop, wrappedMethod);
          return wrappedMethod;
        }

        if (prop === "router" || prop === "lazy") {
          const wrappedMethod = (...args: unknown[]) =>
            enhanceEffectRouter(
              Reflect.apply(
                Reflect.get(currentTarget, prop, currentTarget),
                currentTarget,
                args,
              ) as any,
              makeEnhanceOptions(runtime),
            );

          cache.set(prop, wrappedMethod);
          return wrappedMethod;
        }

        if (typeof prop === "string" && prop in contract) {
          const child = wrapContractNode(
            (contract as Record<string, AnyContractRouter>)[prop]!,
            Reflect.get(currentTarget, prop, receiver),
            runtime,
            spanAnnotations,
          );

          cache.set(prop, child);
          return child;
        }
      }

      const value = Reflect.get(currentTarget, prop, receiver);
      return typeof value === "function" ? value.bind(currentTarget) : value;
    },
    has(currentTarget, prop) {
      if (isContractProcedure(contract)) {
        if (prop === "effect") {
          return true;
        }
        if (CONTRACT_HIDDEN_METHODS.has(String(prop))) {
          return false;
        }
      } else if (typeof prop === "string" && prop in contract) {
        return true;
      }

      return Reflect.has(currentTarget, prop);
    },
  }) as EffectImplementerInternal<
    TContract,
    Context,
    Context,
    TRequirementsProvided,
    TRuntimeError
  >;
}

export function implementEffect<
  TContract extends AnyContractRouter,
  TRequirementsProvided,
  TRuntimeError,
>(
  contract: TContract,
  layer: Layer.Layer<TRequirementsProvided, TRuntimeError, never>,
): EffectImplementer<
  TContract,
  Record<never, never>,
  Record<never, never>,
  TRequirementsProvided,
  TRuntimeError
>;

export function implementEffect<
  TContract extends AnyContractRouter,
  TRequirementsProvided,
  TRuntimeError,
>(
  contract: TContract,
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
): EffectImplementer<
  TContract,
  Record<never, never>,
  Record<never, never>,
  TRequirementsProvided,
  TRuntimeError
>;

export function implementEffect<
  TContract extends AnyContractRouter,
  TRequirementsProvided,
  TRuntimeError,
>(
  contract: TContract,
  source: EffectRuntimeSource<TRequirementsProvided, TRuntimeError>,
): EffectImplementer<
  TContract,
  Record<never, never>,
  Record<never, never>,
  TRequirementsProvided,
  TRuntimeError
> {
  return wrapContractNode(
    contract,
    implement(contract),
    toManagedRuntime(source),
  ) as EffectImplementer<
    TContract,
    Record<never, never>,
    Record<never, never>,
    TRequirementsProvided,
    TRuntimeError
  >;
}
