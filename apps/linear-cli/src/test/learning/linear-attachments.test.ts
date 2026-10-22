import { LinearClient } from '@linear/sdk'
import { describe, expect, it } from 'vitest'

/**
 * Learning tests for Linear SDK attachment operations.
 *
 * These tests document the Linear SDK behavior for:
 * - Listing attachments on an issue
 * - Creating attachments (links)
 * - Checking for duplicate attachments
 */

describe.skipIf(!process.env.LINEAR_API_KEY)('Linear SDK attachments', () => {
	let linear: LinearClient

	it('lists attachments on an issue', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		// ENG-2600 is a test issue - let's see if it has attachments
		const issue = await linear.issue('ENG-2600')

		if (!issue) {
			throw new Error('Issue ENG-2600 not found')
		}

		const attachments = await issue.attachments()

		console.log(`\nFound ${attachments.nodes.length} attachments:`)
		for (const attachment of attachments.nodes) {
			console.log(`  - ${attachment.title}`)
			console.log(`    URL: ${attachment.url}`)
			console.log(`    ID: ${attachment.id}`)
		}

		// KEY FINDING: issue.attachments() returns a collection with .nodes array
		expect(attachments.nodes).toBeDefined()
		expect(Array.isArray(attachments.nodes)).toBe(true)

		if (attachments.nodes.length > 0) {
			const firstAttachment = attachments.nodes[0]!
			expect(firstAttachment.id).toBeDefined()
			expect(firstAttachment.url).toBeDefined()
			expect(firstAttachment.title).toBeDefined()
		}

		console.log('\nKEY FINDING: issue.attachments() works like issue.comments() and issue.labels()')
		console.log('KEY FINDING: Returns object with .nodes array containing attachment objects')
		console.log('KEY FINDING: Each attachment has id, url, title properties')
	})

	it('can check for existing attachment by URL before creating', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		const issue = await linear.issue('ENG-2600')
		if (!issue) {
			throw new Error('Issue ENG-2600 not found')
		}

		const attachments = await issue.attachments()
		const testUrl = 'https://example.com/test-link'

		// Check if URL already exists
		const existingAttachment = attachments.nodes.find((attachment) => attachment.url === testUrl)

		if (existingAttachment) {
			console.log(`\nAttachment already exists: ${existingAttachment.id}`)
			console.log(`  Title: ${existingAttachment.title}`)
			console.log(`  URL: ${existingAttachment.url}`)
		} else {
			console.log(`\nAttachment does not exist for URL: ${testUrl}`)
		}

		console.log('\nKEY FINDING: Can query attachments.nodes to check if URL already exists')
		console.log('KEY FINDING: This enables idempotent ensureLink() function')
	})
})
