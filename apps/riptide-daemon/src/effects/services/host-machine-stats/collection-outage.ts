import * as Sentry from '@sentry/bun'
import { Effect, Option, Ref } from 'effect'

export interface CollectionOutage {
	/**
	 * Runs `collect` and returns none when it fails. The first failure of an outage is logged and
	 * captured, and so is the recovery; the failures in between are not, so a host that can never
	 * collect something produces one warning instead of one per sample.
	 */
	readonly collectBestEffort: <A, E, R>(collect: Effect.Effect<A, E, R>) => Effect.Effect<Option.Option<A>, never, R>
}

export const makeCollectionOutage = (collected: string): Effect.Effect<CollectionOutage> =>
	Effect.gen(function* () {
		const failing = yield* Ref.make(false)

		const recordFailure = (error: unknown) =>
			Ref.getAndSet(failing, true).pipe(
				Effect.flatMap((wasFailing) =>
					wasFailing
						? Effect.void
						: Effect.logWarning(`Could not collect ${collected}; heartbeats continue without it`).pipe(
								Effect.annotateLogs({ collected, error }),
								Effect.andThen(
									Effect.sync(() =>
										Sentry.captureException(error, {
											tags: { error_type: 'host_machine_stats_collection_failed', collected },
										}),
									),
								),
							),
				),
			)

		const recordSuccess = Ref.getAndSet(failing, false).pipe(
			Effect.flatMap((wasFailing) =>
				wasFailing
					? Effect.logInfo(`Collecting ${collected} again`).pipe(Effect.annotateLogs({ collected }))
					: Effect.void,
			),
		)

		return {
			collectBestEffort: (collect) =>
				collect.pipe(
					Effect.tapError(recordFailure),
					Effect.tap(() => recordSuccess),
					Effect.option,
				),
		}
	})
