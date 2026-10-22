import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'

import type { TableSession } from '@/components/session-table/types'

/**
 * Safely converts a BigInt timestamp (from Electric SQL) to a number.
 * Electric SQL returns bigint columns as JavaScript BigInt, but we need numbers
 * for Date operations. This is safe because Unix epoch milliseconds (~13 digits)
 * are well within Number.MAX_SAFE_INTEGER (9 quadrillion).
 */
export function bigintToNumber(value: bigint | number | string | Date | null | undefined): number | undefined {
	if (value === null || value === undefined) return undefined
	if (typeof value === 'bigint') return Number(value)
	if (typeof value === 'number') return value
	if (typeof value === 'string') return new Date(value).getTime()
	if (value instanceof Date) return value.getTime()
	return undefined
}

/**
 * Converts a bigint/number timestamp to an ISO string for UI display.
 */
export function timestampToISOString(value: bigint | number | string | Date | null | undefined): string | undefined {
	const num = bigintToNumber(value)
	if (num === undefined) return undefined
	return new Date(num).toISOString()
}

/**
 * The session shape from Electric SQL sync with LEFT JOIN to tasks.
 * Note: Electric returns `status: string` instead of the narrowed SessionStatus type from DB.
 * Timestamps come as bigint (Unix epoch milliseconds) from Electric SQL.
 */
export interface ElectricSession {
	id: string
	status: string
	title: string | null
	summary: string | null
	prompt: string | null
	model: string | null
	working_directory: string
	created_at: bigint | number | null
	last_activity_at: bigint | number | null
	archived: boolean
	permissions_mode: string
	task_id: string | null
	labels?: SessionLabel[] | null
	resource_owner_user_id?: string
	created_by?: string
	coding_agent?: CodingAgent | null
	provider?: string | null
	/** Task name from LEFT JOIN with tasks table */
	taskName?: string | null
}

/**
 * Transforms a DB Session to a UI TableSession
 */
export function toTableSession(session: ElectricSession): TableSession {
	return {
		id: session.id,
		title: session.title ?? undefined,
		summary: session.summary ?? undefined,
		query: session.prompt ?? undefined,
		model: session.model ?? undefined,
		status: session.status as TableSession['status'],
		workingDirectory: session.working_directory,
		createdAt: timestampToISOString(session.created_at),
		lastActivityAt: timestampToISOString(session.last_activity_at),
		archived: session.archived,
		isDraft: session.status === 'draft',
		dangerouslySkipPermissions: session.permissions_mode === 'bypass',
		autoAcceptEdits: session.permissions_mode === 'accept_edits',
		taskId: session.task_id ?? undefined,
		taskName: session.taskName ?? undefined,
		labels: session.labels ?? undefined,
		resourceOwnerUserId: session.resource_owner_user_id,
		createdByUserId: session.created_by,
		codingAgent: session.coding_agent ?? undefined,
		provider: session.provider ?? undefined,
	}
}
