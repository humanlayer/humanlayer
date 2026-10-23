import {
	type ConversationEvent,
	formatToolNameForDisplay,
	parseMcpToolName,
} from '@humanlayer/ui/components/conversation-stream'
import { Option, Schema } from 'effect'

export function isThinkingEvent(event: ConversationEvent): boolean {
	return Boolean(
		event.eventType === 'thinking' || (event.role === 'assistant' && event.content?.startsWith('<thinking>')),
	)
}

const DISPLAYED_TOOL_NAMES = [
	'bash',
	'bashoutput',
	'read',
	'write',
	'edit',
	'multiedit',
	'applypatch',
	'grep',
	'glob',
	'ls',
	'list',
	'websearch',
	'webfetch',
	'todowrite',
	'exitplanmode',
	'skill',
	'notebookread',
	'notebookedit',
	'task',
	'agent',
] as const
const DisplayedToolName = Schema.Literals(DISPLAYED_TOOL_NAMES)

const TOOL_DISPLAY_LABELS: Record<(typeof DISPLAYED_TOOL_NAMES)[number], string> = {
	bash: 'Bash',
	bashoutput: 'Bash Output',
	read: 'Read',
	write: 'Write',
	edit: 'Edit',
	multiedit: 'Multi Edit',
	applypatch: 'Apply Patch',
	grep: 'Grep',
	glob: 'Glob',
	ls: 'LS',
	list: 'List',
	websearch: 'Web Search',
	webfetch: 'Web Fetch',
	todowrite: 'Todo Write',
	exitplanmode: 'Exit Plan Mode',
	skill: 'Skill',
	notebookread: 'Notebook Read',
	notebookedit: 'Notebook Edit',
	task: 'Agent',
	agent: 'Agent',
}

export function getMobileToolDisplayLabel(event: ConversationEvent): string {
	if (event.toolName?.startsWith('mcp__')) {
		const { method } = parseMcpToolName(event.toolName)
		return formatToolNameForDisplay(method || event.toolName)
	}

	const normalized = event.toolName?.toLowerCase().replace(/_/g, '') ?? ''
	const displayedToolName = Option.getOrUndefined(Schema.decodeUnknownOption(DisplayedToolName)(normalized))
	if (displayedToolName !== undefined) return TOOL_DISPLAY_LABELS[displayedToolName]

	const spaced = event.toolName?.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
	return spaced ? formatToolNameForDisplay(spaced) : 'Tool'
}
