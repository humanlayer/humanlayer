import type { Session } from '@humanlayer/db/tables/sessions'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

export type HandoffSession = Pick<Session, 'coding_agent' | 'provider' | 'status' | 'archived'>

export type HandoffTarget = Extract<CodingAgent, 'claude' | 'codelayer'>

export function handoffTarget(session: HandoffSession): HandoffTarget | null {
	if (session.coding_agent === 'claude') return 'codelayer'
	if (session.coding_agent === 'codelayer' && session.provider === 'codex') return 'claude'
	return null
}

export function handoffBlockedReason(session: HandoffSession, owner: boolean, offline: boolean): string | null {
	if (!owner) return 'Only the session owner can hand off.'
	if (session.archived) return 'Unarchive the session to hand off.'
	if (!handoffTarget(session)) return 'This session does not support handing off.'
	if (offline) return 'Connect the host to hand off.'
	if (session.status !== 'ready_for_input' && session.status !== 'interrupted')
		return 'Interrupt the session or wait for input before handing off.'
	return null
}

export function handoffTitle(sourceTitle: string | null, targetLabel: string): string | null {
	if (!sourceTitle) return null
	return `${sourceTitle} (${targetLabel})`
}
