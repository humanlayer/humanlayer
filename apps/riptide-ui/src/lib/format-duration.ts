import { intervalToDuration } from 'date-fns'

const twoDigits = (value: number): string => String(value).padStart(2, '0')

/** `4s`, `3m 05s`, `1h 31m`: the widest unit and one below it, sized for a 200px sidebar. */
export const formatCompactDuration = (elapsedMs: number): string => {
	const {
		days = 0,
		hours = 0,
		minutes = 0,
		seconds = 0,
	} = intervalToDuration({
		start: 0,
		end: Math.max(0, elapsedMs),
	})
	const wholeHours = days * 24 + hours
	if (wholeHours > 0) return `${wholeHours}h ${twoDigits(minutes)}m`
	return minutes > 0 ? `${minutes}m ${twoDigits(seconds)}s` : `${seconds}s`
}
