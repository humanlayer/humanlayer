import chalk from 'chalk'

import { loadTokens, clearTokens } from '../auth'

const REVOKE_URL = 'https://api.linear.app/oauth/revoke'

/**
 * linear logout command
 */
export async function logout(): Promise<void> {
	const tokens = await loadTokens()

	if (!tokens) {
		console.log(chalk.dim('Not logged in.'))
		return
	}

	// Try to revoke the token (best effort)
	try {
		const response = await fetch(REVOKE_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Bearer ${tokens.access_token}`,
			},
		})

		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error(`[auth] Token revocation response: ${response.status}`)
		}
	} catch (error) {
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Token revocation failed:', error)
		}
		// Continue with local cleanup even if revocation fails
	}

	// Clear local credentials
	await clearTokens()

	console.log(chalk.green('Successfully logged out.'))
	console.log(chalk.dim('Credentials have been removed.'))
}
