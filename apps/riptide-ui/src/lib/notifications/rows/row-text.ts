import type { NotificationSession } from '../notification-sources'

const DETAIL_MAX_LENGTH = 160

export const toMillis = (value: bigint | number | string): number => Number(value)

export function firstLine(text: string): string {
	const line = text.trim().split('\n')[0] ?? ''
	return line.length > DETAIL_MAX_LENGTH ? `${line.slice(0, DETAIL_MAX_LENGTH - 1)}…` : line
}

export function sessionName(session: NotificationSession): string {
	return session.title || session.summary || 'Untitled session'
}
