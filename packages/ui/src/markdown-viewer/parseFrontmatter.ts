import yaml from 'js-yaml'

/** Parse frontmatter from markdown content */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
	if (!match) return { data: {}, body: content }

	try {
		const parsed = yaml.load(match[1] ?? '')
		const data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
		return { data, body: match[2] ?? '' }
	} catch {
		return { data: {}, body: content }
	}
}
