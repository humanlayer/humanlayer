import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

/**
 * Model counts past this fold into one bucket. Ten separate rows for ten
 * distinct model counts is a long tail nobody reads; the interesting split is
 * "one or two models" against "a whole pipeline of them".
 */
export const TASK_FAN_OUT_MODEL_CAP = 4

export const TaskFanOutInputSchema = metricsRangeInput()

/**
 * Tasks bucketed by a fan-out count, with the share of tokens they carry.
 *
 * Both numbers matter and they routinely disagree — that disagreement IS the
 * chart. On dev the 52 two-agent tasks are 16% of tasks and 51% of tokens.
 */
const FanOutBucketSchema = z.object({
	/** The count this bucket is for: 1 contributor, 2 agents, 3 models, … */
	count: z.number(),
	/** True when the bucket is "`count` or more" rather than exactly `count`. */
	folded: z.boolean(),
	taskCount: z.number(),
	tokens: z.number(),
	costUsd: z.number(),
})

/**
 * How work fans out across a task: how many people, how many coding agents,
 * how many models.
 *
 * `contributors` is a DISTRIBUTION OF COUNTS and carries no identity — the
 * handler groups by `count(distinct …)` and never selects a user id, so a
 * per-person total cannot be derived from this payload. It is also, on today's
 * data, nearly a constant (99.4% of dev tasks are one person), which is
 * exactly why the card shows a per-row contributor mark only on the
 * exceptions.
 *
 * Buckets are sparse — a count with no tasks is absent, and clients densify.
 */
export const TaskFanOutOutputSchema = z.object({
	contributors: z.array(FanOutBucketSchema),
	agents: z.array(FanOutBucketSchema),
	models: z.array(FanOutBucketSchema),
	/** Every task with usage in the range — the denominator for "share of tasks". */
	taskCount: z.number(),
	/** Total tokens over those tasks — the denominator for "share of tokens". */
	tokens: z.number(),
	startDate: z.string(),
	endDate: z.string(),
})

export const taskFanOutContract = contractBuilder.input(TaskFanOutInputSchema).output(TaskFanOutOutputSchema)
