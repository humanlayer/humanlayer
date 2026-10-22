import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns'

// Standard date parsing - handles both Date objects and ISO strings
function parseDate(date: Date | string): Date {
	if (typeof date === 'string') {
		return parseISO(date)
	}
	return date
}

export function formatTimestamp(date: Date | string): string {
	const d = parseDate(date)
	if (!isValid(d)) return 'Invalid date'

	// Clamp future dates to now to handle clock skew between server and client
	const now = new Date()
	const clamped = d.getTime() > now.getTime() ? now : d

	// Use date-fns for relative time formatting
	let distance = formatDistanceToNow(clamped, { addSuffix: true })

	// Replace "less than a minute ago" with "<1 minute ago"
	if (distance === 'less than a minute ago') {
		distance = '<1 minute ago'
	}

	// Replace "about X hours ago" with "~X hours ago"
	distance = distance.replace(/^about (\d+ hours? ago)/, '~$1')

	// For dates older than 7 days, show actual date
	const daysDiff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
	if (daysDiff > 7) {
		return format(d, 'MMM d, yyyy')
	}

	return distance
}
