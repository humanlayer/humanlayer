import {
	normalizeSkillToolInput,
	normalizeToolName,
	parseToolInput,
	type ConversationEvent,
} from '@humanlayer/ui/components/conversation-stream'
import { RPI_SKILL_BY_NAME } from '@humanlayer/ui/constants/rpi-skills'

export function getLatestInvokedRpiPhase(events: readonly ConversationEvent[]): string | null {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index]
		if (event?.eventType !== 'tool_call' || normalizeToolName(event.toolName) !== 'skill') continue

		const input = normalizeSkillToolInput(parseToolInput<unknown>(event.toolInputJson))
		if (!input) continue

		const rpiSkill = RPI_SKILL_BY_NAME.get(input.skill)
		if (rpiSkill) return rpiSkill.label.name.replace(/^rpi:/, '')
	}

	return null
}
