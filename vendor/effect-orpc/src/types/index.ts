import type { ORPCError, ORPCErrorCode } from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  ErrorMapItem,
  Meta,
  Schema,
} from "@orpc/contract";
import type {
  Builder,
  BuilderDef,
  BuilderWithMiddlewares,
  Context,
  EnhanceRouterOptions,
  ProcedureBuilder,
  ProcedureBuilderWithInput,
  ProcedureBuilderWithInputOutput,
  ProcedureBuilderWithOutput,
  ProcedureDef,
  ProcedureHandlerOptions,
  MiddlewareNextFnOptions,
  MiddlewareOptions,
  MiddlewareResult,
  RouterBuilder,
} from "@orpc/server";
import type { MaybeOptionalOptions } from "@orpc/shared";
import type {
  Context as EffectContext,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
} from "effect";

import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  EffectErrorMapToUnion,
  ORPCTaggedErrorInstance,
} from "../tagged-error";

type EffectBuilderDefBase<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> = EnhanceRouterOptions<EffectErrorMapToErrorMap<TEffectErrorMap>> &
  BuilderDef<
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
  >;

/**
 * Extended builder definition that includes the Effect ManagedRuntime.
 */
export interface EffectBuilderDef<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends EffectBuilderDefBase<
  TInputSchema,
  TOutputSchema,
  TEffectErrorMap,
  TMeta
> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  /**
   * Optional span configuration for Effect tracing.
   */
  spanConfig?: EffectSpanConfig;
  /**
   * Functions that add attributes to the active procedure span and structured logs.
   */
  spanAnnotations?: readonly EffectSpanAnnotation<any, any, any, any>[];
  /**
   * Effect-extended error map that supports both traditional errors and tagged errors.
   */
  effectErrorMap: TEffectErrorMap;
  effectSteps?: readonly EffectPipelineStep[];
  effectHandler?: EffectProcedureHandlerConfig;
}

/**
 * Extended procedure definition that includes the Effect ManagedRuntime.
 */
export interface EffectProcedureDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends ProcedureDef<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  EffectErrorMapToErrorMap<TEffectErrorMap>,
  TMeta
> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  effectSteps?: readonly EffectPipelineStep[];
  effectHandler?: EffectProcedureHandlerConfig;
}

/**
 * Configuration for Effect span tracing.
 */
export interface EffectSpanConfig {
  /**
   * The name of the span for telemetry.
   */
  name: string;
  /**
   * Function to lazily capture the stack trace at definition time.
   */
  captureStackTrace: () => string | undefined;
}

export type EffectSpanAttributes = Record<
  string,
  string | number | boolean | null | undefined
>;

export type EffectSpanAnnotation<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> = (
  opts: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => EffectSpanAttributes;

/**
 * Handler type for Effect procedures.
 * The handler receives procedure options and returns an Effect.
 */
export type EffectProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  THandlerOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = (
  opt: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => Generator<
  Effect.Effect<
      any,
      | EffectErrorMapToUnion<TEffectErrorMap>
      | ORPCError<ORPCErrorCode, unknown>,
      TRequirementsProvided
    >,
  THandlerOutput,
  never
>;

export interface EffectProcedureHandlerConfig {
  readonly effectFn: EffectProcedureHandler<any, any, any, any, any, any>;
  readonly defaultCaptureStackTrace: () => string | undefined;
  readonly spanAnnotations?: readonly EffectSpanAnnotation<
    any,
    any,
    any,
    any
  >[];
  readonly spanConfig?: EffectSpanConfig;
}

type EffectTagService<T extends EffectContext.Service<any, any>> =
  T extends EffectContext.Service<any, infer S> ? S : never;

export type EffectProvider<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
  TTag extends EffectContext.Service<any, any>,
> = (
  opt: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => Effect.Effect<
  EffectTagService<TTag>,
  EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
  TRequirementsProvided
>;

export type EffectOptionalProvider<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
  TTag extends EffectContext.Service<any, any>,
> = (
  opt: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => Effect.Effect<
  Option.Option<EffectTagService<TTag>>,
  EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
  TRequirementsProvided
>;

interface EffectMiddlewareNext<
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
> {
  <UOutContext extends Context = Record<never, never>>(
    ...rest: MaybeOptionalOptions<MiddlewareNextFnOptions<UOutContext>>
  ): Effect.Effect<
    EffectMiddlewareResult<UOutContext, TOutput>,
    EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
    TRequirementsProvided
  >;
}

export type EffectMiddlewareResult<TOutContext extends Context, TOutput> = {
  readonly output: TOutput;
  readonly context: TOutContext;
};

export interface EffectMiddlewareOutput<
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
> {
  (
    output: TOutput,
  ): Effect.Effect<
    EffectMiddlewareResult<Record<never, never>, TOutput>,
    EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
    TRequirementsProvided
  >;
}

/**
 * Contextual typing bridge for `.use(...)` overloads.
 *
 * At runtime `next()` is either Effect-native or oRPC-native depending on
 * whether the middleware is a generator function. At type-check time we need
 * inline middleware to support both `return next()` and `yield* next()` without
 * an explicit annotation. The return type is intentionally an intersection:
 * assignable to `PromiseLike<A>` for native middleware, and yieldable as an
 * `Effect<A, E, R>` for Effect middleware.
 */
type EffectAndPromiseLike<A, E, R> = Effect.Effect<A, E, R> & PromiseLike<A>;

/** A `next` function that can be consumed by native oRPC or Effect middleware. */
interface EffectOrORPCMiddlewareNext<
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
> {
  <UOutContext extends Context = Record<never, never>>(
    ...rest: MaybeOptionalOptions<MiddlewareNextFnOptions<UOutContext>>
  ): EffectAndPromiseLike<
    EffectMiddlewareResult<UOutContext, TOutput>,
    EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
    TRequirementsProvided
  >;
}

/** An `output` helper that can be consumed by native oRPC or Effect middleware. */
interface EffectOrORPCMiddlewareOutput<
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
> {
  (
    output: TOutput,
  ): EffectAndPromiseLike<
    EffectMiddlewareResult<Record<never, never>, TOutput>,
    EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
    TRequirementsProvided
  >;
}

/** Middleware options with the dual-shape `next` used for `.use(...)` inference. */
type EffectOrORPCMiddlewareOptions<
  TCurrentContext extends Context,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = Omit<
  MiddlewareOptions<
    TCurrentContext,
    TOutput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
  "next"
> & {
  readonly next: EffectOrORPCMiddlewareNext<
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided
  >;
};

/**
 * Public `.use(...)` middleware shape.
 *
 * Accepts native oRPC middleware returns (`result` / `PromiseLike<result>`) and
 * Effect generator middleware returns. Runtime dispatch still uses
 * `isEffectMiddleware(...)`; this type only makes the inline callback ergonomic.
 */
export type EffectOrORPCMiddleware<
  TCurrentContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = (
  opt: EffectOrORPCMiddlewareOptions<
    TCurrentContext,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta
  >,
  input: TInput,
  output: EffectOrORPCMiddlewareOutput<
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided
  >,
) =>
  | MiddlewareResult<TOutContext, TOutput>
  | PromiseLike<MiddlewareResult<TOutContext, TOutput>>
  | Generator<
      Effect.Effect<
          unknown,
          | EffectErrorMapToUnion<TEffectErrorMap>
          | ORPCError<ORPCErrorCode, unknown>,
          TRequirementsProvided
        >,
      EffectMiddlewareResult<TOutContext, TOutput> | void,
      never
    >;

export type EffectMiddlewareOptions<
  TCurrentContext extends Context,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = Omit<
  MiddlewareOptions<
    TCurrentContext,
    TOutput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
  "next"
> & {
  readonly next: EffectMiddlewareNext<
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided
  >;
};

export type EffectMiddleware<
  TCurrentContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = (
  opt: EffectMiddlewareOptions<
    TCurrentContext,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta
  >,
  input: TInput,
  output: EffectMiddlewareOutput<
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided
  >,
) => Generator<
  Effect.Effect<
      unknown,
      | EffectErrorMapToUnion<TEffectErrorMap>
      | ORPCError<ORPCErrorCode, unknown>,
      TRequirementsProvided
    >,
  EffectMiddlewareResult<TOutContext, TOutput> | void,
  never
>;

type EffectProvideStep = {
  readonly _tag: "provide";
  readonly tag: EffectContext.Service<any, any>;
  readonly provider: EffectProvider<any, any, any, any, any, any>;
};

type EffectProvideOptionalStep = {
  readonly _tag: "provideOptional";
  readonly tag: EffectContext.Service<any, any>;
  readonly provider: EffectOptionalProvider<any, any, any, any, any, any>;
};

type EffectProvideLayerStep = {
  readonly _tag: "provideLayer";
  readonly layer: Layer.Layer<any, any, any>;
};

type EffectMiddlewareStep = {
  readonly _tag: "middleware";
  readonly middleware: EffectMiddleware<any, any, any, any, any, any, any>;
};

export type EffectPipelineStep =
  | EffectProvideStep
  | EffectProvideOptionalStep
  | EffectProvideLayerStep
  | EffectMiddlewareStep;

export type EffectErrorMapToErrorMap<T extends EffectErrorMap> = {
  [K in keyof T as T[K] extends ErrorMapItem<AnySchema>
    ? K extends ORPCErrorCode
      ? K
      : never
    : T[K] extends {
          new (...args: any[]): ORPCTaggedErrorInstance<any, any, any>;
        }
      ? T[K] extends { readonly code: infer TCode extends ORPCErrorCode }
        ? TCode
        : never
      : never]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<AnySchema>
      ? T[K]
      : T[K] extends {
            new (
              ...args: any[]
            ): ORPCTaggedErrorInstance<any, any, infer TSchema>;
          }
        ? ErrorMapItem<TSchema>
        : never
    : never;
};

/**
 * Any oRPC builder-like object that has the `~orpc` definition property.
 * This includes Builder, BuilderWithMiddlewares, ProcedureBuilder, etc.
 */
export interface AnyBuilderLike<
  TInputSchema extends AnySchema = AnySchema,
  TOutputSchema extends AnySchema = AnySchema,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> {
  "~orpc": BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;
}

/**
 * Infers the initial context from an oRPC builder type.
 * Since context is a phantom type parameter not present in `~orpc`,
 * we need to use conditional type inference on the known builder types.
 */
export type InferBuilderInitialContext<T> =
  T extends Builder<infer TInitial, any, any, any, any, any>
    ? TInitial
    : T extends BuilderWithMiddlewares<infer TInitial, any, any, any, any, any>
      ? TInitial
      : T extends ProcedureBuilder<infer TInitial, any, any, any, any, any>
        ? TInitial
        : T extends ProcedureBuilderWithInput<
              infer TInitial,
              any,
              any,
              any,
              any,
              any
            >
          ? TInitial
          : T extends ProcedureBuilderWithOutput<
                infer TInitial,
                any,
                any,
                any,
                any,
                any
              >
            ? TInitial
            : T extends ProcedureBuilderWithInputOutput<
                  infer TInitial,
                  any,
                  any,
                  any,
                  any,
                  any
                >
              ? TInitial
              : T extends RouterBuilder<infer TInitial, any, any, any>
                ? TInitial
                : Context;

/**
 * Infers the current context from an oRPC builder type.
 * Since context is a phantom type parameter not present in `~orpc`,
 * we need to use conditional type inference on the known builder types.
 */
export type InferBuilderCurrentContext<T> =
  T extends Builder<any, infer TCurrent, any, any, any, any>
    ? TCurrent
    : T extends BuilderWithMiddlewares<any, infer TCurrent, any, any, any, any>
      ? TCurrent
      : T extends ProcedureBuilder<any, infer TCurrent, any, any, any, any>
        ? TCurrent
        : T extends ProcedureBuilderWithInput<
              any,
              infer TCurrent,
              any,
              any,
              any,
              any
            >
          ? TCurrent
          : T extends ProcedureBuilderWithOutput<
                any,
                infer TCurrent,
                any,
                any,
                any,
                any
              >
            ? TCurrent
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  infer TCurrent,
                  any,
                  any,
                  any,
                  any
                >
              ? TCurrent
              : T extends RouterBuilder<any, infer TCurrent, any, any>
                ? TCurrent
                : Context;

/**
 * Infers the input schema from an oRPC builder type.
 */
export type InferBuilderInputSchema<T> =
  T extends Builder<any, any, infer TInput, any, any, any>
    ? TInput
    : T extends BuilderWithMiddlewares<any, any, infer TInput, any, any, any>
      ? TInput
      : T extends ProcedureBuilder<any, any, infer TInput, any, any, any>
        ? TInput
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              infer TInput,
              any,
              any,
              any
            >
          ? TInput
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                infer TInput,
                any,
                any,
                any
              >
            ? TInput
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  infer TInput,
                  any,
                  any,
                  any
                >
              ? TInput
              : Schema<unknown, unknown>;

/**
 * Infers the output schema from an oRPC builder type.
 */
export type InferBuilderOutputSchema<T> =
  T extends Builder<any, any, any, infer TOutput, any, any>
    ? TOutput
    : T extends BuilderWithMiddlewares<any, any, any, infer TOutput, any, any>
      ? TOutput
      : T extends ProcedureBuilder<any, any, any, infer TOutput, any, any>
        ? TOutput
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              infer TOutput,
              any,
              any
            >
          ? TOutput
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                infer TOutput,
                any,
                any
              >
            ? TOutput
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  infer TOutput,
                  any,
                  any
                >
              ? TOutput
              : Schema<unknown, unknown>;

/**
 * Infers the error map from an oRPC builder type.
 */
export type InferBuilderErrorMap<T> =
  T extends Builder<any, any, any, any, infer TErrorMap, any>
    ? TErrorMap
    : T extends BuilderWithMiddlewares<any, any, any, any, infer TErrorMap, any>
      ? TErrorMap
      : T extends ProcedureBuilder<any, any, any, any, infer TErrorMap, any>
        ? TErrorMap
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              any,
              infer TErrorMap,
              any
            >
          ? TErrorMap
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                any,
                infer TErrorMap,
                any
              >
            ? TErrorMap
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  any,
                  infer TErrorMap,
                  any
                >
              ? TErrorMap
              : T extends RouterBuilder<any, any, infer TErrorMap, any>
                ? TErrorMap
                : ErrorMap;

/**
 * Infers the meta from an oRPC builder type.
 */
export type InferBuilderMeta<T> =
  T extends Builder<any, any, any, any, any, infer TMeta>
    ? TMeta
    : T extends BuilderWithMiddlewares<any, any, any, any, any, infer TMeta>
      ? TMeta
      : T extends ProcedureBuilder<any, any, any, any, any, infer TMeta>
        ? TMeta
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              any,
              any,
              infer TMeta
            >
          ? TMeta
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                any,
                any,
                infer TMeta
              >
            ? TMeta
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  any,
                  any,
                  infer TMeta
                >
              ? TMeta
              : T extends RouterBuilder<any, any, any, infer TMeta>
                ? TMeta
                : Meta;

export type { EffectBuilderSurface } from "./effect-builder-surface";
export type { EffectDecoratedProcedureSurface } from "./effect-procedure-surface";

export * from "./variants";
