import { Button } from '@humanlayer/ui/components/button'

import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'

export function ConnectGitHubStep() {
	const connectIntegration = useConnectIntegrationAction()
	return (
		<div className="space-y-3">
			<p>
				Every session shows its pull request in the GitHub tab. Read review threads, send failing checks to the
				agent, and merge without leaving HumanLayer.
			</p>
			<div className="flex flex-wrap items-center gap-3">
				<Button onClick={() => void connectIntegration('github')}>Connect GitHub</Button>
				<span className="text-xs text-muted-foreground">about a minute · opens github.com</span>
			</div>
		</div>
	)
}
