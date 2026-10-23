import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

import { loadTokens, saveTokens, isTokenExpired, performOAuthFlow, refreshAccessToken } from '../auth'

/**
 * linear login command
 */
export async function login(): Promise<void> {
	// Check if already logged in
	const existingTokens = await loadTokens()
	if (existingTokens) {
		try {
			// Try to get workspace info to verify tokens work
			let accessToken = existingTokens.access_token

			// Refresh if expired
			if (isTokenExpired(existingTokens)) {
				console.log(chalk.dim('Refreshing expired token...'))
				const refreshed = await refreshAccessToken(existingTokens.refresh_token)
				await saveTokens(refreshed)
				accessToken = refreshed.access_token
			}

			const linear = new LinearClient({ accessToken })
			const viewer = await linear.viewer
			const org = await viewer.organization

			console.log(chalk.green('Already logged in!'))
			console.log(chalk.dim(`  User: ${viewer.name} (${viewer.email})`))
			console.log(chalk.dim(`  Workspace: ${org.name}`))
			console.log('')
			console.log(chalk.yellow('To log in with a different account, run: linear logout'))
			return
		} catch {
			// Tokens are invalid, proceed with new login
			console.log(chalk.dim('Existing tokens are invalid, starting new login...'))
		}
	}

	try {
		const tokens = await performOAuthFlow()
		await saveTokens(tokens)

		// Verify and show success
		const linear = new LinearClient({ accessToken: tokens.access_token })
		const viewer = await linear.viewer
		const org = await viewer.organization

		console.log('')
		console.log(chalk.green('Successfully logged in!'))
		console.log(chalk.dim(`  User: ${viewer.name} (${viewer.email})`))
		console.log(chalk.dim(`  Workspace: ${org.name}`))
	} catch (error) {
		console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
