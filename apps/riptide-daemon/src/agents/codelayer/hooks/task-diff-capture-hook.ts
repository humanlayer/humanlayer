import type { PostToolUseHook } from '@humanlayer/agentlayer-core'
import { Effect } from 'effect'

import type { TaskDiffRuntime } from '@/effects/runtime'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { Sentry } from '@/instrument'
import { isApplyPatchTool, isEditTool, isShellTool, isWriteTool } from '@/lib/artifact-sync-utils'
import logger from '@/logger'

/** Inputs already held by the CodeLayer session boundary when constructing the hook. */
export interface CodelayerTaskDiffCaptureHookOptions {
	readonly taskId: string
	readonly sessionId: string
	readonly services: { readonly daemonRuntime: TaskDiffRuntime }
}

/** Returns whether an AgentLayer tool can mutate the task workspace. */
export function isTaskDiffCaptureTool(toolName: string): boolean {
	return isWriteTool(toolName) || isEditTool(toolName) || isApplyPatchTool(toolName) || isShellTool(toolName)
}

/** Creates a best-effort CodeLayer PostToolUse adapter for task diff capture scheduling. */
export function createCodelayerTaskDiffCaptureHook({
	taskId,
	sessionId,
	services,
}: CodelayerTaskDiffCaptureHookOptions): PostToolUseHook {
	return async (context) => {
		const { toolName } = context
		if (!isTaskDiffCaptureTool(toolName)) return context.done()

		await services.daemonRuntime
			.runPromise(
				Effect.gen(function* () {
					const registry = yield* TaskDiffServiceRegistry
					yield* registry.requestCapture({ taskId, sessionId })
				}),
			)
			.catch((cause: unknown) => {
				logger.error({ cause, taskId, sessionId, toolName }, 'Failed to request task diff capture')
				Sentry.captureException(cause, {
					tags: { error_type: 'task_diff_capture_scheduling', agent: 'codelayer' },
					extra: { taskId, sessionId, toolName },
				})
			})

		return context.done()
	}
}
