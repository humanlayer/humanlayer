import { AGENT_LABELS, agentPanelStatus } from '@/components/onboarding/agent-setup/agent-status'
import { AgentReadyDetails } from '@/components/onboarding/agent-setup/AgentReadyDetails'
import { type AgentConnection, useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'

import { checkStatusTone } from './sign-in-status'
import { SignInRowStatus } from './SignInHost'

type ReadyConnection = Extract<AgentConnection, { status: 'ready' }>

function useShowInstallationAdvice(agent: CodingAgent, connection: ReadyConnection | null): boolean {
	const dismissed = useAgentConnectionsStore((state) => state.dismissedInstallationAdvice.claude)
	return (
		agent === 'claude' &&
		connection !== null &&
		connection.installationSource !== 'native' &&
		connection.installationSource !== 'standalone' &&
		dismissed !== connection.installationSource
	)
}

export function WiredLocalAgentStatus({
	agent,
	connection,
	isChecking,
	probeError,
}: {
	agent: CodingAgent
	connection: AgentConnection | undefined
	isChecking: boolean
	probeError: string | null
}) {
	const label = AGENT_LABELS[agent]
	const { isReady, failure, statusLabel } = agentPanelStatus(connection, isChecking)
	const readyConnection = connection?.status === 'ready' ? connection : null
	const showInstallationAdvice = useShowInstallationAdvice(agent, readyConnection)
	const dismissInstallationAdvice = useAgentConnectionsStore((state) => state.dismissInstallationAdvice)

	return (
		<SignInRowStatus label={statusLabel} tone={checkStatusTone(isReady, failure !== null, isChecking)}>
			{readyConnection ? (
				<AgentReadyDetails
					agent={agent}
					connection={readyConnection}
					probeError={probeError}
					showInstallationAdvice={showInstallationAdvice}
					onDismissInstallationAdvice={() =>
						dismissInstallationAdvice(agent, readyConnection.installationSource)
					}
				/>
			) : null}
			{isChecking && !readyConnection ? (
				<p>Checking the version and asking {label} for a short response.</p>
			) : null}
			{!connection || connection.status === 'not_checked' ? (
				<p>Check {label} so you can use it for sessions.</p>
			) : null}
			{probeError && !readyConnection ? (
				<p className="text-destructive">Could not run the check: {probeError}</p>
			) : null}
		</SignInRowStatus>
	)
}
