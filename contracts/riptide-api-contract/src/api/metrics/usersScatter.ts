import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// The whole Advanced Metrics page shares ONE bucket-aligned range (see
// range.ts), so the KPI cards, the scatter and every trend describe the same
// population. This endpoint has no bucket dimension of its own — it aggregates
// over the range as a whole — but it takes `bucket` anyway so its cache key
// matches its siblings' and the page never shows a scatter from one range
// beside a trend from another.
export const UsersScatterInputSchema = metricsRangeInput({
	// Each filter narrows only the aggregates whose source table carries the
	// column; the rest are unaffected. Omitted or empty = no filter.
	//
	// Restricts the usage aggregates (cost/tokens) to these models.
	// Commits/merged PRs have no model.
	models: z.array(z.string().min(1).max(256)).max(32).optional(),
	// Restricts usage (cost/tokens) AND commit (LOC) aggregates to these
	// coding agents. Merged PRs carry no agent. Commits with a NULL
	// coding_agent are excluded while this filter is active.
	agents: z.array(CodingAgentZodSchema).max(32).optional(),
	// Restricts commit (LOC) AND merged-PR aggregates to these repos
	// (owner/name). Usage events have no repo linkage.
	repos: z.array(z.string().min(1).max(512)).max(64).optional(),
})

/**
 * Org-facing per-user aggregate metrics — one row per user who has ANY of
 * usage, commits, or merged PRs in range. Missing aggregates default to 0
 * (including costUsd, unlike usageByModel's nullable cost — scatter plots
 * need numeric axes).
 *
 * Commit aggregates (locAdded/locDeleted/commitCount) EXCLUDE commits known
 * to be human-authored (attribution_method = 'human'); unattributed legacy
 * rows stay. The cost numerator only ever contains agent spend, so counting
 * human lines in the denominators would divide agent dollars by
 * partly-human output. Merged PRs carry no attribution, so prsMerged has no
 * equivalent exclusion.
 */
export const UsersScatterOutputSchema = z.object({
	data: z.array(
		z.object({
			userId: z.string(),
			costUsd: z.number(),
			inputTokens: z.number(),
			outputTokens: z.number(),
			locAdded: z.number(),
			locDeleted: z.number(),
			commitCount: z.number(),
			prsMerged: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
	// The filter dropdowns' option lists used to live here, recomputed with the
	// range — which also forced a filtered card to make a second, unfiltered
	// request purely to obtain them. They are now `metrics.scatterFilterOptions`,
	// which takes no range and is fetched once per page load. See that contract.
})

export const usersScatterContract = contractBuilder.input(UsersScatterInputSchema).output(UsersScatterOutputSchema)
