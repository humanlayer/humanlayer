import type { HTTPPath } from "@orpc/client";
import type {
  AnySchema,
  ContractRouter,
  InferSchemaInput,
  InferSchemaOutput,
  Meta,
  Route,
  Schema,
} from "@orpc/contract";
import type {
  AccessibleLazyRouter,
  AnyRouter,
  BuilderDef,
  Context,
  EnhanceRouterOptions,
  IntersectPick,
  Lazy,
  Lazyable,
  MapInputMiddleware,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ProcedureHandler,
  Router,
} from "@orpc/server";
import type { Context as EffectContext, Layer } from "effect";

import type {
  EffectBuilderDef,
  EffectErrorMapToErrorMap,
  EffectOptionalProvider,
  EffectOrORPCMiddleware,
  EffectProcedureHandler,
  EffectProvider,
} from ".";
import type {
  EffectDecoratedProcedure,
  EffectProcedure,
} from "../effect-procedure";
import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  MergedEffectErrorMap,
} from "../tagged-error";

type EffectTagIdentifier<T extends EffectContext.Service<any, any>> =
  T extends EffectContext.Service<infer I, any> ? I : never;

export interface EffectBuilderWithMiddlewares<
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
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  "errors"<U extends EffectErrorMap>(
    errors: U,
  ): EffectBuilderWithMiddlewares<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    Omit<TEffectErrorMap, keyof U> & U,
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
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: EffectOrORPCMiddleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectBuilderWithMiddlewares<
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
  "provide"<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectBuilderWithMiddlewares<
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
  "provide"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectBuilderWithMiddlewares<
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
  "provideOptional"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectOptionalProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectBuilderWithMiddlewares<
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
  "meta"(
    meta: TMeta,
  ): EffectBuilderWithMiddlewares<
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
  "route"(
    route: Route,
  ): EffectProcedureBuilder<
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
  "input"<USchema extends AnySchema>(
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
  "output"<USchema extends AnySchema>(
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
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "handler"<UFuncOutput>(
    handler: ProcedureHandler<
      TCurrentContext,
      unknown,
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
  "effect"<UFuncOutput>(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
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
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns A traced procedure builder
   */
  "traced"(
    spanName: string,
  ): EffectProcedureBuilderWithInput<
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
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  "prefix"(
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
  "tag"(
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
  "router"<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U,
  ): EnhancedEffectRouter<U, TInitialContext, TCurrentContext, TEffectErrorMap>;

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  "lazy"<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedEffectRouter<
    Lazy<U>,
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap
  >;
}

export interface EffectProcedureBuilder<
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
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  "errors"<U extends EffectErrorMap>(
    errors: U,
  ): EffectProcedureBuilder<
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
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: EffectOrORPCMiddleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectProcedureBuilder<
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
  "provide"<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectProcedureBuilder<
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
  "provide"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilder<
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
  "provideOptional"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectOptionalProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilder<
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
  "meta"(
    meta: TMeta,
  ): EffectProcedureBuilder<
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
  "route"(
    route: Route,
  ): EffectProcedureBuilder<
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
  "input"<USchema extends AnySchema>(
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
  "output"<USchema extends AnySchema>(
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
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "handler"<UFuncOutput>(
    handler: ProcedureHandler<
      TCurrentContext,
      unknown,
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
  "effect"<UFuncOutput>(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
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
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns A traced procedure builder
   */
  "traced"(
    spanName: string,
  ): EffectProcedureBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
}

export interface EffectProcedureBuilderWithInput<
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
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  "errors"<U extends EffectErrorMap>(
    errors: U,
  ): EffectProcedureBuilderWithInput<
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
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  "use"<
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
  ): EffectProcedureBuilderWithInput<
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
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInput,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      UInput,
      unknown,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): EffectProcedureBuilderWithInput<
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
  "provide"<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectProcedureBuilderWithInput<
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
  "provide"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilderWithInput<
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
  "provideOptional"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectOptionalProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilderWithInput<
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
  "meta"(
    meta: TMeta,
  ): EffectProcedureBuilderWithInput<
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
  "route"(
    route: Route,
  ): EffectProcedureBuilderWithInput<
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
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  "output"<USchema extends AnySchema>(
    schema: USchema,
  ): EffectProcedureBuilderWithInputOutput<
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
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "handler"<UFuncOutput>(
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
  "effect"<UFuncOutput>(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
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
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns A traced procedure builder
   */
  "traced"(
    spanName: string,
  ): EffectProcedureBuilderWithInput<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
}

export interface EffectProcedureBuilderWithOutput<
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
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  "errors"<U extends EffectErrorMap>(
    errors: U,
  ): EffectProcedureBuilderWithOutput<
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
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: EffectOrORPCMiddleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      InferSchemaInput<TOutputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectProcedureBuilderWithOutput<
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
  "provide"<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectProcedureBuilderWithOutput<
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
  "provide"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilderWithOutput<
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
  "provideOptional"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectOptionalProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilderWithOutput<
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
  "meta"(
    meta: TMeta,
  ): EffectProcedureBuilderWithOutput<
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
  "route"(
    route: Route,
  ): EffectProcedureBuilderWithOutput<
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
  "input"<USchema extends AnySchema>(
    schema: USchema,
  ): EffectProcedureBuilderWithInputOutput<
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
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "handler"(
    handler: ProcedureHandler<
      TCurrentContext,
      unknown,
      InferSchemaInput<TOutputSchema>,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
  ): EffectDecoratedProcedure<
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
   * Defines the handler of the procedure using an Effect.
   * The Effect is executed using the ManagedRuntime provided during builder creation.
   * The effect is automatically wrapped with `Effect.withSpan`.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "effect"(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectDecoratedProcedure<
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
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns A traced procedure builder
   */
  "traced"(
    spanName: string,
  ): EffectProcedureBuilderWithInput<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
}

export interface EffectProcedureBuilderWithInputOutput<
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
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  "errors"<U extends EffectErrorMap>(
    errors: U,
  ): EffectProcedureBuilderWithInputOutput<
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
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: EffectOrORPCMiddleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectProcedureBuilderWithInputOutput<
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
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInput,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      UInput,
      InferSchemaInput<TOutputSchema>,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): EffectProcedureBuilderWithInputOutput<
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
  "provide"<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectProcedureBuilderWithInputOutput<
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
  "provide"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilderWithInputOutput<
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
  "provideOptional"<TTag extends EffectContext.Service<any, any>>(
    tag: TTag,
    provider: EffectOptionalProvider<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta,
      TTag
    >,
  ): EffectProcedureBuilderWithInputOutput<
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
  "meta"(
    meta: TMeta,
  ): EffectProcedureBuilderWithInputOutput<
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
  "route"(
    route: Route,
  ): EffectProcedureBuilderWithInputOutput<
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
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "handler"(
    handler: ProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
  ): EffectDecoratedProcedure<
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
   * Defines the handler of the procedure using an Effect.
   * The Effect is executed using the ManagedRuntime provided during builder creation.
   * The effect is automatically wrapped with `Effect.withSpan`.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  "effect"(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectDecoratedProcedure<
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
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns A traced procedure builder
   */
  "traced"(
    spanName: string,
  ): EffectProcedureBuilderWithInput<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
}

export interface EffectRouterBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> {
  /**
   * This property holds the defined options.
   */
  "~orpc": EnhanceRouterOptions<EffectErrorMapToErrorMap<TEffectErrorMap>>;

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  "errors"<U extends EffectErrorMap>(
    errors: U,
  ): EffectRouterBuilder<
    TInitialContext,
    TCurrentContext,
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
  "use"<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: EffectOrORPCMiddleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectRouterBuilder<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
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
  "prefix"(
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
  "tag"(
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
  "router"<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U,
  ): EnhancedEffectRouter<U, TInitialContext, TCurrentContext, TEffectErrorMap>;

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  "lazy"<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedEffectRouter<
    Lazy<U>,
    TInitialContext,
    TCurrentContext,
    EffectErrorMapToErrorMap<TEffectErrorMap>
  >;
}

export type EnhancedEffectRouter<
  T extends Lazyable<AnyRouter>,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TEffectErrorMap extends EffectErrorMap,
> =
  T extends Lazy<infer U extends AnyRouter>
    ? AccessibleLazyRouter<
        EnhancedEffectRouter<
          U,
          TInitialContext,
          TCurrentContext,
          TEffectErrorMap
        >
      >
    : T extends EffectProcedure<
          infer UInitialContext,
          infer UCurrentContext,
          infer UInputSchema,
          infer UOutputSchema,
          infer UEffectErrorMap,
          infer UMeta,
          infer URequirementsProvided,
          infer URuntimeError
        >
      ? EffectProcedure<
          MergedInitialContext<
            TInitialContext,
            UInitialContext,
            TCurrentContext
          >,
          UCurrentContext,
          UInputSchema,
          UOutputSchema,
          MergedEffectErrorMap<TEffectErrorMap, UEffectErrorMap>,
          UMeta,
          URequirementsProvided,
          URuntimeError
        >
      : {
          [K in keyof T]: T[K] extends Lazyable<AnyRouter>
            ? EnhancedEffectRouter<
                T[K],
                TInitialContext,
                TCurrentContext,
                TEffectErrorMap
              >
            : never;
        };
