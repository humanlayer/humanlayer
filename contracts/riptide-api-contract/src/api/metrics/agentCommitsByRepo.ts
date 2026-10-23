import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// No filters: models can't narrow commits at all (no model column), and the
// page scopes its agent/repo filters to the scatter. The per-repo split IS
// this chart's product, so a repo filter would just hide bars.
export const AgentCommitsByRepoInputSchema = metricsRangeInput()

/**
 * HumanLayer-attributed commits per repository over the window — one row per
 * repo, ranked client-side as bars. Deliberately NOT a time series: "where
 * is agent usage concentrated" is a comparison question (an earlier weekly
 * revision was summed straight back out by its only consumer).
 *
 * Absolute counts, never a share of total commits: a ratio against human
 * commits would be distorted by the in-flight phantom-hook work, which
 * captures steadily MORE human commits over time and would make agent
 * adoption look like it was falling while it was actually flat or rising.
 *
 * `confirmed` (commit trailer names the session) and `inferred` (line-hash
 * overlap heuristic, ~24% measured false-positive rate) stay separate fields
 * so clients can disclose the certainty split; `human` and legacy NULL
 * `attribution_method` rows are never counted.
 */
export const AgentCommitsByRepoOutputSchema = z.object({
	data: z.array(
		z.object({
			repoFullName: z.string(),
			/** Commits whose message carried a trailer naming the agent session. */
			confirmedCount: z.number(),
			/** Commits matched to a session by line-hash overlap (heuristic). */
			inferredCount: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const agentCommitsByRepoContract = contractBuilder
	.input(AgentCommitsByRepoInputSchema)
	.output(AgentCommitsByRepoOutputSchema)
