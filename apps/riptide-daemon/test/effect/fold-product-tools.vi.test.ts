import { NodeFileSystem } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { customModel, defineAgent, startSession } from '@humanlayer/fold-core'
import { Effect, Ref, Stream } from 'effect'
import { LanguageModel, type Response } from 'effect/ai'
import { describe, expect } from 'vitest'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { makeFoldHumanLayerTools } from '@/effects/services/fold-sessions/fold-product-tools'

import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

const finishPart = (reason: typeof Response.FinishReason.Type): Response.StreamPartEncoded => ({
	type: 'finish',
	reason,
	response: undefined,
	usage: {
		inputTokens: { uncached: 10, total: 10, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: 5, text: 5, reasoning: undefined },
	},
})

describe('Fold HumanLayer product tools', () => {
	it.effect('executes a task-scoped artifact comment tool through a real Fold session', () =>
		Effect.gen(function* () {
			const calls: Array<unknown> = []
			const turns = yield* Ref.make<ReadonlyArray<ReadonlyArray<Response.StreamPartEncoded>>>([
				[
					{
						type: 'tool-call',
						id: 'provider-call-1',
						name: 'get_artifact_comments',
						params: { artifact_filename: 'plan.md', include_resolved: false },
						providerExecuted: false,
					},
					finishPart('tool-calls'),
				],
				[
					{ type: 'text-start', id: 'text-1' },
					{ type: 'text-delta', id: 'text-1', delta: 'Reviewed the artifact comments.' },
					{ type: 'text-end', id: 'text-1' },
					finishPart('stop'),
				],
			])
			const makeLanguageModel = LanguageModel.make({
				generateText: () => Effect.die('The scripted model only supports streamText'),
				streamText: () =>
					Stream.unwrap(
						Ref.modify(turns, (remaining) => {
							const turn = remaining[0]
							return [
								turn === undefined ? Stream.die('Scripted model exhausted') : Stream.fromIterable(turn),
								remaining.slice(1),
							] as const
						}),
					),
			})
			const api = makeMockDaemonApi({
				getArtifactComments: (input) =>
					Effect.sync(() => {
						calls.push(input)
						return {
							artifactFilename: input.artifactFilename,
							comments: [
								{
									id: '11111111-1111-4111-8111-111111111111',
									truncatedId: 'abcdef123456',
									userName: 'Reviewer',
									isResolved: false,
									createdByAgent: false,
									contentText: 'Clarify the validation step.',
									quotedText: null,
									previousBlockText: null,
									nextBlockText: null,
									replyToCommentId: null,
								},
							],
						}
					}),
			})
			const model = customModel({
				activeModel: {
					providerId: 'scripted-openai',
					providerKind: 'openai-compatible',
					modelId: 'gpt-scripted',
					role: null,
					requestedReasoningLevel: 'off',
					reasoning: { _tag: 'disabled' },
				},
				make: makeLanguageModel,
			})
			const tools = yield* makeFoldHumanLayerTools({
				taskId: 'task-1',
				enableLibraryResearcher: false,
			}).pipe(Effect.provideService(DaemonApi, api))
			const toolsWithoutTask = yield* makeFoldHumanLayerTools({
				taskId: null,
				enableLibraryResearcher: false,
			}).pipe(Effect.provideService(DaemonApi, api))
			expect(toolsWithoutTask).toEqual([])
			const session = yield* startSession({
				agent: defineAgent({ model, systemPrompt: 'Test product tools.', tools }),
				cwd: '/tmp/fold-product-tools',
			})

			const result = yield* session.send('Read artifact comments.')
			const entries = yield* session.entries
			const toolResult = entries.find((entry) => entry._tag === 'tool-result')

			expect(result.resultText).toBe('Reviewed the artifact comments.')
			expect(calls).toEqual([{ taskId: 'task-1', artifactFilename: 'plan.md', includeResolved: false }])
			expect(JSON.stringify(toolResult)).toContain('Clarify the validation step.')
		}).pipe(Effect.provide(NodeFileSystem.layer)),
	)
})
