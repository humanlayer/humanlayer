import { URL } from 'url'

import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

export interface EnsureLinkResult {
	created: boolean
	skipped: boolean
	attachmentId?: string
	error?: string
}

/**
 * Idempotently ensure a link attachment exists on a Linear issue.
 * If the URL already exists as an attachment, skip creation.
 * Returns { created: true } if created, { skipped: true } if already exists.
 */
export async function ensureLinkToIssue(
	linear: LinearClient,
	issueId: string,
	url: string,
	options: { title?: string },
): Promise<EnsureLinkResult> {
	// Validate URL
	try {
		new URL(url)
	} catch {
		return { created: false, skipped: false, error: 'Invalid URL format' }
	}

	const normalizedId = issueId.toUpperCase()

	let issue
	try {
		issue = await linear.issue(normalizedId)
	} catch (error) {
		return {
			created: false,
			skipped: false,
			error: `Issue ${normalizedId} not found: ${error instanceof Error ? error.message : String(error)}`,
		}
	}

	if (!issue) {
		return { created: false, skipped: false, error: `Issue ${normalizedId} not found` }
	}

	// Check for existing attachment with same URL
	const attachments = await issue.attachments()
	const existingAttachment = attachments.nodes.find((attachment) => attachment.url === url)

	if (existingAttachment) {
		return { created: false, skipped: true, attachmentId: existingAttachment.id }
	}

	// Create new attachment
	try {
		const result = await linear.attachmentCreate({
			issueId: issue.id,
			url: url,
			title: options.title || url,
		})

		if (result.success) {
			const attachment = await result.attachment
			return { created: true, skipped: false, attachmentId: attachment?.id }
		} else {
			return { created: false, skipped: false, error: 'Attachment creation returned false' }
		}
	} catch (error) {
		return {
			created: false,
			skipped: false,
			error: `Failed to create attachment: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * CLI command version of ensureLink with console output
 */
export async function ensureLink(
	linear: LinearClient | undefined,
	issueId: string,
	url: string,
	options: { title?: string },
): Promise<void> {
	if (!linear) {
		console.error(chalk.red('Error: Linear client not initialized. Check your API key.'))
		process.exit(1)
	}

	// Validate issue ID format
	if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
		console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123 or B2BPROD-206'))
		process.exit(1)
	}

	const result = await ensureLinkToIssue(linear, issueId, url, options)

	if (result.error) {
		console.error(chalk.red(`Error: ${result.error}`))
		process.exit(1)
	}

	if (result.skipped) {
		console.log(chalk.yellow(`⊘ Link already exists on ${issueId.toUpperCase()}`))
		console.log(chalk.dim(`  URL: ${url}`))
	} else if (result.created) {
		console.log(chalk.green(`✓ Added link to issue ${issueId.toUpperCase()}`))
		if (options.title) {
			console.log(chalk.dim(`  Title: ${options.title}`))
		}
		console.log(chalk.dim(`  URL: ${url}`))
	}
}
