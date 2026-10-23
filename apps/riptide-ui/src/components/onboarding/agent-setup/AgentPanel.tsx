import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { RefreshCw } from 'lucide-react'

import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'

import { AGENT_LABELS, type AgentFailure, agentPanelStatus } from './agent-status'
import { AgentFailureDetails } from './AgentFailureDetails'
import { AgentReadyDetails } from './AgentReadyDetails'

export interface AgentPanelProps {
	agent: CodingAgent
	localHostId: string | null
	connection: AgentConnection | undefined
	isChecking: boolean
	probeError: string | null
	showInstallationAdvice: boolean
	onCheck: (path: string | null) => void
	onDismissInstallationAdvice: () => void
}

function AgentPanelBody({
	agent,
	label,
	connection,
	isReady,
	failure,
	isChecking,
	probeError,
	localHostId,
	showInstallationAdvice,
	onCheck,
	onDismissInstallationAdvice,
}: {
	agent: CodingAgent
	label: string
	connection: AgentConnection | undefined
	isReady: boolean
	failure: AgentFailure | null
	isChecking: boolean
	probeError: string | null
	localHostId: string | null
	showInstallationAdvice: boolean
	onCheck: (path: string | null) => void
	onDismissInstallationAdvice: () => void
}) {
	if (isReady && connection?.status === 'ready') {
		return (
			<AgentReadyDetails
				agent={agent}
				connection={connection}
				probeError={probeError}
				showInstallationAdvice={showInstallationAdvice}
				onDismissInstallationAdvice={onDismissInstallationAdvice}
			/>
		)
	}
	if (isChecking) return <p>Checking the version and asking {label} for a short response...</p>
	if (failure) {
		return (
			<AgentFailureDetails
				agent={agent}
				failure={failure}
				localHostId={localHostId}
				installationSource={connection?.installationSource ?? null}
				onCheck={onCheck}
			/>
		)
	}
	if (probeError) return <p className="text-destructive">Could not run the device check: {probeError}</p>
	return <p className="text-xs">Add {label} so you can use it for sessions.</p>
}

function AgentPanelAction({
	label,
	isReady,
	isFailed,
	isChecking,
	onClick,
}: {
	label: string
	isReady: boolean
	isFailed: boolean
	isChecking: boolean
	onClick: () => void
}) {
	const configured = isReady || isFailed
	return (
		<Button
			className="mt-2"
			type="button"
			variant={configured ? 'secondary' : 'default'}
			size="sm"
			onClick={onClick}
			disabled={isChecking}
		>
			{configured ? (
				<>
					<RefreshCw className={cn('size-3.5', isChecking && 'animate-spin')} /> Check again
				</>
			) : isChecking ? (
				'Checking…'
			) : (
				`Configure ${label}`
			)}
		</Button>
	)
}

export function AgentPanel({
	agent,
	localHostId,
	connection,
	isChecking,
	probeError,
	showInstallationAdvice,
	onCheck,
	onDismissInstallationAdvice,
}: AgentPanelProps) {
	const label = AGENT_LABELS[agent]
	const { isReady, failure, panelClass, statusClass, statusLabel } = agentPanelStatus(connection, isChecking)

	return (
		<div
			className={cn(
				// min-w-0 lets this grid item shrink to the track: without it the
				// nowrap executable path below sets the card's min-content width and
				// the card overflows the settings column instead of truncating.
				'min-w-0 rounded-md border p-3',
				panelClass,
			)}
		>
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium">{label}</span>
				<span className={cn('text-[10px] uppercase tracking-wider', statusClass)}>{statusLabel}</span>
			</div>

			<div className="mt-2 space-y-2 text-sm text-muted-foreground">
				<AgentPanelBody
					agent={agent}
					label={label}
					connection={connection}
					isReady={isReady}
					failure={failure}
					isChecking={isChecking}
					probeError={probeError}
					localHostId={localHostId}
					showInstallationAdvice={showInstallationAdvice}
					onCheck={onCheck}
					onDismissInstallationAdvice={onDismissInstallationAdvice}
				/>
			</div>

			<AgentPanelAction
				label={label}
				isReady={isReady}
				isFailed={failure !== null}
				isChecking={isChecking}
				onClick={() => onCheck(connection?.path ?? null)}
			/>
		</div>
	)
}
