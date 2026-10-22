import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { createDiffCommentTools, createHumanlayerTools } from '@/agents/shared/humanlayer-tools/codelayer-tools'
import { executeUpdateDiffComments, type RunDiffCommentToolEffect } from '@/agents/shared/humanlayer-tools/executors'
import { TOOL_DESCRIPTIONS } from '@/agents/shared/humanlayer-tools/schemas'

import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'
import { createMockORPCClient } from '../mocks/orpc-client.mock'

function makeRunner(): RunDiffCommentToolEffect {
	const layer = makeMockDaemonApiLayer({ getDiffComments: () => Effect.succeed({ comments: [] }) })
	return (effect) => Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe('CodeLayer diff comment tools', () => {
	test('registers all three exact tools for a task-bound session', async () => {
		const tools = createDiffCommentTools({ taskId: 'task-from-server', runDiffCommentEffect: makeRunner() })
		expect(Object.keys(tools)).toEqual(['get_diff_comments', 'reply_to_diff_comment', 'update_diff_comments'])
		expect(tools.update_diff_comments?.description).toBe(TOOL_DESCRIPTIONS.update_diff_comments)
	})

	test('uses one provider-compatible object schema and removes null updates before execution', async () => {
		const requests: Array<unknown> = []
		const layer = makeMockDaemonApiLayer({
			updateDiffComments: (input) => {
				requests.push(input)
				return Effect.succeed({ success: true, updated: [], failed: [], transactionId: 'tx-1' })
			},
		})
		const runDiffCommentEffect: RunDiffCommentToolEffect = (effect) =>
			Effect.runPromise(effect.pipe(Effect.provide(layer)))
		const tools = createDiffCommentTools({ taskId: 'task-from-server', runDiffCommentEffect })
		const updateTool = tools.update_diff_comments
		if (!updateTool) throw new Error('update_diff_comments was not registered')

		const providerSchema = z.toJSONSchema(updateTool.input)
		expect(providerSchema).toMatchObject({
			type: 'object',
			required: ['comment_ids', 'resolved', 'deleted'],
		})

		const resolveOnly = { comment_ids: ['c1a600000002'], resolved: false, deleted: null } as const
		const resolveOnlyTrue = { comment_ids: ['c1a600000002'], resolved: true, deleted: null } as const
		const deleteOnly = { comment_ids: ['c1a600000002'], resolved: null, deleted: true } as const
		expect(updateTool.input.parse(resolveOnly)).toEqual(resolveOnly)
		expect(updateTool.input.parse(resolveOnlyTrue)).toEqual(resolveOnlyTrue)
		expect(updateTool.input.parse(deleteOnly)).toEqual(deleteOnly)
		expect(() => updateTool.input.parse({ comment_ids: ['c1a600000002'], resolved: null, deleted: null })).toThrow(
			'At least one of resolved or deleted must be provided',
		)

		await updateTool.execute(updateTool.input.parse(resolveOnly), {} as never)
		expect(requests).toEqual([
			{
				taskId: 'task-from-server',
				truncatedCommentIds: ['c1a600000002'],
				resolved: false,
				deleted: undefined,
			},
		])
	})

	test('does not register diff tools for a taskless session', () => {
		const tools = createHumanlayerTools({
			orpc: createMockORPCClient(),
			runDiffCommentEffect: makeRunner(),
			taskId: null,
			enableLibraryResearcher: false,
		})
		expect(tools).toEqual({})
	})
})
