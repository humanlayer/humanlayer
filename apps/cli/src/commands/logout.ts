import { clearSession } from '../auth/storage'
import type { EnvironmentName } from '../lib/macros'

export async function logoutCommand(envName: EnvironmentName): Promise<void> {
	await clearSession(envName)
	console.log(`Logged out of ${envName}. Stored credentials cleared.`)
}
