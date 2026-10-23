import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

const ASSISTANT_AUTHOR_NAME = 'LinearLayer (claude)'
const TARGET_STATUS = 'ready-for-questions'

export async function glass(linear: LinearClient | undefined, issueId: string) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		// Validate issue ID format
		if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
			console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123'))
			process.exit(1)
		}

		const normalizedId = issueId.toUpperCase()
		console.log(chalk.blue(`\n🔮 Glassing ${normalizedId}...\n`))

		// Fetch the issue
		const issue = await linear.issue(normalizedId)
		if (!issue) {
			console.error(chalk.red(`Issue ${normalizedId} not found.`))
			process.exit(1)
		}

		// 1. Set status to "Ready for Questions"
		await setStatusToReadyForQuestions(linear, issue, normalizedId)

		// 2. Remove all comments made by Linear-Assistant (Claude)
		await removeAssistantComments(linear, issue)

		// 3. Remove all linked documents/attachments
		await removeAllAttachments(linear, issue)

		console.log(chalk.green(`\n✓ Successfully glassed ${normalizedId}`))
	} catch (error) {
		console.error(chalk.red('Error glassing issue:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

async function setStatusToReadyForQuestions(
	linear: LinearClient,
	issue: Awaited<ReturnType<LinearClient['issue']>>,
	normalizedId: string,
) {
	const team = await issue.team
	if (!team) {
		console.error(chalk.red(`Could not determine team for issue ${normalizedId}.`))
		process.exit(1)
	}

	const states = await team.states()
	const targetState = states.nodes.find((state) => state.name.toLowerCase() === TARGET_STATUS.toLowerCase())

	if (!targetState) {
		console.error(chalk.red(`Status "${TARGET_STATUS}" not found for team ${team.name}.`))
		console.log(chalk.yellow('\nAvailable statuses:'))
		states.nodes.forEach((state) => {
			console.log(`  - ${state.name}`)
		})
		process.exit(1)
	}

	const result = await linear.issueUpdate(normalizedId, {
		stateId: targetState.id,
	})

	if (result.success) {
		console.log(chalk.green(`  ✓ Set status to "${TARGET_STATUS}"`))
	} else {
		console.error(chalk.red(`  ✗ Failed to update status`))
	}
}

async function removeAssistantComments(linear: LinearClient, issue: Awaited<ReturnType<LinearClient['issue']>>) {
	const comments = await issue.comments()
	let deletedCount = 0

	console.log(chalk.dim(`  Checking ${comments.nodes.length} comment(s)...`))

	for (const comment of comments.nodes) {
		const user = await comment.user
		console.log(chalk.dim(`    - Comment by: "${user?.name}" (${user?.displayName})`))
		if (user?.name?.toLowerCase() === ASSISTANT_AUTHOR_NAME.toLowerCase()) {
			const result = await linear.commentDelete(comment.id)
			if (result.success) {
				deletedCount++
			}
		}
	}

	if (deletedCount > 0) {
		console.log(chalk.green(`  ✓ Deleted ${deletedCount} comment(s) from ${ASSISTANT_AUTHOR_NAME}`))
	} else {
		console.log(chalk.dim(`  - No comments from ${ASSISTANT_AUTHOR_NAME} found`))
	}
}

async function removeAllAttachments(linear: LinearClient, issue: Awaited<ReturnType<LinearClient['issue']>>) {
	const attachments = await issue.attachments()
	let deletedCount = 0

	for (const attachment of attachments.nodes) {
		const result = await linear.attachmentDelete(attachment.id)
		if (result.success) {
			deletedCount++
		}
	}

	if (deletedCount > 0) {
		console.log(chalk.green(`  ✓ Deleted ${deletedCount} attachment(s)`))
	} else {
		console.log(chalk.dim(`  - No attachments found`))
	}
}
