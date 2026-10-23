import { Button } from '@humanlayer/ui/components/button'

import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'

import { isVersionBelow, RECOMMENDED_CLAUDE_VERSION } from './agent-version'

export function AgentReadyDetails({
	agent,
	connection,
	probeError,
	showInstallationAdvice,
	onDismissInstallationAdvice,
}: {
	agent: CodingAgent
	connection: Extract<AgentConnection, { status: 'ready' }>
	probeError: string | null
	showInstallationAdvice: boolean
	onDismissInstallationAdvice: () => void
}) {
	return (
		<>
			<p
				className="truncate text-xs"
				title={`${connection.version} · ${connection.installationSource} · ${connection.path}`}
			>
				{connection.version} &middot; {connection.installationSource} &middot; {connection.path}
			</p>
			{agent === 'claude' && isVersionBelow(connection.version, RECOMMENDED_CLAUDE_VERSION) ? (
				<p className="text-xs text-amber-500">
					We recommend {RECOMMENDED_CLAUDE_VERSION}+. Run{' '}
					<code className="bg-muted/60 px-1">claude update</code> to get the latest.
				</p>
			) : null}
			{probeError ? <p className="text-xs text-destructive">Could not recheck: {probeError}</p> : null}
			{showInstallationAdvice ? (
				<div className="space-y-2 bg-muted/50 px-3 py-2 text-xs">
					<p>This install works. The standalone Claude install usually receives updates sooner.</p>
					<div className="flex items-center gap-2">
						<Button type="button" variant="secondary" size="sm" onClick={onDismissInstallationAdvice}>
							Keep {connection.installationSource}
						</Button>
						<span>Optional</span>
					</div>
				</div>
			) : null}
		</>
	)
}
