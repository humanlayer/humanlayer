import type { LinearClient } from '@linear/sdk'

export async function createIssueComment(linear: LinearClient, issueId: string, body: string): Promise<void> {
	if (!body || body.trim() === '') {
		throw new Error('Comment body cannot be empty.')
	}

	// Validate issue ID format
	if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
		throw new Error(`Invalid issue ID format: ${issueId}. Expected format: ENG-123 or B2BPROD-206`)
	}

	const normalizedId = issueId.toUpperCase()

	const result = await linear.commentCreate({
		issueId: normalizedId,
		body,
	})

	if (!result.success) {
		throw new Error(`Failed to create comment on ${normalizedId}.`)
	}
}
