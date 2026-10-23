/**
 * Linear workflow-state progression helpers.
 *
 * RPI skill invocations auto-advance the linked ticket's status. To avoid
 * regressing a ticket when work loops back to an earlier phase (e.g. running
 * `/iterate-implementation` after `/describe-pr` to address code-review
 * feedback), auto-advance should only ever move a ticket *forward*. These
 * helpers rank states using Linear's own workflow ordering so the ticket stays
 * at its most-progressed phase.
 */

import { Option, Schema } from 'effect'

/** A Linear workflow state's progression-relevant fields. */
export interface RankableState {
	/** State category: triage | backlog | unstarted | started | completed | canceled. */
	type: string
	/** Board position; Linear orders states left-to-right (ascending) by workflow progression. */
	position: number
}

/**
 * Linear workflow-state categories ranked by progression (higher = further along).
 * Mirrors Linear's category ordering; `canceled` is treated as terminal so a
 * canceled ticket is never auto-advanced back into an active state.
 */
const LINEAR_STATE_TYPES = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'] as const
const LinearStateType = Schema.Literals(LINEAR_STATE_TYPES)
type LinearStateType = (typeof LINEAR_STATE_TYPES)[number]

export const STATE_TYPE_RANK: Record<LinearStateType, number> = {
	triage: 0,
	backlog: 1,
	unstarted: 2,
	started: 3,
	completed: 4,
	canceled: 5,
}

function typeRank(state: RankableState): number {
	const stateType = Option.getOrUndefined(Schema.decodeUnknownOption(LinearStateType)(state.type))
	return stateType ? STATE_TYPE_RANK[stateType] : 3
}

/**
 * Returns true when `target` is strictly more progressed than `current`.
 *
 * Compares state category first (`STATE_TYPE_RANK`); within the same category,
 * the board `position` breaks the tie. Equal states return false (a no-op move
 * is not "more progressed").
 */
export function isMoreProgressed(target: RankableState, current: RankableState): boolean {
	const targetType = typeRank(target)
	const currentType = typeRank(current)
	if (targetType !== currentType) return targetType > currentType
	return target.position > current.position
}
