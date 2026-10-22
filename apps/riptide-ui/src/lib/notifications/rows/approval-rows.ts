import type { NotificationRow } from '../notification-row'
import type { RowContext } from './row-context'
import { firstLine, sessionName, toMillis } from './row-text'

export function approvalRows(context: RowContext): NotificationRow[] {
	const rows: NotificationRow[] = []
	for (const approval of context.sources.approvals) {
		if (approval.status !== 'pending') continue
		const session = context.session(approval.session_id)
		if (!session || session.created_by !== context.userId || session.archived) continue
		const toolName = approval.tool_name ? formatToolName(approval.tool_name) : 'a tool'
		const input = describeToolInput(approval.tool_input)
		rows.push({
			key: `approval:${approval.id}`,
			kind: 'approval',
			at: toMillis(approval.created_at),
			actors: [{ agent: true }],
			count: 1,
			subject: sessionName(session),
			taskName: context.taskName(session.task_id),
			detail: input ? `${toolName} · ${input}` : toolName,
			destination: { kind: 'session', sessionId: session.id },
			dismissible: false,
		})
	}
	return rows
}

function formatToolName(toolName: string): string {
	if (!toolName.startsWith('mcp__')) return toolName
	const parts = toolName.split('__')
	return parts.length >= 3 ? `${parts[1]}:${parts.slice(2).join('__')}` : toolName
}

function describeToolInput(input: unknown): string | null {
	if (input === null || input === undefined) return null
	if (typeof input === 'object' && 'command' in input && typeof input.command === 'string') {
		return firstLine(input.command)
	}
	if (typeof input === 'object' && 'file_path' in input && typeof input.file_path === 'string') {
		return input.file_path
	}
	return firstLine(JSON.stringify(input))
}
