import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'

import { useSync } from '@/components/providers/SyncProvider'
import { useLocalHostId } from '@/hooks/use-colocated'
import { useInAppSignInProvider } from '@/hooks/useInAppSignIn'
import { isAttachedSessionsOnly } from '@/lib/daemon-version'

import { SignInHost } from './SignInHost'
import { WiredHostAgentSignInRow } from './WiredHostAgentSignInRow'
import { WiredHostSignInHeader } from './WiredHostSignInHeader'

export function WiredOtherHostsSignIn() {
	const claudeProvider = useInAppSignInProvider('claude')
	const codexProvider = useInAppSignInProvider('codex')
	const providers = [claudeProvider, codexProvider].filter((provider) => provider !== null)
	const localHostId = useLocalHostId()
	const { user } = useAuth()
	const { onlineHostsCollection } = useSync()
	// Online hosts sync for the whole org, so keep only the current user's hosts.
	const hosts = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.user_id, user.id))
				.select(({ hosts }) => ({
					hostId: hosts.host_id,
					hostName: hosts.host_name,
					status: hosts.status,
					capabilities: hosts.capabilities,
				}))
		},
		[onlineHostsCollection, user?.id],
	)
	const otherHosts = (hosts.data ?? [])
		// A pi host cannot run a sign-in.
		.filter((host) => host.hostId !== localHostId && !isAttachedSessionsOnly(host))
		.sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'))

	if (providers.length === 0 || otherHosts.length === 0) return null

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-baseline gap-x-3">
				<h2 className="text-xs uppercase tracking-wider text-foreground">
					{localHostId === null ? 'Hosts' : 'Other hosts'} · {otherHosts.length}
				</h2>
				<p className="text-xs text-muted-foreground">
					HumanLayer shows sign-ins started here. It cannot check these hosts yet.
				</p>
			</div>
			<div className="space-y-4">
				{otherHosts.map((host) => {
					const online = host.status === 'online'
					return (
						<SignInHost key={host.hostId} dimmed={!online}>
							<WiredHostSignInHeader hostId={host.hostId} hostName={host.hostName} online={online} />
							{online
								? providers.map((provider) => (
										<WiredHostAgentSignInRow
											key={provider}
											hostId={host.hostId}
											provider={provider}
										/>
									))
								: null}
						</SignInHost>
					)
				})}
			</div>
		</div>
	)
}
