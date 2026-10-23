import { AGENT_LABELS, agentPanelStatus } from '@/components/onboarding/agent-setup/agent-status'
import { AgentFailureDetails } from '@/components/onboarding/agent-setup/AgentFailureDetails'
import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'
import { useInAppSignInProvider } from '@/hooks/useInAppSignIn'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'

import { CheckButton } from './CheckButton'
import { SignInAgentRow, SignInRowActions, SignInRowDetail } from './SignInHost'
import { WiredLocalAgentStatus } from './WiredLocalAgentStatus'
import { WiredProviderSignInCells } from './WiredProviderSignInCells'

export function WiredLocalAgentRow({
	agent,
	localHostId,
	connection,
	isChecking,
	probeError,
	onCheck,
}: {
	agent: CodingAgent
	localHostId: string | null
	connection: AgentConnection | undefined
	isChecking: boolean
	probeError: string | null
	onCheck: (path: string | null) => void
}) {
	const { isReady, failure } = agentPanelStatus(connection, isChecking)
	const signInProvider = useInAppSignInProvider(isReady ? agent : null)
	const recheck = () => onCheck(connection?.path ?? null)

	return (
		<SignInAgentRow name={AGENT_LABELS[agent]}>
			<WiredLocalAgentStatus
				agent={agent}
				connection={connection}
				isChecking={isChecking}
				probeError={probeError}
			/>
			{signInProvider && localHostId ? (
				<WiredProviderSignInCells
					hostId={localHostId}
					provider={signInProvider}
					isColocated
					onSignedIn={recheck}
				/>
			) : (
				<SignInRowActions>
					{isReady ? null : (
						<CheckButton isChecking={isChecking} primary={failure === null} onClick={recheck}>
							{failure ? 'Check again' : 'Check'}
						</CheckButton>
					)}
				</SignInRowActions>
			)}
			{failure && !isChecking ? (
				<SignInRowDetail>
					<AgentFailureDetails
						agent={agent}
						failure={failure}
						localHostId={localHostId}
						installationSource={connection?.installationSource ?? null}
						onCheck={onCheck}
					/>
				</SignInRowDetail>
			) : null}
		</SignInAgentRow>
	)
}
