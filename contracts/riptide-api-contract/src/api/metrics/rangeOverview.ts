import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { timezoneOffsetSchema } from './range'

export const RangeOverviewInputSchema = z.object({
	timezoneOffset: timezoneOffsetSchema,
	// Deliberately NO range. This endpoint feeds the control that CHOOSES the
	// range; taking one would make the strip redraw itself under the handle the
	// user is dragging, and would refetch on every drag.
})

/**
 * The brush strip's data: daily spend across the last
 * RANGE_HISTORY_DAYS days (see range.ts), plus the two boundaries the control needs
 * to know where its handles may go.
 *
 * Range-INDEPENDENT by construction. The strip is the page's navigation
 * surface — it must show what lies outside the current selection, because
 * that is the only way a user discovers a spike worth selecting. It is fetched
 * once and never invalidated by a range change, so dragging is free.
 *
 * Raw dollars only, never a ratio. The strip is bucketed to the day, and a
 * same-day unit cost divides one day's money by one day's merges — see the
 * UI's trailingRatio module. Daily resolution is used here for NAVIGATION;
 * plotting it as a rate is a separate decision made per chart.
 */
export const RangeOverviewOutputSchema = z.object({
	/**
	 * Dense — every day in the window, so a quiet day is an explicit zero bar
	 * rather than a missing x-value that would silently compress the strip's
	 * time axis and misplace every handle position.
	 */
	days: z.array(
		z.object({
			/** Client-local day, 'YYYY-MM-DD'. */
			date: z.string(),
			/** Σ session_usage_events.cost_usd for the day (occurred_at). */
			costUsd: z.number(),
		}),
	),
	/** First day of the strip, inclusive. */
	earliestDate: z.string(),
	/** Last day of the strip, inclusive — the client's today. */
	latestDate: z.string(),
	/**
	 * The day the org's FIRST attributed commit lands on, or null when it has
	 * none.
	 *
	 * Attribution only starts when an org opts in, while token spend is
	 * recorded for every org regardless — so a range reaching back past this
	 * day divides a whole numerator by a fraction of the denominator. This used
	 * to be a week key gating which PRESETS were offered, explained in a
	 * sentence beside a disabled button. As a day it becomes a region of the
	 * strip the left handle refuses to cross: the same rule, visible instead of
	 * described, and now enforceable at any range rather than only at 4/8/12.
	 *
	 * The bound is STRICT — a range may not start on this day, because
	 * collection began partway through it.
	 */
	attributionStartDate: z.string().nullable(),
})

export const rangeOverviewContract = contractBuilder.input(RangeOverviewInputSchema).output(RangeOverviewOutputSchema)
