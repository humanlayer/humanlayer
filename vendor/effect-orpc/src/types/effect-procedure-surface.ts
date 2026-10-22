import type { ClientContext } from "@orpc/client";
import type {
  AnySchema,
  InferSchemaInput,
  InferSchemaOutput,
  Meta,
  Route,
} from "@orpc/contract";
import type {
  Context,
  CreateProcedureClientOptions,
  MapInputMiddleware,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ProcedureActionableClient,
  ProcedureClient,
  ProcedureDef,
} from "@orpc/server";
import type { IntersectPick, MaybeOptionalOptions } from "@orpc/shared";
import type { Context as EffectContext, Layer, ManagedRuntime } from "effect";

import type {
  EffectErrorMapToErrorMap,
  EffectOrORPCMiddleware,
  EffectOptionalProvider,
  EffectProcedureDef,
  EffectProvider,
} from ".";
import type { EffectDecoratedProcedure } from "../effect-procedure";
import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  MergedEffectErrorMap,
} from "../tagged-error";

type EffectTagIdentifier<T extends EffectContext.Service<any, any>> =
  T extends EffectContext.Service<infer I, any> ? I : never;

export interface EffectDecoratedProcedureSurface<
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
  "~effect": EffectProcedureDef<
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
  "~orpc": ProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
  >;
  /**
   * Adds type-safe custom errors.
   * Supports both traditional oRPC error definitions and ORPCTaggedError classes.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectDecoratedProcedure<
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
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta(
    meta: TMeta,
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
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  route(
    route: Route,
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
   * Provides an Effect layer to downstream procedures.
   */
  provide<TLayerOut, TLayerError, TLayerIn extends TRequirementsProvided>(
    layer: Layer.Layer<TLayerOut, TLayerError, TLayerIn>,
  ): EffectDecoratedProcedure<
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
  ): EffectDecoratedProcedure<
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
      InferSchemaInput<TOutputSchema>,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectDecoratedProcedure<
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
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
  ): EffectDecoratedProcedure<
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
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): EffectDecoratedProcedure<
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
   * Returns a copy of this procedure that executes with the provided Effect runtime.
   */
  withRuntime(
    runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
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
   * Make this procedure callable (works like a function while still being a procedure).
   *
   * @see {@link https://orpc.dev/docs/client/server-side Server-side Client Docs}
   */
  callable<TClientContext extends ClientContext>(
    ...rest: MaybeOptionalOptions<
      CreateProcedureClientOptions<
        TInitialContext,
        TOutputSchema,
        EffectErrorMapToErrorMap<TEffectErrorMap>,
        TMeta,
        TClientContext
      >
    >
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > &
    ProcedureClient<
      TClientContext,
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>
    >;
  /**
   * Make this procedure compatible with server action.
   *
   * @see {@link https://orpc.dev/docs/server-action Server Action Docs}
   */
  actionable(
    ...rest: MaybeOptionalOptions<
      CreateProcedureClientOptions<
        TInitialContext,
        TOutputSchema,
        EffectErrorMapToErrorMap<TEffectErrorMap>,
        TMeta,
        Record<never, never>
      >
    >
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > &
    ProcedureActionableClient<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>
    >;
}
