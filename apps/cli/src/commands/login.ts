import { performDeviceAuth } from '../auth'
import { saveSession, type WorkOSSession } from '../auth/storage'
import type { EnvironmentConfig, EnvironmentName } from '../lib/macros'
import { createApiORPCClient } from '../orpc/client'

export async function loginCommand(envName: EnvironmentName, envConfig: EnvironmentConfig): Promise<void> {
	try {
		// Step 1: Device auth does not require WorkOS redirect URI setup.
		const session = await performDeviceAuth(envName, envConfig)
		const apiClient = createApiORPCClient(envConfig.apiOrigin, session.access_token)

		// Step 2: List user's organizations
		const { organizations, activeOrganizationId } = await apiClient.auth.user.organizations.list({})

		if (organizations.length === 0) {
			console.error('No organizations found for this account.')
			process.exit(1)
		}

		// Step 3: Determine target org
		let targetOrgId: string

		if (organizations.length === 1) {
			const org = organizations[0]
			if (!org) throw new Error('Organization list is unexpectedly empty')
			targetOrgId = org.organizationId
			console.log(`  Organization: ${org.organizationName}`)
		} else {
			// Multi-org user — prompt for selection
			console.log('  Select an organization:')
			console.log()
			for (let i = 0; i < organizations.length; i++) {
				const org = organizations[i]
				if (!org) continue
				const marker = org.organizationId === activeOrganizationId ? ' (current)' : ''
				console.log(`    ${i + 1}. ${org.organizationName}${marker}`)
			}
			console.log()

			const selection = await promptNumber('  Enter number: ', 1, organizations.length)
			const selected = organizations[selection - 1]
			if (!selected) throw new Error('Selected organization is out of range')
			targetOrgId = selected.organizationId
			console.log()
			console.log(`  Selected: ${selected.organizationName}`)
		}

		// Step 4: If the JWT is already scoped to the right org, we're done
		if (targetOrgId === activeOrganizationId) {
			console.log('  Login successful.')
			process.exit(0)
		}

		// Step 5: Refresh token with selected org to get an org-scoped JWT
		console.log('  Switching organization...')
		const refreshed = await apiClient.auth.token.refresh({
			refreshToken: session.refresh_token,
			organizationId: targetOrgId,
		})

		// Save the org-scoped session
		const updatedSession: WorkOSSession = {
			access_token: refreshed.accessToken,
			refresh_token: refreshed.refreshToken,
			expires_at: Date.now() + 60 * 60 * 1000,
			user_id: session.user_id,
			organization_id: targetOrgId,
		}
		await saveSession(envName, updatedSession)

		console.log('  Login successful.')
		process.exit(0)
	} catch (error) {
		console.error(`Login failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}

async function promptNumber(message: string, min: number, max: number): Promise<number> {
	while (true) {
		process.stdout.write(message)
		const line = await new Promise<string | null>((resolve) => {
			process.stdin.once('data', (data) => resolve(data.toString().trim()))
			process.stdin.once('end', () => resolve(null))
		})
		if (line === null) throw new Error('Input stream closed')
		const num = Number.parseInt(line, 10)
		if (!Number.isNaN(num) && num >= min && num <= max) {
			return num
		}
		console.log(`  Please enter a number between ${min} and ${max}.`)
	}
}
