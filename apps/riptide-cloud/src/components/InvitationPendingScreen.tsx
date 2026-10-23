import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { MailCheck } from 'lucide-react'

import { ArtifactSummary } from './RequestAccessLoggedIn'
import type { ArtifactInfoInaccessible } from './RequestAccessScreen'

export function InvitationPendingScreen({ lookup }: { lookup: ArtifactInfoInaccessible }) {
	return (
		<div className="flex min-h-full items-center justify-center p-6">
			<Card className="w-full max-w-md border-border bg-background p-8 text-center shadow-none">
				<MailCheck className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
				<h2 className="mb-2 font-mono uppercase tracking-wider">Check Your Email</h2>
				<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
					You've been invited to {lookup.organizationName}. Accept the invitation from your inbox to view this
					artifact.
				</p>

				<ArtifactSummary lookup={lookup} />

				<Button variant="outline" className="w-full uppercase tracking-wider" asChild>
					<a href="/auth/signin">Sign in</a>
				</Button>
			</Card>
		</div>
	)
}
