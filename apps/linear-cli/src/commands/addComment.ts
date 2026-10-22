import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

import { resolveIssueId } from '../utils/git'

export async function addComment(linear: LinearClient | undefined, message: string, options: { issueId?: string }) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		// Ensure we have a message
		if (!message || message.trim() === '') {
			console.error(chalk.red('Error: Message required'))
			process.exit(1)
		}

		// Try to get issue ID from options or git branch, with interactive fallback
		const issueId = await resolveIssueId(options.issueId)

		// Create comment
		const result = await linear.commentCreate({
			issueId,
			body: message,
		})

		if (result.success) {
			console.log(chalk.green(`Comment added to issue ${issueId}!`))
		} else {
			console.error(chalk.red('Failed to add comment.'))
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error adding comment:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
