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
