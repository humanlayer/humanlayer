import { LinearClient } from '@linear/sdk'
import { describe, expect, it } from 'vitest'

/**
 * Learning tests for Linear SDK comment operations.
 *
 * These tests document the Linear SDK behavior for:
 * - Creating comments on an issue
 * - Deleting comments
 */

describe.skipIf(!process.env.LINEAR_API_KEY)('Linear SDK comments', () => {
	let linear: LinearClient

	it('can create and delete a comment', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		// Use a test issue - FAKE-1 doesn't exist, so let's use a real test issue
		// First, let's find a test issue we can use
		const testIssueId = 'LL-1' // Use a known test issue

		const issue = await linear.issue(testIssueId)
		if (!issue) {
			throw new Error(`Issue ${testIssueId} not found`)
		}

		console.log(`\nUsing issue: ${issue.identifier} - ${issue.title}`)

		// Create a test comment
		const testMessage = `[TEST] Learning test comment - ${new Date().toISOString()}`
		const createResult = await linear.commentCreate({
			issueId: issue.id,
			body: testMessage,
		})

		expect(createResult.success).toBe(true)
		const comment = await createResult.comment
		expect(comment).toBeDefined()

		console.log(`\nCreated comment:`)
		console.log(`  ID: ${comment?.id}`)
		console.log(`  Body: ${comment?.body}`)

		// KEY FINDING: commentCreate returns { success, comment } where comment is a promise
		console.log('\nKEY FINDING: linear.commentCreate() returns { success: boolean, comment: Promise<Comment> }')

		// Now delete the comment
		if (comment?.id) {
			// Try to find the delete method
			// The SDK follows a pattern: entityCreate, entityUpdate, entityDelete
			const deleteResult = await linear.commentDelete(comment.id)

			console.log(`\nDelete result:`)
			console.log(`  Success: ${deleteResult.success}`)

			expect(deleteResult.success).toBe(true)

			console.log('\nKEY FINDING: linear.commentDelete(commentId) deletes a comment')
			console.log('KEY FINDING: Returns { success: boolean }')
		}
	})

	it('lists comments on an issue and shows their IDs', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		const testIssueId = 'LL-1'
		const issue = await linear.issue(testIssueId)

		if (!issue) {
			throw new Error(`Issue ${testIssueId} not found`)
		}

		const comments = await issue.comments()

		console.log(`\nFound ${comments.nodes.length} comments on ${testIssueId}:`)
		for (const comment of comments.nodes.slice(0, 5)) {
			const user = await comment.user
			console.log(`  - ID: ${comment.id}`)
			console.log(`    Author: ${user?.name || 'Unknown'}`)
			console.log(`    Body preview: ${comment.body.substring(0, 50)}...`)
			console.log('')
		}

		console.log('\nKEY FINDING: issue.comments() returns { nodes: Comment[] }')
		console.log('KEY FINDING: Each comment has id, body, user (Promise), createdAt properties')
	})
})
