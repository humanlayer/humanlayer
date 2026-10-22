import { Effect } from 'effect'

import { PersonSpendAnalytics } from '../../../effects/services/metrics/person-spend-analytics.service'
import { effectOrpcBaseForAdvancedMetrics } from '../../effect-base'
import { resolveMetricsRange } from './utils'

/**
 * Token spend cross-tabbed by person and workflow mode — the mode-shaped twin
 * of userStageSpend, and the two-dimensional form of modeSpendTrend.
 *
 * No bucket dimension — see userStageSpend.
 *
 * The mode rule (a reassigned session reports its CURRENT task's mode) lives in
 * {@link PersonSpendAnalytics} with the query it belongs to, so it cannot drift
 * away from the ranking this card rolls up to.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * effectOrpcBaseForAdvancedMetrics.
 */
export const userModeSpendProcedure = effectOrpcBaseForAdvancedMetrics.metrics.userModeSpend.effect(function* ({
	input,
	context,
	errors,
}) {
	const analytics = yield* PersonSpendAnalytics
	const { startTimestamp, endTimestamp, startDate, endDate } = resolveMetricsRange(input)

	const data = yield* analytics
		.spendByPersonAndMode({
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
