export const TASK_SLUG_MAX_LENGTH = 100

export function truncateTaskSlug(slug: string): string {
	return slug.slice(0, TASK_SLUG_MAX_LENGTH).replace(/-+$/g, '')
}

export function generateTaskSlug(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')

	return truncateTaskSlug(slug)
}

/**
 * Builds `${prefix}${slug}` where the total length is capped at
 * `TASK_SLUG_MAX_LENGTH`. The prefix is kept as is and the slug body is
 * truncated to fit. When nothing remains after truncation the trailing
 * separator on the prefix is stripped so the result is never `prefix-`.
 */
export function generatePrefixedTaskSlug(prefix: string, name: string): string {
	const available = Math.max(0, TASK_SLUG_MAX_LENGTH - prefix.length)
	const body = generateTaskSlug(name).slice(0, available).replace(/-+$/, '')
	const result = body ? `${prefix}${body}` : prefix.replace(/-+$/, '')
	return truncateTaskSlug(result)
}
