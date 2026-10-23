import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import { Sentry } from '@/instrument'
import logger from '@/logger'

/** Inputs already held by the Claude session boundary when constructing the hook. */
export interface ClaudeTaskDiffCaptureHookOptions {
	readonly taskId: string
	readonly sessionId: string
	readonly requestCapture: () => Promise<void>
}

/** Creates a best-effort Claude PostToolUse adapter for task diff capture scheduling. */
export function createClaudeTaskDiffCaptureHook(options: ClaudeTaskDiffCaptureHookOptions): HookCallback {
	const { taskId, sessionId, requestCapture } = options
	return async (input: HookInput): Promise<HookJSONOutput> => {
		if (input.hook_event_name !== 'PostToolUse') return { continue: true }

		await requestCapture().catch((cause: unknown) => {
			logger.error({ cause, taskId, sessionId }, 'Failed to request task diff capture')
			Sentry.captureException(cause, {
				tags: { error_type: 'task_diff_capture_scheduling', agent: 'claude' },
				extra: { taskId, sessionId },
			})
		})

		return { continue: true }
	}
}
