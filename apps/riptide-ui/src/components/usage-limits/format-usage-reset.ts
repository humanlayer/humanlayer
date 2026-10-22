import { differenceInCalendarDays, format } from 'date-fns'

const WEEKDAY_NAME_IS_UNAMBIGUOUS_WITHIN_DAYS = 6

export function formatUsageReset(resetsAt: number | null | undefined, now: number = Date.now()): string | null {
	if (resetsAt == null) return null
	const reset = new Date(resetsAt)
	const daysAhead = differenceInCalendarDays(reset, new Date(now))
	if (daysAhead === 0) return format(reset, 'h:mm aaa')
	if (daysAhead < WEEKDAY_NAME_IS_UNAMBIGUOUS_WITHIN_DAYS) return format(reset, 'EEE h:mm aaa')
	return format(reset, 'd MMM h:mm aaa')
}

export function formatUsagePercent(usedPercent: number): string {
	return `${Math.min(999, Math.round(usedPercent))}%`
}
