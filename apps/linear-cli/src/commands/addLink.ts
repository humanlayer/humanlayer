import { URL } from 'url'

import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

// Programmatic version for use as a library
export async function addLinkToIssue(
	linear: LinearClient,
	issueId: string,
	url: string,
	options: { title?: string },
): Promise<void> {
	// Validate URL
	try {
		new URL(url)
	} catch {
		throw new Error('Invalid URL format')
	}

	const normalizedId = issueId.toUpperCase()
	const issue = await linear.issue(normalizedId)

	if (!issue) {
		throw new Error(`Issue ${normalizedId} not found.`)
	}

	const result = await linear.attachmentCreate({
		issueId: issue.id,
		url: url,
		title: options.title || url,
	})

	if (!result.success) {
		throw new Error(`Failed to add link to ${normalizedId}.`)
	}
}

// CLI version (existing)
export async function addLink(
	linear: LinearClient | undefined,
	issueId: string,
	url: string,
	options: { title?: string },
) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		// Validate issue ID format
		if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
			console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123 or B2BPROD-206'))
			process.exit(1)
		}

		// Validate URL
		if (!url) {
			console.error(chalk.red('Error: URL is required'))
			process.exit(1)
		}

		try {
			new URL(url)
		} catch {
			console.error(chalk.red('Error: Invalid URL format'))
			process.exit(1)
		}

		const normalizedId = issueId.toUpperCase()

		// First, fetch the issue to verify it exists
		const issue = await linear.issue(normalizedId)

		if (!issue) {
			console.error(chalk.red(`Issue ${normalizedId} not found.`))
			process.exit(1)
		}

		// Create the attachment (link)
		const result = await linear.attachmentCreate({
			issueId: issue.id,
			url: url,
			title: options.title || url,
		})

		if (result.success) {
			console.log(chalk.green(`✓ Added link to issue ${normalizedId}`))
			if (options.title) {
				console.log(chalk.dim(`  Title: ${options.title}`))
			}
			console.log(chalk.dim(`  URL: ${url}`))
		} else {
			console.error(chalk.red(`Failed to add link to ${normalizedId}.`))
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error adding link:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
