import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { ContextShardInferenceInput } from '../../src/agents/context-shards'

/**
 * Realistic multi-user evidence for the opt-in live eval.
 *
 * Three notional users across four sessions:
 * - s1 (user A), s2 (user B), s4 (user C) each repeat the same lesson in
 *   different words: update contract tests whenever an API response shape
 *   changes, and verify the whole response.
 * - s2 and s3 also repeat a second lesson about the canary branch, but that
 *   lesson is already covered by an excluded dismissed shard, so the model
 *   must not propose it again.
 * - The released exclusion covers bun-vs-npm steering that also shows up in
 *   the evidence (s3, m8).
 * - s3 is otherwise ordinary task noise with no reusable steering.
 *
 * Message tags are one global sequence (m1..mN), matching how the admin
 * generation layer packs the prompt.
 */
export function buildEvalInput(seed: string): ContextShardInferenceInput {
	return {
		excludedReleasedShards: ['Use bun instead of npm, yarn, or pnpm for every package management command.'],
		excludedDismissedShards: [
			'The canary branch is the mainline branch for feature work; branch from and merge into canary.',
		],
		sessions: [
			{
				sessionTag: 's1',
				taskTag: 't1',
				messages: [
					{
						messageId: 'm1',
						role: 'user',
						content:
							'Add the new pagination fields to the /v2/orders endpoint. When the API response shape changes like this, you need to update the contract tests too and verify the full response body before merging.',
					},
					{
						messageId: 'm2',
						role: 'assistant',
						content:
							'Added nextCursor and pageSize to the orders response, updated the contract tests in contracts/orders.test.ts to assert the whole response shape, and all tests pass.',
					},
					{
						messageId: 'm3',
						role: 'user',
						content: 'Great. Also rename the internal helper to buildOrdersPage, no behavior change.',
					},
				],
			},
			{
				sessionTag: 's2',
				taskTag: 't2',
				messages: [
					{
						messageId: 'm4',
						role: 'user',
						content:
							'You changed the customers endpoint response but the contract tests still assert the old shape. Always change the API contract tests when a response changes, then check the whole response shape, not just the new field.',
					},
					{
						messageId: 'm5',
						role: 'assistant',
						content:
							'You are right. I updated the customer contract tests to validate the entire response object including the new address block.',
					},
					{
						messageId: 'm6',
						role: 'user',
						content: 'Remember to open the PR against canary, that is our mainline for feature work.',
					},
				],
			},
			{
				sessionTag: 's3',
				taskTag: null,
				messages: [
					{
						messageId: 'm7',
						role: 'user',
						content: 'Fix the flaky retry test in packages/queue, it times out on CI sometimes.',
					},
					{
						messageId: 'm8',
						role: 'user',
						content: 'Use bun to install, not npm — bun install is what we use everywhere.',
					},
					{
						messageId: 'm9',
						role: 'assistant',
						content:
							'Bumped the fake timer advance in the retry test and ran it 50 times locally with bun without a failure.',
					},
					{
						messageId: 'm10',
						role: 'user',
						content: `Also target canary with this fix, not main.${seed}`,
					},
				],
			},
			{
				sessionTag: 's4',
				taskTag: 't3',
				messages: [
					{
						messageId: 'm11',
						role: 'user',
						content:
							'The invoices response now returns amounts in cents. Whenever we change a response payload like this, please also fix the contract tests and re-verify the complete response before you call it done.',
					},
					{
						messageId: 'm12',
						role: 'assistant',
						content:
							'Converted the invoice amounts to cents, updated the invoice contract tests to cover the full payload, and verified the complete response in the integration run.',
					},
				],
			},
		],
	}
}

const EVAL_MESSAGE_IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const
const EvalMessageId = Schema.Literals(EVAL_MESSAGE_IDS)
type EvalMessageId = typeof EvalMessageId.Type

export const parseEvalMessageId = Schema.decodeUnknownOption(EvalMessageId)

/** Maps each message tag back to its session tag for cross-user assertions. */
const EVAL_MESSAGE_SESSION: Record<EvalMessageId, string> = {
	m1: 's1',
	m2: 's1',
	m3: 's1',
	m4: 's2',
	m5: 's2',
	m6: 's2',
	m7: 's3',
	m8: 's3',
	m9: 's3',
	m10: 's3',
	m11: 's4',
	m12: 's4',
}

export function getEvalMessageSession(messageId: string): string | undefined {
	return Option.match(Schema.decodeUnknownOption(EvalMessageId)(messageId), {
		onNone: () => undefined,
		onSome: (knownMessageId) => EVAL_MESSAGE_SESSION[knownMessageId],
	})
}
