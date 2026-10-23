import { ORPCError, type Meta } from "@orpc/contract";
import type {
  Context,
  Middleware,
  MiddlewareNextFnOptions,
  MiddlewareOutputFn,
  MiddlewareResult,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { Promisable } from "@orpc/shared";
import type { ManagedRuntime } from "effect";
import { Cause, Context as EffectContext, Effect, Exit, Option } from "effect";

import { getCurrentContext, runWithContext } from "./fiber-context-bridge";
import type { EffectErrorConstructorMap, EffectErrorMap } from "./tagged-error";
import {
  createEffectErrorConstructorMap,
  isORPCTaggedError,
} from "./tagged-error";
import type {
  EffectMiddleware,
  EffectMiddlewareOptions,
  EffectMiddlewareOutput,
  EffectMiddlewareResult,
  EffectOptionalProvider,
  EffectPipelineStep,
  EffectProcedureHandler,
  EffectProvider,
  EffectSpanAnnotation,
  EffectSpanAttributes,
  EffectSpanConfig,
} from "./types";

type EffectTag = import("effect").Context.Service<any, any>;

function compactSpanAttributes(
  attributes: EffectSpanAttributes,
): Record<string, string | number | boolean> {
  const compacted: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      compacted[key] = value;
    }
  }
  return compacted;
}

function annotateORPCErrorWithEffectCause(
  error: ORPCError<string, unknown>,
  cause: Cause.Cause<unknown>,
): ORPCError<string, unknown> {
  Object.assign(error, { effectCausePretty: Cause.pretty(cause) });
  return error;
}

function toORPCErrorFromCause(
  cause: Cause.Cause<unknown>,
): ORPCError<string, unknown> {
  // v4 Cause is a flat array of reasons (Fail | Die | Interrupt). Return the
  // ORPCError derived from the first reason, matching v3's left-biased match.
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const error = reason.error;
      if (isORPCTaggedError(error)) {
        return annotateORPCErrorWithEffectCause(error.toORPCError(), cause);
      }
      if (error instanceof ORPCError) {
        return annotateORPCErrorWithEffectCause(error, cause);
      }
      return annotateORPCErrorWithEffectCause(
        new ORPCError("INTERNAL_SERVER_ERROR", {
          cause: error,
        }),
        cause,
      );
    }
    if (Cause.isDieReason(reason)) {
      return annotateORPCErrorWithEffectCause(
        new ORPCError("INTERNAL_SERVER_ERROR", {
          cause: reason.defect,
        }),
        cause,
      );
    }
    if (Cause.isInterruptReason(reason)) {
      return annotateORPCErrorWithEffectCause(
        new ORPCError("INTERNAL_SERVER_ERROR", {
          cause: new Error(`${reason.fiberId} Interrupted`),
        }),
        cause,
      );
    }
  }
  return annotateORPCErrorWithEffectCause(
    new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error("Unknown error"),
    }),
    cause,
  );
}

export function createEffectProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  effectFn: EffectProcedureHandler<
    TCurrentContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    any
  >;
  effectSteps?: readonly EffectPipelineStep[];
  spanConfig?: EffectSpanConfig;
  spanAnnotations?: readonly EffectSpanAnnotation<
    TCurrentContext,
    TInput,
    TEffectErrorMap,
    TMeta & Record<never, never>
  >[];
  defaultCaptureStackTrace: () => string | undefined;
}): ProcedureHandler<
  TCurrentContext,
  TInput,
  TOutput,
  any,
  TMeta & Record<never, never>
> {
  const {
    runtime,
    effectErrorMap,
    effectFn,
    effectSteps = [],
    spanConfig,
    spanAnnotations = [],
    defaultCaptureStackTrace,
  } = options;

  return async (opts) => {
    const effectOpts: ProcedureHandlerOptions<
      TCurrentContext,
      TInput,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta & Record<never, never>
    > = {
      context: opts.context,
      input: opts.input,
      path: opts.path,
      procedure: opts.procedure,
      signal: opts.signal,
      lastEventId: opts.lastEventId,
      errors: createEffectErrorConstructorMap(effectErrorMap),
    };

    const spanName = spanConfig?.name ?? opts.path.join(".");
    const captureStackTrace =
      spanConfig?.captureStackTrace ?? defaultCaptureStackTrace;
    const resolver = Effect.fnUntraced(effectFn as any);
    const handlerEffect = resolver(effectOpts);
    const pipelineEffect = runEffectPipeline({
      baseOptions: effectOpts,
      effectErrorMap,
      final: (context) =>
        Effect.map(
          context === effectOpts.context
            ? handlerEffect
            : resolver({ ...effectOpts, context }),
          (output) => ({ output, context: {} }),
        ),
      input: opts.input,
      steps: effectSteps,
    });
    const procedureAnnotations = compactSpanAttributes(
      Object.assign(
        {},
        ...spanAnnotations.map((getSpanAttributes) =>
          getSpanAttributes(effectOpts),
        ),
      ),
    );
    const hasAnnotations = Object.keys(procedureAnnotations).length > 0;
    const logAnnotatedEffect = hasAnnotations
      ? pipelineEffect.pipe(Effect.annotateLogs(procedureAnnotations))
      : pipelineEffect;
    const logSpannedEffect = logAnnotatedEffect.pipe(
      Effect.withLogSpan(spanName),
    );
    const spanAnnotatedEffect = hasAnnotations
      ? Effect.annotateCurrentSpan(procedureAnnotations).pipe(
          Effect.andThen(logSpannedEffect),
        )
      : logSpannedEffect;
    const tracedEffect = Effect.withSpan(spanAnnotatedEffect, spanName, {
      captureStackTrace,
    });
    const runtimeForCall = getRuntimeFromProcedure(opts.procedure) ?? runtime;
    const exit = await runtimeForCall.runPromiseExit(
      withParentFiberRefs(tracedEffect),
      { signal: opts.signal },
    );

    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause);
    }

    return exit.value.output as TOutput;
  };
}

export function createEffectPipelineMiddleware<
  TCurrentContext extends Context,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  steps: readonly EffectPipelineStep[];
}): Middleware<
  TCurrentContext,
  Record<never, never>,
  unknown,
  TOutput,
  any,
  TMeta
> {
  const { runtime, effectErrorMap, steps } = options;

  return async (opts, input) => {
    const baseOptions = makeEffectOptions<
      TCurrentContext,
      unknown,
      TEffectErrorMap,
      TMeta
    >(opts, input, effectErrorMap);
    const effect = runEffectPipeline({
      baseOptions,
      effectErrorMap,
      final: (context) =>
        withCurrentFiberContext(() =>
          opts.next(
            context === opts.context
              ? undefined
              : { context: context as Record<PropertyKey, unknown> },
          ),
        ) as any,
      input,
      steps,
    });
    const runtimeForCall = getRuntimeFromProcedure(opts.procedure) ?? runtime;
    const exit = await runtimeForCall.runPromiseExit(
      withParentFiberRefs(effect as any),
      { signal: opts.signal },
    );

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value as MiddlewareResult<Record<never, never>, TOutput>;
  };
}

export function createEffectProviderMiddleware<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
  TTag extends EffectTag,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  tag: TTag;
  provider: EffectProvider<
    TCurrentContext,
    TInput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta,
    TTag
  >;
}): Middleware<TCurrentContext, Record<never, never>, TInput, any, any, TMeta> {
  const { runtime, effectErrorMap, tag, provider } = options;

  return async (opts, input) => {
    const effectOpts = makeEffectOptions<
      TCurrentContext,
      TInput,
      TEffectErrorMap,
      TMeta
    >(opts, input, effectErrorMap);
    const effect = Effect.flatMap(provider(effectOpts), (service) =>
      Effect.provideService(
        withCurrentFiberContext(() => opts.next()),
        tag,
        service,
      ),
    );
    const runtimeForCall = getRuntimeFromProcedure(opts.procedure) ?? runtime;
    const exit = await runtimeForCall.runPromiseExit(
      withParentFiberRefs(effect),
      {
        signal: opts.signal,
      },
    );

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value;
  };
}

export function createEffectOptionalProviderMiddleware<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
  TTag extends EffectTag,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  tag: TTag;
  provider: EffectOptionalProvider<
    TCurrentContext,
    TInput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta,
    TTag
  >;
}): Middleware<TCurrentContext, Record<never, never>, TInput, any, any, TMeta> {
  const { runtime, effectErrorMap, tag, provider } = options;

  return async (opts, input) => {
    const effectOpts = makeEffectOptions<
      TCurrentContext,
      TInput,
      TEffectErrorMap,
      TMeta
    >(opts, input, effectErrorMap);
    const effect = Effect.flatMap(provider(effectOpts), (service) =>
      Option.match(service, {
        onNone: () => withCurrentFiberContext(() => opts.next()),
        onSome: (value) =>
          Effect.provideService(
            withCurrentFiberContext(() => opts.next()),
            tag,
            value,
          ),
      }),
    );
    const runtimeForCall = getRuntimeFromProcedure(opts.procedure) ?? runtime;
    const exit = await runtimeForCall.runPromiseExit(
      withParentFiberRefs(effect),
      {
        signal: opts.signal,
      },
    );

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value;
  };
}

// todo(utopy): make this check more comprehensive, maybe add a Symbol to the EffectMiddleware type
export function isEffectMiddleware(
  value: unknown,
): value is EffectMiddleware<
  Context,
  Context,
  unknown,
  unknown,
  EffectErrorMap,
  unknown,
  Meta
> {
  return (
    typeof value === "function" &&
    value.constructor?.name === "GeneratorFunction"
  );
}

function makeEffectOptions<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>(
  opts: Parameters<
    Middleware<TCurrentContext, any, TInput, any, any, TMeta>
  >[0],
  input: TInput,
  effectErrorMap: TEffectErrorMap,
): ProcedureHandlerOptions<
  TCurrentContext,
  TInput,
  EffectErrorConstructorMap<TEffectErrorMap>,
  TMeta & Record<never, never>
> {
  return {
    context: opts.context,
    input,
    path: opts.path,
    procedure: opts.procedure as any,
    signal: opts.signal,
    lastEventId: opts.lastEventId,
    errors: createEffectErrorConstructorMap(effectErrorMap),
  };
}

function runEffectPipeline<
  TCurrentContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
>(options: {
  baseOptions: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >;
  effectErrorMap: TEffectErrorMap;
  final: (
    context: TCurrentContext,
  ) => Effect.Effect<
    EffectMiddlewareResult<Record<never, never>, TOutput>,
    unknown,
    TRequirementsProvided
  >;
  input: TInput;
  steps: readonly EffectPipelineStep[];
}): Effect.Effect<
  EffectMiddlewareResult<Context, TOutput>,
  unknown,
  TRequirementsProvided
> {
  const run = (
    index: number,
    context: TCurrentContext,
  ): Effect.Effect<
    EffectMiddlewareResult<Context, TOutput>,
    unknown,
    TRequirementsProvided
  > => {
    const step = options.steps[index];
    if (!step) return options.final(context);

    const stepOptions = { ...options.baseOptions, context };

    if (step._tag === "provide") {
      return Effect.flatMap(step.provider(stepOptions as any), (service) =>
        Effect.provideService(run(index + 1, context), step.tag, service),
      );
    }

    if (step._tag === "provideOptional") {
      return Effect.flatMap(step.provider(stepOptions as any), (service) =>
        Option.match(service, {
          onNone: () => run(index + 1, context),
          onSome: (value) =>
            Effect.provideService(run(index + 1, context), step.tag, value),
        }),
      );
    }

    if (step._tag === "provideLayer") {
      return Effect.provide(run(index + 1, context), step.layer);
    }

    const nextTracker =
      createMiddlewareNextTracker<EffectMiddlewareResult<Context, TOutput>>();
    const effectOptions: EffectMiddlewareOptions<
      TCurrentContext,
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    > = {
      context,
      path: stepOptions.path,
      procedure: stepOptions.procedure,
      signal: stepOptions.signal,
      lastEventId: stepOptions.lastEventId,
      errors: createEffectErrorConstructorMap(options.effectErrorMap),
      next: nextTracker.wrapNext(
        (...rest: [MiddlewareNextFnOptions<Context>?]) => {
          const nextContext = rest[0]?.context ?? {};
          return Effect.map(
            run(index + 1, { ...context, ...nextContext }),
            (result) => ({
              output: result.output,
              context: nextContext,
            }),
          ) as Effect.Effect<EffectMiddlewareResult<Context, TOutput>>;
        },
      ),
    };
    const effectOutput = makeEffectMiddlewareOutput<
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided
    >((output) => ({ output, context: {} }));
    const middlewareEffect = Effect.fnUntraced(step.middleware)(
      effectOptions,
      options.input,
      effectOutput,
    ) as Effect.Effect<EffectMiddlewareResult<Context, TOutput> | void>;

    return Effect.flatMap(middlewareEffect, (result) =>
      resolveEffectMiddlewareContinuation({
        autoNext: () => effectOptions.next(),
        nextInvoked: nextTracker.nextInvoked,
        nextResult: nextTracker.nextResult,
        result,
      }),
    );
  };

  return run(0, options.baseOptions.context);
}

function createMiddlewareNextTracker<T>() {
  let nextInvoked = false;
  let nextResult: T | undefined;

  return {
    get nextInvoked() {
      return nextInvoked;
    },
    get nextResult() {
      return nextResult;
    },
    wrapNext<Fn extends (...args: any) => Effect.Effect<T, any, any>>(
      nextFn: Fn,
    ): Fn {
      return ((...args: Parameters<Fn>) => {
        nextInvoked = true;
        return Effect.map(nextFn(...args), (result) => {
          nextResult = result;
          return result;
        });
      }) as Fn;
    },
  };
}

function getRuntimeFromProcedure(
  procedure: unknown,
): ManagedRuntime.ManagedRuntime<any, any> | undefined {
  if (
    typeof procedure !== "object" ||
    procedure === null ||
    !("~effect" in procedure)
  ) {
    return undefined;
  }

  const runtime = (procedure as { "~effect"?: { runtime?: unknown } })[
    "~effect"
  ]?.runtime;
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    !("runPromiseExit" in runtime)
  ) {
    return undefined;
  }

  return runtime as ManagedRuntime.ManagedRuntime<any, any>;
}

function resolveEffectMiddlewareContinuation<
  TContext extends Context,
  TOutput,
  TRequirementsProvided,
>(options: {
  result: EffectMiddlewareResult<TContext, TOutput> | void;
  nextInvoked: boolean;
  nextResult: EffectMiddlewareResult<TContext, TOutput> | undefined;
  autoNext: () => Effect.Effect<
    EffectMiddlewareResult<TContext, TOutput>,
    unknown,
    TRequirementsProvided
  >;
}): Effect.Effect<
  EffectMiddlewareResult<TContext, TOutput>,
  unknown,
  TRequirementsProvided
> {
  const { result, nextInvoked, nextResult, autoNext } = options;

  if (result !== undefined) {
    return Effect.succeed(result);
  }

  if (nextInvoked) {
    if (nextResult === undefined) {
      return Effect.die(
        new Error(
          "Effect middleware invoked next() but did not return its result",
        ),
      );
    }
    return Effect.succeed(nextResult);
  }

  return autoNext();
}

function makeEffectMiddlewareOutput<
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
>(
  output: MiddlewareOutputFn<TOutput>,
): EffectMiddlewareOutput<TOutput, TEffectErrorMap, TRequirementsProvided> {
  return (value: TOutput) => withCurrentFiberContext(() => output(value));
}

function withCurrentFiberContext<T>(fn: () => Promisable<T>): Effect.Effect<T> {
  return Effect.flatMap(Effect.context<never>(), (context) =>
    Effect.promise(() =>
      runWithContext(context, () => Promise.resolve(fn())),
    ),
  );
}

function withParentFiberRefs<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const parentContext = getCurrentContext();
  return parentContext
    ? Effect.withFiber((fiber) => {
        // Merge the captured parent context into the current fiber, with the
        // current fiber's services taking precedence (v4 Context.merge: the
        // second argument overrides the first).
        fiber.setContext(EffectContext.merge(parentContext, fiber.context));
        return effect;
      })
    : effect;
}
