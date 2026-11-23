import { Badge } from '@humanlayer/ui/components/badge'
import { Label } from '@humanlayer/ui/components/label'
import { CheckCircle2 } from 'lucide-react'

import type { EmailCapability } from '@/lib/integration-capabilities'

export interface EmailIntegrationCardProps {
	readonly email: EmailCapability
}

/**
 * Pure settings block that says whether this deployment can send email. It has no controls:
 * email is set up by whoever runs the deployment, not per organization.
 */
export function EmailIntegrationCard({ email }: EmailIntegrationCardProps) {
	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Label className="text-sm font-medium">Email</Label>
				{email.configured ? (
					<Badge className="gap-1">
						<CheckCircle2 className="size-3" aria-hidden="true" /> Configured
					</Badge>
				) : (
					<Badge variant="outline">Not set up</Badge>
				)}
			</div>
			<p className="text-sm text-muted-foreground">
				{email.configured ? (
					<>
						Invites and notifications are sent from{' '}
						<span className="font-medium text-foreground">{email.fromAddress}</span>.
					</>
				) : (
					'Email is not set up on this deployment. Invites and notifications will not be sent until your administrator adds email credentials.'
				)}
			</p>
		</div>
	)
}
