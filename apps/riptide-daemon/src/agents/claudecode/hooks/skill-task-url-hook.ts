import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import { getTaskArtifactsCloudUrl, getTaskDeepLinkUrl } from '@/lib/cloud-urls'
import logger from '@/logger'

export interface SkillTaskUrlHookDeps {
	getTaskArtifactsCloudUrl?: (taskId: string) => string | undefined
	getTaskDeepLinkUrl?: (taskId: string) => string | undefined
}

/**
 * Extract skill name from Skill tool input.
 */
function getSkillName(toolName: string, toolInput: unknown): string | null {
	if (toolName !== 'Skill') return null
	if (typeof toolInput === 'object' && toolInput !== null) {
		return (toolInput as { skill?: string }).skill || null
	}
	return null
}

/**
 * Creates a PostToolUse hook that provides task-level cloud URLs when rpi:describe-pr is invoked.
 *
 * Returns both the task artifacts page URL and the deep link URL via additionalContext,
 * so the model can fill in the PR template header with correct links instead of hallucinating them.
 *
 * If taskId is null (session has no task), returns a hook that immediately no-ops.
 */
export function createSkillTaskUrlHook(taskId: string | null, deps: SkillTaskUrlHookDeps = {}): HookCallback {
	const getTaskArtifactsCloudUrlFn = deps.getTaskArtifactsCloudUrl ?? getTaskArtifactsCloudUrl
	const getTaskDeepLinkUrlFn = deps.getTaskDeepLinkUrl ?? getTaskDeepLinkUrl

	if (!taskId) {
		return async () => ({ continue: true })
	}

	return async (
		input: HookInput,
		_toolUseID: string | undefined,
		_options: { signal: AbortSignal },
	): Promise<HookJSONOutput> => {
		if (input.hook_event_name !== 'PostToolUse') {
			return { continue: true }
		}

		const toolName = (input as { tool_name?: string }).tool_name ?? ''
		const skillName = getSkillName(toolName, input.tool_input)

		if (skillName !== 'rpi:describe-pr') {
			return { continue: true }
		}

		const artifactsUrl = getTaskArtifactsCloudUrlFn(taskId)
		const deepLinkUrl = getTaskDeepLinkUrlFn(taskId)

		const urls = [
			artifactsUrl ? `Artifacts: ${artifactsUrl}` : undefined,
			deepLinkUrl ? `Deep link: ${deepLinkUrl}` : undefined,
		].filter((url) => url !== undefined)
		if (urls.length === 0) return { continue: true }

		logger.info({ taskId, artifactsUrl, deepLinkUrl }, 'Providing task cloud URLs for rpi:describe-pr')

		return {
			continue: true,
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext: `Task cloud URLs — ${urls.join(' | ')}`,
			},
		}
	}
}
