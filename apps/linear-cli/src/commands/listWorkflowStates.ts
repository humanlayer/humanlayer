import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

interface ListWorkflowStatesOptions {
	outputFormat?: 'markdown' | 'json'
}

export async function listWorkflowStates(
	linear: LinearClient | undefined,
	teamKey: string,
	options: ListWorkflowStatesOptions = {},
) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		const normalizedKey = teamKey.toUpperCase()

		// Fetch the team by key
		const teams = await linear.teams({ filter: { key: { eq: normalizedKey } } })
		const team = teams.nodes[0]

		if (!team) {
			console.error(chalk.red(`Team "${normalizedKey}" not found.`))
			process.exit(1)
		}

		// Fetch workflow states for the team
		const states = await team.states()

		if (options.outputFormat === 'json') {
			const output = states.nodes.map((state) => ({
				id: state.id,
				name: state.name,
				type: state.type,
				position: state.position,
				color: state.color,
			}))
			console.log(JSON.stringify(output, null, 2))
			return
		}

		// Default: markdown output
		console.log(chalk.bold(`\nWorkflow states for team ${team.name} (${team.key}):\n`))

		// Group by type
		const groupedStates: Record<string, typeof states.nodes> = {}
		for (const state of states.nodes) {
			const type = state.type || 'other'
			if (!groupedStates[type]) {
				groupedStates[type] = []
			}
			groupedStates[type].push(state)
		}

		// Sort each group by position
		for (const type of Object.keys(groupedStates)) {
			groupedStates[type]?.sort((a, b) => a.position - b.position)
		}

		// Display order
		const typeOrder = ['backlog', 'unstarted', 'started', 'completed', 'canceled', 'other']

		for (const type of typeOrder) {
			const typeStates = groupedStates[type]
			if (!typeStates || typeStates.length === 0) continue

			console.log(chalk.dim(`[${type}]`))
			for (const state of typeStates) {
				console.log(`  - ${state.name}`)
			}
			console.log()
		}
	} catch (error) {
		console.error(
			chalk.red('Error fetching workflow states:'),
			error instanceof Error ? error.message : String(error),
		)
		process.exit(1)
	}
}
