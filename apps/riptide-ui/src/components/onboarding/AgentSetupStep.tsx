import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check, ChevronRight, Circle } from 'lucide-react'

import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useLocalHostId } from '@/hooks/use-colocated'

import { connectStatusLabel } from './agent-setup/agent-status'
import { AgentPanel } from './agent-setup/AgentPanel'
import { useAgentProbes } from './agent-setup/useAgentProbes'

interface AgentSetupStepProps {
	open: boolean
	onToggle: () => void
	onAgentReady: () => void
}

export function AgentSetupStep({ open, onToggle, onAgentReady }: AgentSetupStepProps) {
	const { connections, claudeProbe, codexProbe, isClaudeChecking, isCodexChecking, checkAgent } =
		useAgentProbes(onAgentReady)
	const dismissedInstallationAdvice = useAgentConnectionsStore((state) => state.dismissedInstallationAdvice)
	const dismissInstallationAdvice = useAgentConnectionsStore((state) => state.dismissInstallationAdvice)
	const localHostId = useLocalHostId()

	const claudeConnection = connections.find((c) => c.agent === 'claude')
	const codexConnection = connections.find((c) => c.agent === 'codex')
	const readyConnection = connections.find((c) => c.status === 'ready')
	const anyAgentReady = readyConnection !== undefined
	const readyCount = connections.filter((c) => c.status === 'ready').length

	const showClaudeInstallationAdvice =
		claudeConnection?.status === 'ready' &&
		claudeConnection.installationSource !== 'native' &&
		claudeConnection.installationSource !== 'standalone' &&
		dismissedInstallationAdvice.claude !== claudeConnection.installationSource

	return (
		<Collapsible open={open} onOpenChange={onToggle}>
			<CollapsibleTrigger className="flex w-full items-center gap-3 py-4 text-left">
				{anyAgentReady ? (
					<Check className="size-4 text-[var(--terminal-success)]" />
				) : (
					<Circle className="size-4 text-muted-foreground" />
				)}
				<span
					className={cn('flex-1 text-sm font-medium', anyAgentReady && 'line-through text-muted-foreground')}
				>
					Connect a coding agent
				</span>
				<span className="text-xs text-muted-foreground">
					{connectStatusLabel(isClaudeChecking || isCodexChecking, anyAgentReady, readyCount)}
				</span>
				<ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
			</CollapsibleTrigger>
			<CollapsibleContent className="mb-4 space-y-4 bg-accent/5 px-5 py-4 text-sm">
				<p className="text-xs uppercase tracking-wider text-muted-foreground">
					{anyAgentReady
						? 'Coding agent connection · complete'
						: 'Coding agent connection · 0 of 1 connected'}
				</p>

				<div className="grid gap-3">
					<AgentPanel
						agent="claude"
						localHostId={localHostId}
						connection={claudeConnection}
						isChecking={isClaudeChecking}
						probeError={claudeProbe.error instanceof Error ? claudeProbe.error.message : null}
						showInstallationAdvice={showClaudeInstallationAdvice}
						onCheck={(path) => checkAgent('claude', path)}
						onDismissInstallationAdvice={() => {
							if (claudeConnection?.status === 'ready')
								dismissInstallationAdvice('claude', claudeConnection.installationSource)
						}}
					/>
					<AgentPanel
						agent="codex"
						localHostId={localHostId}
						connection={codexConnection}
						isChecking={isCodexChecking}
						probeError={codexProbe.error instanceof Error ? codexProbe.error.message : null}
						showInstallationAdvice={false}
						onCheck={(path) => checkAgent('codex', path)}
						onDismissInstallationAdvice={() => {}}
					/>
				</div>

				{anyAgentReady ? (
					<p className="border-t pt-3 text-xs text-muted-foreground">
						<span className="font-medium text-foreground">Connection requirement complete.</span>{' '}
						{readyCount < 2
							? 'Adding the other agent does not hold up your first task.'
							: 'Both agents are ready.'}
					</p>
				) : null}
			</CollapsibleContent>
		</Collapsible>
	)
}
