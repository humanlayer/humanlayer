import { format, isValid } from 'date-fns'

export type TimestampInput = Date | string | number | bigint | null | undefined

export function parseTimestamp(value: TimestampInput): Date | null {
	if (value == null || value === '') return null

	const date = value instanceof Date ? value : new Date(typeof value === 'bigint' ? Number(value) : value)
	return isValid(date) ? date : null
}

export function formatCompactRelativeTime(value: TimestampInput, now: Date = new Date()): string {
	const date = parseTimestamp(value)
	if (!date) return '-'

	const diffMs = Math.max(0, now.getTime() - date.getTime())
	const minuteMs = 60_000
	const hourMs = 60 * minuteMs
	const dayMs = 24 * hourMs
	const weekMs = 7 * dayMs

	if (diffMs < hourMs) return `${Math.max(1, Math.floor(diffMs / minuteMs))}m`
	if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h`
	if (diffMs < weekMs) return `${Math.floor(diffMs / dayMs)}d`
	return `${Math.floor(diffMs / weekMs)}w`
}

export function formatLocalAbsoluteTime(value: TimestampInput): string {
	const date = parseTimestamp(value)
	if (!date) return '-'
	return format(date, 'MMM d yyyy h:mmaaa').toLowerCase()
}
