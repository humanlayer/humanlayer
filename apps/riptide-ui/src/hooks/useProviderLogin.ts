import type { ProviderLoginProvider } from '@humanlayer/db/tables/provider-login-requests'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useState } from 'react'
import { toast } from 'sonner'

import type { ProviderSignInHost } from '@/components/provider-sign-in/ProviderSignInCard'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { type DaemonCapabilityFields, daemonSupports } from '@/lib/daemon-version'
import { useRiptideApi } from '@/orpc/client'
import { latestProviderLogins } from '@/services/coding-agent-auth'

export type { ProviderLoginRow } from '@/services/coding-agent-auth'

function hostReadiness(
	host: (DaemonCapabilityFields & { status: 'online' | 'offline' }) | undefined,
): ProviderSignInHost {
	if (!host || host.status !== 'online') return { state: 'offline' }
	if (host.daemon_version && daemonSupports(host, 'providerLogin') === 'unsupported') {
		return { state: 'outdated', daemonVersion: host.daemon_version }
	}
	return { state: 'ready' }
}

/** Sign-in requests for one host, keyed by provider, plus the actions that drive them. */
export function useProviderLogin(hostId: string | null) {
	const { client } = useRiptideApi()
	const { providerLoginRequestsCollection, onlineHostsCollection } = useSync()
	const { confirmTx } = useSyncInternal()

	const hosts = useLiveQuery(
		(q) => {
			if (!hostId) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.host_id, hostId))
				.select(({ hosts }) => ({
					status: hosts.status,
					daemon_version: hosts.daemon_version,
					distribution: hosts.distribution,
					capabilities: hosts.capabilities,
				}))
		},
		[hostId, onlineHostsCollection],
	)
	const host = hostReadiness(hosts.data?.[0])

	const rows = useLiveQuery(
		(q) => {
			if (!hostId) return undefined
			return q
				.from({ requests: providerLoginRequestsCollection })
				.where(({ requests }) => eq(requests.host_id, hostId))
		},
		[hostId, providerLoginRequestsCollection],
	)
	const latest = latestProviderLogins(rows.data ?? [], hostId)
	const [isStarting, setIsStarting] = useState(false)

	// These write through the daemon request row and reconcile via Electric (confirmTx),
	// not a react-query cache, so there is nothing to invalidate.
	const start = async (provider: ProviderLoginProvider) => {
		if (!hostId) return
		setIsStarting(true)
		try {
			const result = await client.providerLogin.create({ hostId, provider })
			await confirmTx.providerLoginRequests(result.transactionId)
		} catch (error) {
			toast.error('Could not start the sign-in', { description: (error as Error).message })
		} finally {
			setIsStarting(false)
		}
	}
	const cancel = async (requestId: string) => {
		try {
			const result = await client.providerLogin.cancel({ requestId })
			await confirmTx.providerLoginRequests(result.transactionId)
		} catch (error) {
			toast.error('Could not cancel the sign-in', { description: (error as Error).message })
		}
	}
	const submitCode = async (requestId: string, code: string) => {
		try {
			const result = await client.providerLogin.submitCode({ requestId, code })
			await confirmTx.providerLoginRequests(result.transactionId)
		} catch (error) {
			toast.error('Could not send the code', { description: (error as Error).message })
		}
	}

	return {
		host,
		latest,
		start: (provider: ProviderLoginProvider) => void start(provider),
		cancel: (requestId: string) => void cancel(requestId),
		submitCode: (requestId: string, code: string) => void submitCode(requestId, code),
		isStarting,
	}
}
