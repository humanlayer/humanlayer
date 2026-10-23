import type { GitHubImageImportOutcome } from './github.images'
import type { GitHubIssuePreview } from './github.issue-import'

const inlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const metadataList = (values: ReadonlyArray<string>): string =>
	values.length > 0 ? values.map(inlineText).join(', ') : 'None'

const commentAuthor = (authorLogin: string | null): string =>
	authorLogin === null ? 'unknown GitHub user' : inlineText(authorLogin)

const renderImageOutcomes = (text: string, imageOutcomes: ReadonlyArray<GitHubImageImportOutcome>): string => {
	const outcomes = new Map(imageOutcomes.map((outcome) => [outcome.sourceUrl, outcome]))
	return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (original, altText: string, sourceUrl: string) => {
		const outcome = outcomes.get(sourceUrl)
		if (!outcome) return original
		if (outcome.artifact) {
			const fileName = outcome.artifact.fileName
			if (fileName.includes('/') || fileName.includes('..') || fileName === 'ticket.md') {
				return `[Image could not be imported: ${altText || 'image'}](${sourceUrl})`
			}
			return `\`\`\`task-artifact\n${fileName}\n\`\`\``
		}
		return `[Image could not be imported: ${altText || 'image'}](${sourceUrl})`
	})
}

export const formatGitHubTicketMarkdown = (
	issue: GitHubIssuePreview,
	canonicalUrl: string,
	imageOutcomes: ReadonlyArray<GitHubImageImportOutcome> = [],
): string => {
	const comments =
		issue.comments.length === 0
			? 'None'
			: issue.comments
					.map(
						(comment) =>
							`[${comment.createdAt}] ${commentAuthor(comment.authorLogin)}:\n${renderImageOutcomes(comment.body || '(empty comment)', imageOutcomes)}`,
					)
					.join('\n\n')

	return [
		`[#${issue.issueNumber}] ${inlineText(issue.title)}`,
		`State: ${issue.state}`,
		`Labels: ${metadataList(issue.labels)}`,
		`Assignees: ${metadataList(issue.assignees)}`,
		'',
		'Description:',
		renderImageOutcomes(issue.body || '(no description)', imageOutcomes),
		'',
		'Comments:',
		comments,
		'',
		`View on GitHub: ${canonicalUrl}`,
		'',
	].join('\n')
}
