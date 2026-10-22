import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

interface CreateIssueOptions {
	title: string
	body: string
	team: string
	status?: string
}

export async function createIssue(linear: LinearClient | undefined, options: CreateIssueOptions) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		const { title, body: rawBody, team: teamKey } = options
		// Commander.js passes literal \n from shell args - convert to actual newlines
		const body = rawBody.replace(/\\n/g, '\n')

		// Resolve team - either by key or auto-infer
		let team

		if (teamKey) {
			// Team specified - resolve by key
			const normalizedKey = teamKey.toUpperCase()
			const teams = await linear.teams({ filter: { key: { eq: normalizedKey } } })
			team = teams.nodes[0]

			if (!team) {
				console.error(chalk.red(`Error: Team "${normalizedKey}" not found.`))
				process.exit(1)
			}
		} else {
			// No team specified - try to auto-infer
			const teams = await linear.teams()

			if (teams.nodes.length === 0) {
				console.error(chalk.red('Error: No teams available.'))
				process.exit(1)
			} else if (teams.nodes.length === 1) {
				// Auto-infer the only available team
				team = teams.nodes[0]
			} else {
				// Multiple teams - require explicit selection
				console.error(chalk.red('Error: Multiple teams available. Please specify a team with --team flag.'))
				console.log(chalk.yellow('\nAvailable teams:'))
				teams.nodes.forEach((t) => {
					console.log(`  - ${t.key}`)
				})
				process.exit(1)
			}
		}

		// Resolve status - default to "Triage" if not specified
		const statusName = options.status || 'Triage'
		const states = await team.states()
		const targetState = states.nodes.find((state) => state.name.toLowerCase() === statusName.toLowerCase())

		if (!targetState) {
			console.error(chalk.red(`Error: Status "${statusName}" not found for team ${team.name}.`))
			console.log(chalk.yellow('\nAvailable statuses:'))
			states.nodes.forEach((state) => {
				console.log(`  - ${state.name}`)
			})
			process.exit(1)
		}

		// Create the issue
		const result = await linear.issueCreate({
			teamId: team.id,
			title: title,
			description: body,
			stateId: targetState.id,
		})

		if (result.success) {
			const issue = await result.issue
			if (issue) {
				console.log(chalk.green(`✓ Created issue ${issue.identifier}`))
				console.log(chalk.dim(`  ${issue.url}`))
			}
		} else {
			console.error(chalk.red('Failed to create issue.'))
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error creating issue:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
