/**
 * Format Linear ticket data as Markdown.
 * Server-side equivalent of riptide-ui/src/lib/format-linear-ticket.ts
 */

interface LinearComment {
	author: string
	body: string
	createdAt: string
}

interface LinearParent {
	identifier: string
	title: string
	status: string
	assignee: string | null
	description: string | null
	comments: LinearComment[]
}

export interface LinearIssue {
	identifier: string
	title: string
	url: string
	branch: string | null
	status: string
	assignee: string | null
	description: string | null
	comments: LinearComment[]
	parents: LinearParent[]
}

/**
 * Replace markdown image URLs with task-artifact code blocks.
 * Example: `![alt](https://uploads.linear.app/...)` becomes:
 * ```task-artifact
 * img-ENG-1234-screenshot.png
 * ```
 */
function replaceImageUrls(
	text: string,
	imageReplacements: Map<string, string>,
	failedImageUrls: ReadonlySet<string>,
): string {
	if (imageReplacements.size === 0 && failedImageUrls.size === 0) return text
	return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, _alt, url) => {
		const artifactFilename = imageReplacements.get(url)
		if (!artifactFilename) {
			return failedImageUrls.has(url) ? `[Image could not be imported: ${_alt || 'image'}](${url})` : match
		}
		return `\`\`\`task-artifact\n${artifactFilename}\n\`\`\``
	})
}

function formatIssueLines(
	issue: {
		identifier: string
		title: string
		branch?: string | null
		status: string
		assignee: string | null
		description: string | null
		comments: LinearComment[]
	},
	imageReplacements: Map<string, string>,
	failedImageUrls: ReadonlySet<string>,
): string[] {
	const lines: string[] = []

	lines.push(`[${issue.identifier}] ${issue.title}`)
	if (issue.branch) {
		lines.push(`Branch: ${issue.branch}`)
	}
	lines.push(`Status: ${issue.status}`)
	if (issue.assignee) {
		lines.push(`Assignee: ${issue.assignee}`)
	}

	if (issue.description) {
		lines.push('')
		lines.push('Description:')
		lines.push(replaceImageUrls(issue.description, imageReplacements, failedImageUrls))
	}

	if (issue.comments.length > 0) {
		lines.push('')
		lines.push('Comments:')
		for (const comment of issue.comments) {
			const date = new Date(comment.createdAt)
			const dateStr = date.toISOString().split('T')[0]
			const timeStr = date.toTimeString().split(' ')[0]
			lines.push(`[${dateStr} ${timeStr}] ${comment.author}:`)
			lines.push(replaceImageUrls(comment.body, imageReplacements, failedImageUrls))
			lines.push('')
		}
	}

	return lines
}

export function formatLinearTicketMd(
	issue: LinearIssue,
	imageReplacements?: Map<string, string>,
	failedImageUrls: ReadonlySet<string> = new Set(),
): string {
	const replacements = imageReplacements ?? new Map<string, string>()
	const lines: string[] = []

	lines.push(...formatIssueLines(issue, replacements, failedImageUrls))

	if (issue.parents.length > 0) {
		lines.push('')
		lines.push('═══════════════════════════════════════════════════════════════')
		lines.push('PARENT ISSUES:')
		lines.push('═══════════════════════════════════════════════════════════════')

		for (let i = 0; i < issue.parents.length; i++) {
			const parent = issue.parents[i]
			if (!parent) continue
			lines.push('')
			lines.push(`Parent Level ${i + 1}:`)
			lines.push(...formatIssueLines(parent, replacements, failedImageUrls))
		}
	}

	lines.push('')
	lines.push(`View in Linear: ${issue.url}`)

	return lines.join('\n')
}
