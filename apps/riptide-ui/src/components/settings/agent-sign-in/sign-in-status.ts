import type { ProviderSignInRequest } from '@/components/provider-sign-in/ProviderSignInCard'
import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'
import { isSignInActive } from '@/hooks/useProviderSignIn'

import type { SignInStatusTone } from './SignInHost'

export function checkStatusTone(isReady: boolean, isFailed: boolean, isChecking: boolean): SignInStatusTone {
	if (isChecking) return 'active'
	if (isReady) return 'ready'
	return isFailed ? 'failed' : 'idle'
}

export function signInStatusTone(request: ProviderSignInRequest | null, isSignedIn: boolean): SignInStatusTone {
	if (isSignedIn) return 'ready'
	return isSignInActive(request) ? 'active' : 'idle'
}

export function lastCheckedAt(connections: readonly AgentConnection[]): number | null {
	const checked = connections.flatMap((connection) => (connection.checkedAt === null ? [] : [connection.checkedAt]))
	return checked.length > 0 ? Math.max(...checked) : null
}
