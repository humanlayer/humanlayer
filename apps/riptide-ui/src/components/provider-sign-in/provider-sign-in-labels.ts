import type { ProviderLoginStatus } from '@humanlayer/db/tables/provider-login-requests'

import { DAEMON_CAPABILITY_CLI_VERSIONS } from '@/lib/daemon-version'

import type { ProviderSignInHost, ProviderSignInRequest } from './ProviderSignInCard'

// Only in-app sign-ins are recorded, so a host signed in from the terminal looks idle; idle claims nothing.
const STATUS_LABELS: Record<ProviderLoginStatus | 'idle', string | null> = {
	idle: null,
	requested: 'Starting',
	awaiting_approval: 'Waiting for you',
	succeeded: 'Signed in',
	failed: null,
	cancelled: null,
}

export function providerSignInStatusLabel(request: ProviderSignInRequest | null): string | null {
	return STATUS_LABELS[request?.status ?? 'idle']
}

export function hostBlockedMessage(host: Exclude<ProviderSignInHost, { state: 'ready' }>): string {
	if (host.state === 'offline') return 'Start the daemon on this host to sign in from here.'
	return `Update the HumanLayer CLI from ${host.daemonVersion} to ${DAEMON_CAPABILITY_CLI_VERSIONS.providerLogin} or later.`
}
