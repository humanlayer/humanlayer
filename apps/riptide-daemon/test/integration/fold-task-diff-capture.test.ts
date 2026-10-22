import { describe, it } from '@effect/vitest'
import { AgentId, ToolCallId } from '@humanlayer/fold-core'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { makeFoldTaskDiffCaptureHook } from '@/effects/services/fold-sessions/fold-product-hooks'

import { runTaskDiffCaptureFixture } from './helpers/task-diff-capture-fixture'

describe('Fold task diff capture integration', () => {
	it.effect('coalesces repeated tool scheduling into the final workspace diff', () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runTaskDiffCaptureFixture({
					tempDirectoryPrefix: 'fold-task-diff-capture-',
					organizationId: 'organization-fixture',
					taskId: 'task-fixture',
					hostId: 'host-fixture',
					sessionId: 'session-fixture',
					capture: async ({ worktree, taskId, sessionId, runtime }) => {
						const hook = await runtime.runPromise(makeFoldTaskDiffCaptureHook({ taskId, sessionId }))
						const invokeHook = (toolCallId: string) =>
							runtime.runPromise(
								hook.handler({
									agentId: AgentId.create(),
									parentAgentId: null,
									toolCallId: ToolCallId.make(toolCallId),
									toolName: 'write',
									originalInput: {},
									executedInput: {},
									handlerResult: {},
									result: {},
									isFailure: false,
								}),
							)

						await writeFile(`${worktree}/modified.txt`, 'after first Fold write\n')
						await invokeHook('tool_call_aaaaaaaaaaaaaaaaaaaaaaaa')
						await writeFile(`${worktree}/fold-added.txt`, 'after second Fold write\n')
						await invokeHook('tool_call_bbbbbbbbbbbbbbbbbbbbbbbb')
					},
				}),
			)

			expect(result.files.map((file) => file.path).sort()).toEqual(['fold-added.txt', 'modified.txt'])
			expect(result.files.every((file) => file.sessionId === 'session-fixture')).toBe(true)
			expect(result.versions).toHaveLength(2)
			expect(result.versions.map((version) => version.content).join('\n')).toContain('after second Fold write')
		}),
	)
})
import { writeFile } from 'node:fs/promises'
