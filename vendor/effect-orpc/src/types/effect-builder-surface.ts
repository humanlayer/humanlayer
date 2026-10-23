import type {
  AnySchema,
  ContractRouter,
  HTTPPath,
  InferSchemaOutput,
  Meta,
  Route,
  Schema,
} from "@orpc/contract";
import type {
  BuilderConfig,
  BuilderDef,
  Context,
  DecoratedMiddleware,
  Lazy,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ProcedureHandler,
  Router,
} from "@orpc/server";
import type { IntersectPick } from "@orpc/shared";
import type { Context as EffectContext, Layer } from "effect";

import type {
  EffectBuilderDef,
  EffectErrorMapToErrorMap,
  EffectOrORPCMiddleware,
  EffectOptionalProvider,
  EffectProcedureBuilderWithInput,
  EffectProcedureBuilderWithOutput,
  EffectProcedureHandler,
  EffectProvider,
  EffectRouterBuilder,
  EffectSpanAnnotation,
  EnhancedEffectRouter,
} from ".";
import type { EffectDecoratedProcedure } from "../effect-procedure";
import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  MergedEffectErrorMap,
} from "../tagged-error";

type EffectTagIdentifier<T extends EffectContext.Service<any, any>> =
  T extends EffectContext.Service<infer I, any> ? I : never;

export interface EffectBuilderSurface<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> {
  /**
   * This property holds the defined options and the effect-specific properties.
   */
  "~effect": EffectBuilderDef<
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
  "~orpc": BuilderDef<
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
  >;
  /**
   * Sets or overrides the config.
   *
   * @see {@link https://orpc.dev/docs/client/server-side#middlewares-order Middlewares Order Docs}
   * @see {@link https://orpc.dev/docs/best-practices/dedupe-middleware#configuration Dedupe Middleware Docs}
   */
  $config(
    config: BuilderConfig,
  ): EffectBuilderSurface<
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
   * Set or override the initial context.
   *
   * @see {@link https://orpc.dev/docs/context Context Docs}
   */
  $context<U extends Context>(): EffectBuilderSurface<
    U & Record<never, never>,
    U,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Sets or overrides the initial meta.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  $meta<U extends Meta>(
    initialMeta: U,
  ): EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    U & Record<never, never>,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Sets or overrides the initial route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  $route(
    initialRoute: Route,
  ): EffectBuilderSurface<
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
   * Sets or overrides the initial input schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#initial-configuration Initial Procedure Configuration Docs}
   */
  $input<U extends AnySchema>(
    initialInputSchema?: U,
  ): EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    U,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Creates a middleware.
   *
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  middleware<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    TInput,
    TOutput = any,
  >(
    middleware: EffectOrORPCMiddleware<
      TInitialContext,
      UOutContext,
      TInput,
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): DecoratedMiddleware<
    TInitialContext,
    UOutContext,
    TInput,
    TOutput,
    any,
    TMeta
  >;
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
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
  ): DecoratedMiddleware<
    TInitialContext,
    UOutContext,
    TInput,
    TOutput,
    any,
    TMeta
  >;
  /**
   * Adds type-safe custom errors.
   * Supports both traditional oRPC error definitions and ORPCTaggedError classes.
   *
   * @example
   * ```ts
   * // Traditional format
   * builder.errors({ BAD_REQUEST: { status: 400, message: 'Bad request' } })
   *
   * // Tagged error class
   * builder.errors({ USER_NOT_FOUND: UserNotFoundError })
   *
   * // Mixed
   * builder.errors({
   *   BAD_REQUEST: { status: 400 },
   *   USER_NOT_FOUND: UserNotFoundError,
   * })
   * ```
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Uses an Effect middleware or native oRPC middleware to modify the context, throw early, or modify the response.
   */
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: EffectOrORPCMiddleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      unknown,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectBuilderSurface<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      unknown,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
  ): EffectBuilderSurface<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Provides an Effect layer to downstream procedures.
   */
  provide<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided | TLayerOut,
    TRuntimeError | TLayerError
  >;
  /**
   * Provides a request-scoped Effect service to downstream procedures.
   */
  provide<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided | EffectTagIdentifier<TTag>,
    TRuntimeError
  >;
  /**
   * Optionally provides a request-scoped Effect service to downstream procedures.
   */
  provideOptional<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectOptionalProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectBuilderSurface<
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
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta(
    meta: TMeta,
  ): EffectBuilderSurface<
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
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  route(
    route: Route,
  ): EffectBuilderSurface<
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
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<USchema extends AnySchema>(
    schema: USchema,
  ): EffectProcedureBuilderWithInput<
    TInitialContext,
    TCurrentContext,
    USchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  output<USchema extends AnySchema>(
    schema: USchema,
  ): EffectProcedureBuilderWithOutput<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    USchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns An EffectBuilder with span tracing configured
   */
  traced(
    spanName: string,
  ): EffectBuilderSurface<
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
   * Adds attributes to the active Effect procedure span and structured logs.
   * The annotation function runs after oRPC middleware has produced the final context.
   */
  annotateSpan(
    getSpanAttributes: EffectSpanAnnotation<
      TCurrentContext,
      TInputSchema,
      TEffectErrorMap,
      TMeta
    >,
  ): EffectBuilderSurface<
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
   * Defines the handler of the procedure using a standard async/sync function.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  handler<UFuncOutput>(
    handler: ProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      UFuncOutput,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    Schema<UFuncOutput, UFuncOutput>,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Defines the handler of the procedure using an Effect.
   * The Effect is executed using the ManagedRuntime provided during builder creation.
   * The effect is automatically wrapped with `Effect.withSpan`.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  effect<UFuncOutput>(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      TInputSchema,
      UFuncOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    Schema<UFuncOutput, UFuncOutput>,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  prefix(
    prefix: HTTPPath,
  ): EffectRouterBuilder<
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Adds tags to all procedures in the router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  tag(
    ...tags: string[]
  ): EffectRouterBuilder<
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * Applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  router<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U,
  ): EnhancedEffectRouter<U, TInitialContext, TCurrentContext, TEffectErrorMap>;
  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  lazy<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedEffectRouter<
    Lazy<U>,
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap
  >;
}
