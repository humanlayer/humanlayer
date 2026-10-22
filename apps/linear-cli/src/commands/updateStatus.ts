import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

export async function updateStatus(linear: LinearClient | undefined, issueId: string, statusName: string) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		// Validate issue ID format
		if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
			console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123 or B2BPROD-206'))
			process.exit(1)
		}

		const normalizedId = issueId.toUpperCase()

		// First, fetch the issue to get its team
		const issue = await linear.issue(normalizedId)

		if (!issue) {
			console.error(chalk.red(`Issue ${normalizedId} not found.`))
			process.exit(1)
		}

		const team = await issue.team
		if (!team) {
			console.error(chalk.red(`Could not determine team for issue ${normalizedId}.`))
			process.exit(1)
		}

		// Fetch available states for the team
		const states = await team.states()

		// Find the state by name (case-insensitive)
		const targetState = states.nodes.find((state) => state.name.toLowerCase() === statusName.toLowerCase())

		if (!targetState) {
			console.error(chalk.red(`Status "${statusName}" not found for team ${team.name}.`))
			console.log(chalk.yellow('\nAvailable statuses:'))
			states.nodes.forEach((state) => {
				console.log(`  - ${state.name}`)
			})
			process.exit(1)
		}

		// Update the issue with the new state
		const result = await linear.issueUpdate(normalizedId, {
			stateId: targetState.id,
		})

		if (result.success) {
			console.log(chalk.green(`✓ Updated ${normalizedId} status to "${targetState.name}"`))
		} else {
			console.error(chalk.red(`Failed to update status for ${normalizedId}.`))
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error updating status:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
