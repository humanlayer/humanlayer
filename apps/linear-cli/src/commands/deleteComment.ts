import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

export async function deleteComment(linear: LinearClient | undefined, commentId: string) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		if (!commentId || commentId.trim() === '') {
			console.error(chalk.red('Error: Comment ID required'))
			process.exit(1)
		}

		const result = await linear.commentDelete(commentId)

		if (result.success) {
			console.log(chalk.green(`Comment ${commentId} deleted!`))
		} else {
			console.error(chalk.red('Failed to delete comment.'))
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error deleting comment:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
