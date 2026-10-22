import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

/**
 * Tasks per fetch. The card scrolls the whole range rather than showing a
 * fixed top N, so this is a fetch granularity and not a cut-off: 25 fills the
 * scroll box about twice over, which keeps the next page arriving before the
 * reader reaches the end without walking the range in 5-row increments.
 */
export const TOKEN_USE_PAGE_SIZE = 25

/**
 * What a bar means, and what the list is ranked by. NOT a client-side sort of
 * one list: token spend and dollar spend rank tasks differently, because
 * agents bill at very different rates per token (measured on dev: ~$0.43/Mtok
 * for codelayer against ~$1.19/Mtok for claude). Re-sorting a token-ranked
 * page by cost would show the heaviest tasks in cost order and silently omit
 * the tasks that are expensive without being heavy — on dev only 8 of the top
 * 12 are in both lists. So the measure is a SERVER input and each one gets its
 * own ordering of the whole range.
 */
export const TOKEN_USE_MEASURES = ['tokens', 'cost'] as const
export type TokenUseMeasure = (typeof TOKEN_USE_MEASURES)[number]

/**
 * A keyset cursor: the rank value of the last row on a page, and its task id
 * to break ties. `(value, taskId)` is unique, so the next page resumes exactly
 * where the previous one stopped.
 *
 * A pair rather than an offset because OFFSET re-scans everything it skips and,
 * worse, repeats or drops rows when the underlying data shifts between pages.
 *
 * `value` is a NUMBER, and deliberately so. An earlier revision carried it as
 * a string "to preserve precision the float64 would lose", which was simply
 * wrong: `session_usage_events.cost_usd` is `double precision`, so the driver
 * has already parsed the sum into a float64 before the handler ever sees it.
 * There was no precision left to preserve — only a format to get wrong, and it
 * did: `String(0.1 + 0.2)` is `"0.30000000000000004"`, and a tiny sum prints as
 * `"3e-8"`. Neither matched the string pattern that guarded it, so the server
 * minted cursors its own contract rejected and the response 500'd on output
 * validation for roughly half of real cost values.
 *
 * Bounded at the safe-integer range so a hand-edited cursor cannot overflow the
 * `bigint` the tokens measure casts to, and `taskId` is a uuid so it stays
 * comparable against a uuid column. Validated HERE rather than in the handler:
 * both are cast in SQL, and without the bounds a malformed cursor comes back a
 * 500 instead of a 400.
 */
const TaskCursorSchema = z.object({
	value: z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
	taskId: z.uuid(),
})

export type TaskCursor = z.infer<typeof TaskCursorSchema>

export const TokenUseByTaskInputSchema = metricsRangeInput({
	measure: z.enum(TOKEN_USE_MEASURES).default('tokens'),
	limit: z.number().int().min(1).max(50).default(TOKEN_USE_PAGE_SIZE),
	/**
	 * Case-insensitive substring match on the task name and its ticket id.
	 *
	 * Server-side by necessity, not by preference: filtering the loaded page
	 * would search the 25 rows the client happens to hold rather than the
	 * range, so a task that exists and matches would be reported as absent.
	 */
	search: z.string().trim().max(200).optional(),
	/** Where the previous page stopped. Pass the last page's `nextCursor` back verbatim. */
	cursor: TaskCursorSchema.optional(),
})

/** One coding agent's share of a task. Sparse — only agents that billed appear. */
const TokenUseAgentSplitSchema = z.object({
	agent: CodingAgentZodSchema,
	tokens: z.number(),
	costUsd: z.number(),
})

/**
 * One model's share of a task. Sparse, and NOT capped server-side: the client
 * folds the tail so the surviving models keep the same colours the Model spend
 * card gives them, which it can only do if it sees the same population.
 */
const TokenUseModelSplitSchema = z.object({
	model: z.string(),
	tokens: z.number(),
	costUsd: z.number(),
})

/**
 * One RPI workflow stage's share of a task. Sparse — only stages that billed
 * appear, and spend on sessions with no RPI label lands under the
 * `no_stage` sentinel rather than disappearing.
 *
 * A task really is multi-stage: it runs research, then implementation, then
 * describe-pr, each as its own session. That is what makes this a legitimate
 * bar split, unlike `mode` below.
 *
 * Stage resolution is shared with stageSpendTrend (`mostProgressedStageSql`),
 * so summing this across tasks reproduces that procedure's totals.
 */
const TokenUseStageSplitSchema = z.object({
	/** RPI label name ('rpi:implementation', …) or the `no_stage` sentinel. */
	stage: z.string(),
	tokens: z.number(),
	costUsd: z.number(),
})

/**
 * One person's share of a task.
 *
 * ## This deliberately reverses an earlier decision
 *
 * `contributorCount` was a bare count precisely so no per-person total could
 * be reconstructed. Splitting a task's bar by person needs the totals, so the
 * ids now travel — but only under the same entitlement and audience gates that
 * already serve `userStageSpend` and `userModeSpend`, which have published
 * per-person spend to this exact audience since they shipped. The finer grain
 * is new; the class of data reaching this caller is not. An org that opens the
 * page to every member opens these ids to them too.
 *
 * Only the id travels. Names live in the org member list the client already
 * holds, and someone who has left the org falls back to their raw id rather
 * than having their spend dropped.
 */
const TokenUseContributorSplitSchema = z.object({
	/** WorkOS user id ('user_…') whose daemon ran the sessions and spent the tokens. */
	userId: z.string(),
	tokens: z.number(),
	costUsd: z.number(),
})

const TokenUseTaskSchema = z.object({
	taskId: z.string(),
	name: z.string(),
	/** e.g. 'ENG-1234'. Null for tasks created without a ticket. */
	ticketId: z.string().nullable(),
	sessionCount: z.number(),
	/** input + output + cache read + cache creation, summed over the task's sessions. */
	tokens: z.number(),
	costUsd: z.number(),
	/**
	 * How many distinct people touched the task: session creators plus the task's
	 * creator. Kept alongside `contributors` because it counts the CREATOR too,
	 * and a task created by one person and worked by another should read as 2
	 * even though only one of them ever billed a token.
	 */
	contributorCount: z.number(),
	modelCount: z.number(),
	/**
	 * `tasks.workflow_type` — 'prd_tdd', 'outline_only', 'oneshot', 'freeform',
	 * or the legacy 'rpi'. Passed through unmapped so a future mode shows up
	 * rather than vanishing.
	 *
	 * A SCALAR, not an array, and that is the whole point: a task has exactly
	 * one mode. Splitting a bar by it would paint one band at 100% on every
	 * row, so the client tints the whole bar instead of segmenting it.
	 */
	mode: z.string(),
	agents: z.array(TokenUseAgentSplitSchema),
	models: z.array(TokenUseModelSplitSchema),
	stages: z.array(TokenUseStageSplitSchema),
	contributors: z.array(TokenUseContributorSplitSchema),
})

/**
 * One page of the range's tasks, ranked by the requested measure.
 *
 * Token counts are raw provider counters and are dominated by cache reads
 * (~64% of volume on dev, against 0.34% output), so they are comparable
 * BETWEEN tasks but should never be read as "work done". That is what the
 * cost measure is for, and why the card carries both.
 */
export const TokenUseByTaskOutputSchema = z.object({
	data: z.array(TokenUseTaskSchema),
	/**
	 * What this page was ranked by — an echo of the input.
	 *
	 * The client keeps the previous page on screen while a new one loads, so
	 * during a Tokens↔Cost flip the rows on screen and the requested measure
	 * disagree for the length of a fetch. Drawing bars from the prop would
	 * divide the new measure by the old measure's maximum and collapse every
	 * bar to its floor. Reading the measure off the payload keeps the picture
	 * consistent with the rows it is actually made of.
	 */
	measure: z.enum(TOKEN_USE_MEASURES),
	/** Feed back as `cursor` for the next page. Null once this page is the last. */
	nextCursor: TaskCursorSchema.nullable(),
	/**
	 * Every task matching `search` in the range, whether or not it is on this
	 * page. Identical on every page, so the footer's "N of M" and the filter's
	 * answer stay stable while pages stream in.
	 */
	matched: z.object({
		taskCount: z.number(),
		tokens: z.number(),
		costUsd: z.number(),
	}),
	/**
	 * The largest value under `measure` across the whole matched set — THE
	 * scale every bar is drawn against.
	 *
	 * Sent explicitly rather than derived from the first row, so the bars keep
	 * one scale for the life of the list. Measuring against the loaded rows
	 * instead would be stable only by accident: the moment a filter changes
	 * which task ranks first, every bar already on screen would rescale
	 * mid-scroll.
	 */
	maxValue: z.number(),
	startDate: z.string(),
	endDate: z.string(),
})

export const tokenUseByTaskContract = contractBuilder
	.input(TokenUseByTaskInputSchema)
	.output(TokenUseByTaskOutputSchema)
