import { describe, it } from '@effect/vitest'
import { runPostToolUseHooks } from '@humanlayer/agentlayer-core'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { expect } from 'vitest'
import * as z from 'zod'

import {
	createCodelayerTaskDiffCaptureHook,
	isTaskDiffCaptureTool,
} from '../../src/agents/codelayer/hooks/task-diff-capture-hook'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { makeTaskDiffCaptureHarness } from '../helpers/task-diff-capture-harness'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'

const runHook = (hook: ReturnType<typeof createCodelayerTaskDiffCaptureHook>, toolName: string) =>
	runPostToolUseHooks([hook], {
		toolName,
		toolCallId: `tool-call-${toolName}`,
		input: {},
		output: 'ok',
		rawOutput: 'ok',
		tool: { name: toolName, inputSchema: z.record(z.string(), z.unknown()) },
		getContextWindow: () => [],
	})

describe('CodeLayer task diff capture hook', () => {
	it.effect('matches normalized write, edit, apply_patch, and shell tool names', () =>
		Effect.sync(() => {
			expect(
				[
					'write',
					'WRITE',
					'edit',
					'multi_edit',
					'Multi-Edit',
					'apply_patch',
					'ApplyPatch',
					'bash',
					'Bash',
					'shell',
				].map(isTaskDiffCaptureTool),
			).toEqual(Array.from({ length: 10 }, () => true))
			expect(isTaskDiffCaptureTool('read')).toBe(false)
			expect(isTaskDiffCaptureTool('grep')).toBe(false)
		}),
	)

	it.effect('requests task/session capture for each side-effectful tool and ignores reads', () =>
		Effect.gen(function* () {
			const requests: Array<{ readonly taskId: string; readonly sessionId: string }> = []
			const runtime = ManagedRuntime.make(
				Layer.succeed(TaskDiffServiceRegistry, {
					requestCapture: (request) => Effect.sync(() => requests.push(request)).pipe(Effect.asVoid),
					registerWorkspace: () => Effect.void,
					suspendWorkspace: () => Effect.void,
					resumeWorkspace: () => Effect.void,
					drain: Effect.void,
				}).pipe(Layer.provideMerge(UnusedGitRequirements)),
			)
			const hook = createCodelayerTaskDiffCaptureHook({
				taskId: 'task-1',
				sessionId: 'session-1',
				services: { daemonRuntime: runtime },
			})

			yield* Effect.promise(() =>
				Promise.all(['write', 'edit', 'apply_patch', 'bash', 'read'].map((tool) => runHook(hook, tool))),
			)

			expect(requests).toEqual(Array.from({ length: 4 }, () => ({ taskId: 'task-1', sessionId: 'session-1' })))
			yield* Effect.promise(() => runtime.dispose())
		}),
	)

	it.effect('returns after scheduling while the shared capture service is blocked', () =>
		Effect.gen(function* () {
			const harness = yield* makeTaskDiffCaptureHarness
			const hook = createCodelayerTaskDiffCaptureHook({
				taskId: 'task-1',
				sessionId: 'session-1',
				services: { daemonRuntime: harness.runtime },
			})
			const hookPromise = runHook(hook, 'apply_patch')
			yield* harness.waitForCapture
			const returnedBeforeCapture = yield* Effect.promise(() =>
				Promise.race([
					hookPromise.then(() => true),
					new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
				]),
			)

			expect(returnedBeforeCapture).toBe(true)
			expect(harness.capturedRepos).toHaveLength(1)
			expect(harness.capturedRepos[0]).toMatchObject({ taskId: 'task-1', sessionId: 'session-1' })
			yield* harness.releaseAndDispose
		}),
	)
})
