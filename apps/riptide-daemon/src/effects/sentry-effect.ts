import * as Sentry from '@sentry/effect/server'
import { Layer, Tracer } from 'effect'

export const SentryEffectTracer = Sentry.SentryEffectTracer

/**
 * Connects Effect tracing and metrics to the carrier initialized by `@sentry/bun`.
 * Sentry initialization and Sentry Effect logging intentionally remain outside this layer.
 */
export const SentryEffectLive = Layer.mergeAll(
	Layer.succeed(Tracer.Tracer, SentryEffectTracer),
	Sentry.SentryEffectMetricsLayer,
)
