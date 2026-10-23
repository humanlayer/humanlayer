import type { Issue, LinearClient } from '@linear/sdk'
import chalk from 'chalk'

import { resolveIssueId } from '../utils/git'

/**
 * Format a single issue as plain text lines
 */
async function formatIssueLines(issue: Issue, prefix = ''): Promise<string[]> {
	const comments = await issue.comments()
	const assignee = await issue.assignee
	const state = await issue.state

	const lines: string[] = []

	lines.push(`${prefix}[${issue.identifier}] ${issue.title}`)
	if (issue.branchName) {
		lines.push(`${prefix}Branch: ${issue.branchName}`)
	}
	lines.push(`${prefix}Status: ${state?.name || 'Unknown'}`)

	if (assignee) {
		lines.push(`${prefix}Assignee: ${assignee.name}`)
	}

	if (issue.description) {
		lines.push('')
		lines.push(`${prefix}Description:`)
		const descLines = issue.description.split('\n')
		for (const line of descLines) {
			lines.push(`${prefix}${line}`)
		}
	}

	if (comments.nodes.length > 0) {
		lines.push('')
		lines.push(`${prefix}Comments:`)

		const reversedComments = [...comments.nodes].reverse()

		for (const comment of reversedComments) {
			let commentUser
			try {
				commentUser = await comment.user
			} catch {
				commentUser = null
			}

			const commentDate = new Date(comment.createdAt)
			const dateStr = commentDate.toISOString().split('T')[0]
			const timeStr = commentDate.toTimeString().split(' ')[0]

			lines.push(`${prefix}[${dateStr} ${timeStr}] ${commentUser?.name || 'Unknown'}:`)
			const commentLines = comment.body.split('\n')
			for (const line of commentLines) {
				lines.push(`${prefix}${line}`)
			}
			lines.push('')
		}
	}

	return lines
}

/**
 * Fetch issue and return as plain text string, including parent issues
 */
export async function fetchIssueAsString(linear: LinearClient, issueId: string): Promise<string> {
	const issue = await linear.issue(issueId.toUpperCase())

	if (!issue) {
		throw new Error(`Issue ${issueId} not found.`)
	}

	const lines: string[] = []

	// Format main issue
	const mainIssueLines = await formatIssueLines(issue)
	lines.push(...mainIssueLines)

	// Fetch parent issues
	const parentIssues: Issue[] = []
	let currentIssue: Issue = issue

	while (true) {
		const parent = await currentIssue.parent
		if (!parent) break
		parentIssues.push(parent)
		currentIssue = parent
	}

	// Display parent issues in reverse order (oldest parent first)
	if (parentIssues.length > 0) {
		lines.push('')
		lines.push('═══════════════════════════════════════════════════════════════')
		lines.push('PARENT ISSUES:')
		lines.push('═══════════════════════════════════════════════════════════════')

		for (let i = parentIssues.length - 1; i >= 0; i--) {
			const parent = parentIssues[i]
			if (!parent) continue
			const levelPrefix = ''
			lines.push('')
			lines.push(`${levelPrefix}Parent Level ${parentIssues.length - i}:`)
			const parentLines = await formatIssueLines(parent, levelPrefix)
			lines.push(...parentLines)
		}
	}

	lines.push('')
	lines.push(`View in Linear: ${issue.url}`)

	return lines.join('\n')
}

export async function getIssue(linear: LinearClient | undefined, issueId?: string) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		const resolvedId = await resolveIssueId(issueId)
		const output = await fetchIssueAsString(linear, resolvedId)
		console.log(output)
	} catch (error) {
		console.error(chalk.red('Error fetching issue:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
