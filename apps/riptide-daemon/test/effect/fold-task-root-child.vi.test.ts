import { mkdir, rm, writeFile } from 'node:fs/promises'

import { it } from '@effect/vitest'
import { codingTools as makeCodingTools } from '@humanlayer/fold-agent'
import {
	customModel,
	defineAgent,
	defineTool,
	runtimeForAgent,
	skillSource,
	skillTool,
	startSession,
	type SkillSourceService,
} from '@humanlayer/fold-core'
import { Effect, Ref, Schema, Stream } from 'effect'
import { LanguageModel, type Response } from 'effect/ai'
import { describe, expect } from 'vitest'

import { makeFoldAgentDelegation } from '@/effects/services/fold-sessions/fold-agent-tool'
import { layerFoldHostServices } from '@/effects/services/fold-sessions/fold-host-services'
import {
	makeFoldArtifactReadSyncHook,
	makeFoldWorkflowRoutingHook,
} from '@/effects/services/fold-sessions/fold-product-hooks'
import type { ISyncManager } from '@/lib/sync-service-types'

const finishPart = (reason: typeof Response.FinishReason.Type): Response.StreamPartEncoded => ({
	type: 'finish',
	reason,
	response: undefined,
	usage: {
		inputTokens: { uncached: 10, total: 10, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: 5, text: 5, reasoning: undefined },
	},
})

describe('task-backed Fold root and child integration', () => {
	it.effect(
		'shares task skills, product tools, and hooks with a scripted child while preserving delegation depth',
		() =>
			Effect.gen(function* () {
				const workingDirectory = '/tmp/fold-task-root-child'
				const artifactPath = `${workingDirectory}/.humanlayer/tasks/task-slug/plan.md`
				yield* Effect.tryPromise(() =>
					mkdir(`${workingDirectory}/.humanlayer/tasks/task-slug`, { recursive: true }),
				)
				yield* Effect.tryPromise(() => writeFile(artifactPath, '# Task plan', 'utf8'))
				yield* Effect.addFinalizer(() =>
					Effect.tryPromise(() => rm(workingDirectory, { recursive: true, force: true })).pipe(Effect.orDie),
				)
				const rootTurns = yield* Ref.make<ReadonlyArray<ReadonlyArray<Response.StreamPartEncoded>>>([
					[
						{
							type: 'tool-call',
							id: 'root-dispatch',
							name: 'subagent',
							params: {
								description: 'Inspect task feedback',
								prompt: 'Read the task artifact comments.',
								agent: 'general-purpose',
								skill: 'task-proof',
							},
							providerExecuted: false,
						},
						finishPart('tool-calls'),
					],
					[
						{ type: 'text-start', id: 'root-text' },
						{ type: 'text-delta', id: 'root-text', delta: 'Root received the child result.' },
						{ type: 'text-end', id: 'root-text' },
						finishPart('stop'),
					],
				])
				const childTurns = yield* Ref.make<ReadonlyArray<ReadonlyArray<Response.StreamPartEncoded>>>([
					[
						{
							type: 'tool-call',
							id: 'child-rpi-skill',
							name: 'skill',
							params: { name: 'rpi:create-plan' },
							providerExecuted: false,
						},
						finishPart('tool-calls'),
					],
					[
						{
							type: 'tool-call',
							id: 'child-comments',
							name: 'get_artifact_comments',
							params: { artifact_filename: 'plan.md' },
							providerExecuted: false,
						},
						finishPart('tool-calls'),
					],
					[
						{
							type: 'tool-call',
							id: 'child-artifact-read',
							name: 'read',
							params: { path: artifactPath },
							providerExecuted: false,
						},
						finishPart('tool-calls'),
					],
					[
						{ type: 'text-start', id: 'child-text' },
						{ type: 'text-delta', id: 'child-text', delta: 'Child inspected task comments.' },
						{ type: 'text-end', id: 'child-text' },
						finishPart('stop'),
					],
				])
				const requests = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([])
				const makeLanguageModel = LanguageModel.make({
					generateText: () => Effect.die('The scripted model only supports streamText'),
					streamText: (options) =>
						Stream.unwrap(
							Ref.update(requests, (all) => [...all, options.tools.map((tool) => tool.name)]).pipe(
								Effect.andThen(
									Ref.modify(
										options.tools.some((tool) => tool.name === 'subagent') ? rootTurns : childTurns,
										(remaining) => {
											const turn = remaining[0]
											return [
												turn === undefined
													? Stream.die('Scripted model exhausted')
													: Stream.fromIterable(turn),
												remaining.slice(1),
											] as const
										},
									),
								),
							),
						),
				})
				const model = customModel({
					activeModel: {
						providerId: 'scripted-openai',
						providerKind: 'openai-compatible',
						modelId: 'gpt-6-sol',
						role: null,
						requestedReasoningLevel: 'off',
						reasoning: { _tag: 'disabled' },
					},
					make: makeLanguageModel,
				})
				const skills = [
					{
						name: 'task-proof',
						description: 'Task-backed integration proof',
						content: 'Use the task context and inspect artifact comments.',
						baseDir: null,
					},
					{
						name: 'rpi:create-plan',
						description: 'Create an RPI plan',
						content: 'Create a structured implementation plan.',
						baseDir: null,
					},
				] as const
				const skillCatalog: SkillSourceService = {
					list: Effect.succeed(skills.map(({ name, description }) => ({ name, description }))),
					load: (name) => {
						const found = skills.find((skill) => skill.name === name)
						return found === undefined ? Effect.die(`Unexpected skill: ${name}`) : Effect.succeed(found)
					},
				}
				const sharedSkillTool = skillTool(skillSource(Effect.succeed(skillCatalog)))
				const productCalls = yield* Ref.make<ReadonlyArray<string>>([])
				const productTool = defineTool({
					name: 'get_artifact_comments',
					description: 'Read task artifact comments',
					parameters: Schema.Struct({ artifact_filename: Schema.String }),
					handler: ({ artifact_filename }) =>
						Ref.update(productCalls, (calls) => [...calls, artifact_filename]).pipe(
							Effect.as({ content: 'One task comment' }),
						),
				})
				const codingTools = makeCodingTools({ cwd: workingDirectory }).filter((tool) =>
					['read', 'bash'].includes(tool.name),
				)
				const synchronizedArtifacts: Array<{ fileName: string; content: string; operationType: string }> = []
				const syncManager: ISyncManager = {
					upsertArtifact: async (artifact) => {
						synchronizedArtifacts.push({
							fileName: artifact.fileName,
							content: artifact.content,
							operationType: artifact.operationType,
						})
						return { artifactId: 'artifact-1', designQuestionsResolved: false }
					},
					uploadS3Artifact: () => Promise.reject(new Error('Unexpected binary artifact upload')),
					getCollection: () => undefined,
				}
				const workflowRoutingHook = yield* makeFoldWorkflowRoutingHook({
					sessionId: 'session-1',
					workflowType: 'rpi',
					worktreeTiming: 'now',
					isInWorktree: false,
				})
				const artifactReadSyncHook = yield* makeFoldArtifactReadSyncHook({
					syncManager,
					sessionId: 'session-1',
					workingDirectory,
					taskId: 'task-1',
					taskSlug: 'task-slug',
				})
				const hooks = {
					postToolUse: [workflowRoutingHook, artifactReadSyncHook],
				}
				const taskPrompt = '<task_information>Task ID: task-1\nWorkflow: rpi</task_information>'
				const delegation = makeFoldAgentDelegation({
					model,
					codingTools,
					sharedSkillTool,
					productTools: [productTool],
					hooks,
					systemPrompt: taskPrompt,
				})
				const session = yield* startSession({
					agent: defineAgent({
						model,
						systemPrompt: taskPrompt,
						tools: [...codingTools, sharedSkillTool, productTool, delegation.rootAgentTool],
						hooks,
					}),
					cwd: workingDirectory,
				})
				const initialEntries = yield* session.entries
				expect(runtimeForAgent(initialEntries, session.rootAgentId).activeModel?.modelId).toBe('gpt-6-sol')

				// The public switch replaces only the root runtime; registered specialists keep their binding.
				yield* session.switchModel(
					customModel({
						activeModel: { ...model.activeModel, modelId: 'gpt-6-luna' },
						make: makeLanguageModel,
					}),
				)
				const result = yield* session.send('Delegate the task inspection.')
				const entries = yield* session.entries
				const started = entries.filter((entry) => entry._tag === 'agent_started')
				const child = started.find((entry) => entry.parentAgentId === session.rootAgentId)
				const observedRequests = yield* Ref.get(requests)

				expect(result.outcome).toBe('completed')
				expect(result.resultText).toBe('Root received the child result.')
				expect(started).toHaveLength(2)
				expect(runtimeForAgent(entries, session.rootAgentId).activeModel?.modelId).toBe('gpt-6-luna')
				expect(child?.model).toEqual(model.activeModel)
				expect(child?.tools).toContain('skill')
				expect(child?.tools).toContain('get_artifact_comments')
				expect(child?.tools).not.toContain('subagent')
				expect(observedRequests[0]).toContain('subagent')
				expect(observedRequests[1]).toContain('get_artifact_comments')
				expect(observedRequests[1]).toContain('skill')
				expect(observedRequests[1]).toContain('read')
				expect(observedRequests[1]).not.toContain('subagent')
				expect(yield* Ref.get(productCalls)).toEqual(['plan.md'])
				expect(synchronizedArtifacts).toEqual([
					{ fileName: 'plan.md', content: '# Task plan', operationType: 'Read' },
				])
			}).pipe(Effect.provide(layerFoldHostServices('fold-task-root-child-test'))),
	)
})
