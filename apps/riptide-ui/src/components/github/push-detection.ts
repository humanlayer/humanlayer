export interface PushDetectionEvent {
	readonly toolName?: string
	readonly toolInputJson?: string
	readonly isCompleted?: boolean
}

const GIT_PUSH_COMMAND = /\bgit\s+push\b/

const commandOf = (toolInputJson: string): string | null => {
	try {
		const input: unknown = JSON.parse(toolInputJson)
		if (typeof input !== 'object' || input === null) return null
		const command = (input as { command?: unknown }).command
		return typeof command === 'string' ? command : null
	} catch {
		return null
	}
}

/**
 * A finished Bash tool call whose command pushes with git. The quoted-string false positive
 * (`echo "git push"`) is accepted: a card under a command that only mentions pushing is cheaper
 * than a shell parser that misses a real push.
 */
export const isGitPushToolCall = (event: PushDetectionEvent): boolean => {
	if (event.toolName !== 'Bash' || event.isCompleted !== true || !event.toolInputJson) return false
	if (!event.toolInputJson.includes('push')) return false
	const command = commandOf(event.toolInputJson)
	return command !== null && GIT_PUSH_COMMAND.test(command)
}

/** The id of the last completed push among `events`, in stream order; null when none pushed. */
export const latestGitPushEventId = (events: ReadonlyArray<PushDetectionEvent & { id: string }>): string | null => {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]
		if (event && isGitPushToolCall(event)) return event.id
	}
	return null
}
