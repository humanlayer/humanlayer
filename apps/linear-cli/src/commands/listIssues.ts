import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

export async function listIssues(linear: LinearClient | undefined) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		const user = await linear.viewer
		const issues = await user.assignedIssues({ first: 50 })

		console.log(chalk.bold('\nYour assigned issues:'))

		if (!issues.nodes.length) {
			console.log(chalk.yellow('No issues assigned to you.'))
			return
		}

		// Filter out completed and canceled issues
		const activeIssues = []

		for (const issue of issues.nodes) {
			const state = await issue.state
			// Skip issues that are completed, canceled, or done
			if (
				state &&
				(state.name.toLowerCase().includes('done') ||
					state.name.toLowerCase().includes('completed') ||
					state.name.toLowerCase().includes('canceled') ||
					state.name.toLowerCase().includes('cancelled'))
			) {
				continue
			}
			activeIssues.push(issue)
		}

		if (activeIssues.length === 0) {
			console.log(chalk.yellow('No active issues assigned to you.'))
			return
		}

		activeIssues.forEach((issue) => {
			console.log(`[${chalk.cyan(issue.identifier)}] ${issue.title}`)
		})

		// Show pagination info if there are more issues
		if (issues.pageInfo.hasNextPage) {
			console.log(chalk.dim('\nShowing first 50 active issues. There may be more issues available.'))
		}
	} catch (error) {
		console.error(chalk.red('Error fetching issues:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
