import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { timezoneOffsetSchema } from './range'

export const ScatterFilterOptionsInputSchema = z.object({
	timezoneOffset: timezoneOffsetSchema,
	// Deliberately NO range. See the output docs: these are the values the
	// dropdowns offer, and they must not move when the range does.
})

/**
 * The values the scatter's model / agent / repo dropdowns offer.
 *
 * These used to ride along on every `usersScatter` response, recomputed with
 * the range. Splitting them out fixes two things.
 *
 * **Cost.** They are three `DISTINCT`/`UNION` scans, and they were re-run on
 * every range change — while a filtered scatter ALSO forced a second,
 * unfiltered `usersScatter` request purely to obtain them. A filtered card
 * therefore cost nine queries per range change; it now costs three, and these
 * are fetched once per page load.
 *
 * **Correctness.** A range-bounded option list shrinks as you drag. Filters
 * persist across range changes, so a user could filter by a model, drag to a
 * range where that model has no usage, and watch the option vanish from the
 * list while the filter stayed applied — an empty scatter with no visible
 * cause. A vocabulary is not a measurement, and it should not move when the
 * measurement does.
 *
 * The scan is bounded by the same window the range brush spans
 * (RANGE_HISTORY_DAYS, see range.ts) rather than the org's whole history. That
 * bound is exactly right: the brush cannot select outside it, so no selectable
 * range can contain a value missing from these lists, and nothing unreachable
 * is offered.
 */
export const ScatterFilterOptionsOutputSchema = z.object({
	/** Models on usage events in the window, ascending. */
	models: z.array(z.string()),
	/** Coding agents on usage events OR non-human commits, ascending. */
	agents: z.array(CodingAgentZodSchema),
	/** Repos on non-human commits OR merged PRs, ascending. */
	repos: z.array(z.string()),
})

export const scatterFilterOptionsContract = contractBuilder
	.input(ScatterFilterOptionsInputSchema)
	.output(ScatterFilterOptionsOutputSchema)
