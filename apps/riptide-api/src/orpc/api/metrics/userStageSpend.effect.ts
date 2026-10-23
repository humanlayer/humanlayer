import { Effect } from 'effect'

import { PersonSpendAnalytics } from '../../../effects/services/metrics/person-spend-analytics.service'
import { effectOrpcBaseForAdvancedMetrics } from '../../effect-base'
import { resolveMetricsRange } from './utils'

/**
 * Token spend cross-tabbed by person and RPI stage.
 *
 * No bucket dimension: the card is a 100% stacked bar per person, so there is
 * nothing for a bucket to be an axis of. It still accepts `bucket` so its cache
 * key matches its siblings' — the same reason usersScatter takes it.
 *
 * Everything about HOW the numbers are produced — which pool answers, how a
 * stage is resolved, how a driver row becomes a number — lives in
 * {@link PersonSpendAnalytics}. This handler only turns the wire range into a
 * window and the domain error into a status code.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * effectOrpcBaseForAdvancedMetrics.
 */
export const userStageSpendProcedure = effectOrpcBaseForAdvancedMetrics.metrics.userStageSpend.effect(function* ({
	input,
	context,
	errors,
}) {
	const analytics = yield* PersonSpendAnalytics
	const { startTimestamp, endTimestamp, startDate, endDate } = resolveMetricsRange(input)

	const data = yield* analytics
		.spendByPersonAndStage({
			organizationId: context.auth.organizationId,
			startTimestamp,
			endTimestamp,
		})
		.pipe(
			Effect.catchTags({
				// The service already logged and captured the DRIVER error, with its
				// SQLSTATE. The base captures again on the way out — it reports every
				// 5xx, and an error raised from the `errors` bag arrives `defined:
				// false` (see isExpectedClientError) — so the domain error travels as
				// `cause` to keep that second event from being context-free.
				PersonSpendAnalyticsUnavailable: (error) =>
					Effect.fail(
						error.retryable
							? errors.SERVICE_UNAVAILABLE({ cause: error })
							: errors.INTERNAL_SERVER_ERROR({ cause: error }),
					),
				PersonSpendAnalyticsRowInvalid: (error) => Effect.fail(errors.INTERNAL_SERVER_ERROR({ cause: error })),
			}),
		)

	// Copied out of the service's ReadonlyArray: the wire contract is a plain
	// array, and the service keeps its result immutable for every other caller.
	return { data: [...data], startDate, endDate }
})
