import type { LinearClient } from '@linear/sdk'

export async function updateIssueStatus(linear: LinearClient, issueId: string, statusName: string): Promise<void> {
	// Validate issue ID format
	if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
		throw new Error(`Invalid issue ID format: ${issueId}. Expected format: ENG-123 or B2BPROD-206`)
	}

	const normalizedId = issueId.toUpperCase()
	const issue = await linear.issue(normalizedId)

	if (!issue) {
		throw new Error(`Issue ${normalizedId} not found.`)
	}

	const team = await issue.team
	if (!team) {
		throw new Error(`Could not determine team for issue ${normalizedId}.`)
	}

	const states = await team.states()
	const targetState = states.nodes.find((state) => state.name.toLowerCase() === statusName.toLowerCase())

	if (!targetState) {
		const availableStatuses = states.nodes.map((s) => s.name).join(', ')
		throw new Error(`Status "${statusName}" not found for team ${team.name}. Available: ${availableStatuses}`)
	}

	const result = await linear.issueUpdate(normalizedId, {
		stateId: targetState.id,
	})

	if (!result.success) {
		throw new Error(`Failed to update status for ${normalizedId}.`)
	}
}
