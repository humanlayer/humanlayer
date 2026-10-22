import type { IJiraService } from './jira-service'

export type JiraIssue = Awaited<ReturnType<IJiraService['getIssue']>>

export function formatJiraTicketMd(issue: JiraIssue): string {
	return [
		[`[${issue.key}] ${issue.summary}`, issue.status ? `Status: ${issue.status}` : null]
			.filter((line): line is string => line !== null)
			.join('\n'),
		issue.description ? `Description:\n${issue.description}` : null,
		`View in Jira: ${issue.url}`,
	]
		.filter((section): section is string => section !== null)
		.join('\n\n')
}
