import { Badge } from '@humanlayer/ui/components/badge'
import { Label } from '@humanlayer/ui/components/label'

export type UnavailableIntegrationName = 'Slack' | 'GitHub' | 'Jira' | 'Linear'

const CREDENTIALS_LABEL: Record<UnavailableIntegrationName, string> = {
	Slack: 'Slack app credentials',
	GitHub: 'GitHub App credentials',
	Jira: 'Jira app credentials',
	Linear: 'Linear app credentials',
}

export interface IntegrationUnavailableNoticeProps {
	readonly integration: UnavailableIntegrationName
}

/**
 * Pure settings block for an integration this deployment has no keys for. It replaces the
 * integration's card, so the page offers no Connect button that cannot work and starts no
 * status polling for it.
 */
export function IntegrationUnavailableNotice({ integration }: IntegrationUnavailableNoticeProps) {
	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Label className="text-sm font-medium">{integration}</Label>
				<Badge variant="outline">Not set up</Badge>
			</div>
			<p className="text-sm text-muted-foreground">
				{integration} is not set up on this deployment. Ask your administrator to add{' '}
				{CREDENTIALS_LABEL[integration]}.
			</p>
		</div>
	)
}
