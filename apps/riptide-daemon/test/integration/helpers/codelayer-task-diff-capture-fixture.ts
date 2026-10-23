import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runPostToolUseHooks, startState, userMessage } from '@humanlayer/agentlayer-core'
import { createCodingSubagentTool } from '@humanlayer/codelayer'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import * as z from 'zod'

import { createCodelayerTaskDiffCaptureHook } from '../../../src/agents/codelayer/hooks/task-diff-capture-hook'
import { runTaskDiffCaptureFixture, type TaskDiffCaptureFixtureResult } from './task-diff-capture-fixture'

export type CodelayerCaptureTool = 'write' | 'edit' | 'apply_patch' | 'bash'
export type CodelayerTaskDiffCaptureFixtureResult = TaskDiffCaptureFixtureResult

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 1, text: 1, reasoning: undefined },
}

const runSubagentWrite = async (
	worktree: string,
	hook: ReturnType<typeof createCodelayerTaskDiffCaptureHook>,
): Promise<void> => {
	let callCount = 0
	const model = new MockLanguageModelV3({
		modelId: 'claude-test-model',
		doStream: async () => {
			callCount += 1
			if (callCount === 1) {
				return {
					stream: simulateReadableStream({
						chunks: [
							{ type: 'stream-start', warnings: [] },
							{ type: 'tool-input-start', id: 'subagent-write', toolName: 'write' },
							{
								type: 'tool-input-delta',
								id: 'subagent-write',
								delta: JSON.stringify({
									file_path: join(worktree, 'subagent-write.txt'),
									content: 'added by CodeLayer subagent\n',
								}),
							},
							{ type: 'tool-input-end', id: 'subagent-write' },
							{
								type: 'tool-call',
								toolCallId: 'subagent-write',
								toolName: 'write',
								input: JSON.stringify({
									file_path: join(worktree, 'subagent-write.txt'),
									content: 'added by CodeLayer subagent\n',
								}),
							},
							{ type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
						],
					}),
				}
			}

			return {
				stream: simulateReadableStream({
					chunks: [
						{ type: 'text-start', id: 'subagent-result' },
						{ type: 'text-delta', id: 'subagent-result', delta: 'done' },
						{ type: 'text-end', id: 'subagent-result' },
						{ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
					],
				}),
			}
		},
	})
	const subagentTool = await createCodingSubagentTool({ cwd: worktree, model, hooks: { postToolUse: [hook] } })
	const child = subagentTool.subagents.find((candidate) => candidate.name === 'general-purpose')
	if (!child) throw new Error('CodeLayer general-purpose subagent is unavailable')

	const result = await child.agent.run({ state: startState([userMessage('Write the fixture file')]) }).result
	if (result.finishReason === 'error') throw new Error(result.error?.message ?? 'CodeLayer subagent fixture failed')
}

const mutateFixture = async (worktree: string, toolName: CodelayerCaptureTool): Promise<string> => {
	if (toolName === 'edit') {
		await writeFile(join(worktree, 'modified.txt'), 'edited by CodeLayer\n')
		return 'modified.txt'
	}

	const path = `${toolName.replace('_', '-')}.txt`
	await writeFile(join(worktree, path), `added by CodeLayer ${toolName}\n`)
	return path
}

/** Runs an AgentLayer PostToolUse callback through real Git capture and local Durable Streams. */
export const runCodelayerTaskDiffCaptureFixture = async (
	toolName: CodelayerCaptureTool,
	options: { readonly includeEnvironmentFile?: boolean; readonly throughSubagent?: boolean } = {},
): Promise<CodelayerTaskDiffCaptureFixtureResult> =>
	runTaskDiffCaptureFixture({
		tempDirectoryPrefix: `codelayer-${toolName}-task-diff-capture-`,
		organizationId: 'org-codelayer-fixture',
		taskId: 'task-codelayer-fixture',
		hostId: 'host-codelayer-fixture',
		sessionId: 'session-fixture',
		capture: async ({ worktree, taskId, sessionId, runtime }) => {
			const hook = createCodelayerTaskDiffCaptureHook({
				taskId,
				sessionId,
				services: { daemonRuntime: runtime },
			})
			if (options.throughSubagent) {
				await runSubagentWrite(worktree, hook)
				return
			}

			const changedPath = await mutateFixture(worktree, toolName)
			if (options.includeEnvironmentFile) {
				await writeFile(join(worktree, '.env.integration'), 'INTEGRATION_SECRET=excluded-value\n')
			}
			await runPostToolUseHooks([hook], {
				toolName,
				toolCallId: `tool-use-${toolName}`,
				input: { file_path: join(worktree, changedPath) },
				output: 'ok',
				rawOutput: { success: true },
				tool: { name: toolName, inputSchema: z.record(z.string(), z.unknown()) },
				getContextWindow: () => [],
			})
		},
	})
