import { eq, useLiveQuery } from '@tanstack/react-db'
import { formatDistanceToNowStrict } from 'date-fns'

import { useAgentProbes } from '@/components/onboarding/agent-setup/useAgentProbes'
import { useSync } from '@/components/providers/SyncProvider'
import { useLocalHostId } from '@/hooks/use-colocated'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'
import { isDesktop } from '@/lib/utils'

import { CheckButton } from './CheckButton'
import { lastCheckedAt } from './sign-in-status'
import { SignInHost, SignInHostHeader } from './SignInHost'
import { WiredLocalAgentRow } from './WiredLocalAgentRow'

const AGENTS: readonly CodingAgent[] = ['claude', 'codex']

function useLocalHost(localHostId: string | null) {
	const { onlineHostsCollection } = useSync()
	const hosts = useLiveQuery(
		(q) => {
			if (!localHostId) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.host_id, localHostId))
				.select(({ hosts }) => ({ hostName: hosts.host_name, status: hosts.status }))
		},
		[localHostId, onlineHostsCollection],
	)
	return hosts.data?.[0]
}

export function WiredThisComputerSignIn() {
	const localHostId = useLocalHostId()
	const host = useLocalHost(localHostId)
	const { connections, claudeProbe, codexProbe, isClaudeChecking, isCodexChecking, checkAgent } = useAgentProbes(
		() => {},
	)

	if (!isDesktop()) return null

	const checkedAt = lastCheckedAt(connections)
	const connectionFor = (agent: CodingAgent) => connections.find((connection) => connection.agent === agent)
	const probes = {
		claude: { isChecking: isClaudeChecking, error: claudeProbe.error },
		codex: { isChecking: isCodexChecking, error: codexProbe.error },
	}

	return (
		<SignInHost>
			<SignInHostHeader
				name={host?.hostName ?? 'This computer'}
				shortId={localHostId?.slice(0, 8) ?? null}
				online={host?.status === 'online'}
				isThisComputer
			>
				{checkedAt !== null ? (
					<span>checked {formatDistanceToNowStrict(checkedAt, { addSuffix: true })}</span>
				) : null}
				<CheckButton
					isChecking={isClaudeChecking || isCodexChecking}
					onClick={() => {
						for (const agent of AGENTS) checkAgent(agent, connectionFor(agent)?.path ?? null)
					}}
				>
					Check both
				</CheckButton>
			</SignInHostHeader>
			{AGENTS.map((agent) => (
				<WiredLocalAgentRow
					key={agent}
					agent={agent}
					localHostId={localHostId}
					connection={connectionFor(agent)}
					isChecking={probes[agent].isChecking}
					probeError={probes[agent].error instanceof Error ? probes[agent].error.message : null}
					onCheck={(path) => checkAgent(agent, path)}
				/>
			))}
		</SignInHost>
	)
}
