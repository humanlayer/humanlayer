import { getHumanLayerCliInstallCommand } from '@humanlayer/ui/lib/humanlayer-cli'

import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'
import { buildConfig } from '@/lib/config'

import { getClaudeRepairCommand } from '../probe-repair'

export const AGENT_LABELS: Record<CodingAgent, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
}

export type AgentFailure = NonNullable<Extract<AgentConnection, { status: 'failed' }>['failure']>

export function getRepairCommand(
	agent: CodingAgent,
	failureReason: string | undefined,
	installationSource: string | null | undefined,
): string {
	if (agent === 'codex') {
		return `${getHumanLayerCliInstallCommand(buildConfig.type)} && humanlayer agents auth codex login`
	}
	return getClaudeRepairCommand(failureReason as Parameters<typeof getClaudeRepairCommand>[0], installationSource)
}

function agentStatusLabel(isReady: boolean, isChecking: boolean, isFailed: boolean): string {
	if (isReady) return 'Ready'
	if (isChecking) return 'Checking…'
	if (isFailed) return 'Failed'
	return 'Not configured'
}

export function agentPanelStatus(connection: AgentConnection | undefined, isChecking: boolean) {
	const isReady = connection?.status === 'ready'
	const failure = connection?.status === 'failed' ? connection.failure : null
	const panelClass = isReady
		? 'border-[var(--terminal-success)]/40 bg-[var(--terminal-success)]/5'
		: failure
			? 'border-[var(--terminal-error)]/40 bg-[var(--terminal-error)]/5'
			: 'border-border'
	const statusClass = isReady
		? 'text-[var(--terminal-success)]'
		: failure
			? 'text-destructive'
			: 'text-muted-foreground'
	return {
		isReady,
		failure,
		panelClass,
		statusClass,
		statusLabel: agentStatusLabel(isReady, isChecking, failure !== null),
	}
}

export function connectStatusLabel(isChecking: boolean, anyAgentReady: boolean, readyCount: number): string {
	if (isChecking) return 'Checking...'
	if (anyAgentReady) return `${readyCount} agent${readyCount > 1 ? 's' : ''} ready`
	return 'Needs attention'
}
