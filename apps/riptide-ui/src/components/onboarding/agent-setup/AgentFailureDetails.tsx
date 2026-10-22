import { Button } from '@humanlayer/ui/components/button'
import { useState } from 'react'

import type { ProviderSignInProvider } from '@/components/provider-sign-in/ProviderSignInCard'
import { WiredProviderSignInCard } from '@/components/provider-sign-in/WiredProviderSignInCard'
import { useInAppSignInProvider } from '@/hooks/useInAppSignIn'
import type { CodingAgent } from '@/integrations/desktop/diagnostics'

import { Command } from '../Command'
import { getProbeFailureSummary } from '../probe-repair'
import { type AgentFailure, getRepairCommand } from './agent-status'

function AgentAuthSignIn({
	localHostId,
	agent,
	repairCommand,
	onSignedIn,
}: {
	localHostId: string | null
	agent: ProviderSignInProvider
	repairCommand: string
	onSignedIn: () => void
}) {
	return (
		<WiredProviderSignInCard hostId={localHostId} provider={agent} variant="inline" onSignedIn={onSignedIn}>
			<details className="text-xs">
				<summary className="cursor-pointer hover:text-foreground">Use the terminal instead</summary>
				<div className="mt-2">
					<Command>{repairCommand}</Command>
				</div>
			</details>
		</WiredProviderSignInCard>
	)
}

export function AgentFailureDetails({
	agent,
	failure,
	localHostId,
	installationSource,
	onCheck,
}: {
	agent: CodingAgent
	failure: AgentFailure
	localHostId: string | null
	installationSource: string | null | undefined
	onCheck: (path: string | null) => void
}) {
	const [preferredPath, setPreferredPath] = useState('')
	const repairCommand = getRepairCommand(agent, failure.reason, installationSource)
	const inAppSignInProvider = useInAppSignInProvider(agent)
	const showInAppSignIn = failure.reason === 'authentication_required' && inAppSignInProvider !== null
	const hasActionableRepair =
		agent === 'codex' ||
		failure.reason === 'not_found' ||
		failure.reason === 'authentication_required' ||
		failure.reason === 'unsupported_version'
	return (
		<>
			<p>{getProbeFailureSummary(agent, failure.reason)}</p>
			{failure.details ? (
				<details className="w-full text-left">
					<summary className="cursor-pointer font-mono text-xs text-muted-foreground hover:text-foreground">
						Show diagnostic output
					</summary>
					<pre className="mt-2 max-h-64 overflow-auto break-words bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
						{failure.details}
					</pre>
				</details>
			) : null}
			{showInAppSignIn ? (
				<AgentAuthSignIn
					localHostId={localHostId}
					agent={inAppSignInProvider}
					repairCommand={repairCommand}
					onSignedIn={() => onCheck(null)}
				/>
			) : null}
			{hasActionableRepair && !showInAppSignIn ? (
				<>
					<Command>{repairCommand}</Command>
					{failure.reason === 'not_found' ? (
						<form
							className="flex gap-2"
							onSubmit={(event) => {
								event.preventDefault()
								onCheck(preferredPath.trim() || null)
							}}
						>
							<input
								aria-label={`${agent === 'claude' ? 'Claude' : 'HumanLayer CLI'} executable path`}
								className="min-w-0 flex-1 border-b bg-transparent px-1 py-2 font-mono text-xs outline-none focus:border-primary"
								placeholder={
									agent === 'claude' ? '/absolute/path/to/claude' : '/absolute/path/to/humanlayer'
								}
								value={preferredPath}
								onChange={(event) => setPreferredPath(event.target.value)}
							/>
							<Button type="submit" variant="secondary" size="sm">
								Check path
							</Button>
						</form>
					) : null}
				</>
			) : null}
		</>
	)
}
