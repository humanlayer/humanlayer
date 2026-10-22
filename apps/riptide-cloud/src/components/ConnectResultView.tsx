import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'
import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { AlertTriangle, CheckCircle2, LinkIcon, XCircle } from 'lucide-react'
import type { ReactElement } from 'react'

export type ConnectResultProvider = 'linear' | 'jira'

export type ConnectResultStatus = 'connected' | 'access_denied' | 'auth_failed' | 'invalid_link' | 'unavailable'

const PROVIDER_NAMES: Record<ConnectResultProvider, string> = {
	linear: 'Linear',
	jira: 'Jira',
}

type Copy = {
	icon: ReactElement
	heading: string
	body: string
}

function copyFor(provider: ConnectResultProvider, status: ConnectResultStatus): Copy {
	const name = PROVIDER_NAMES[provider]

	switch (status) {
		case 'connected':
			return {
				icon: <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-[var(--terminal-success)]" />,
				heading: `${name} Connected`,
				body: `Your ${name} workspace is connected. You can now create tasks from ${name} issues.`,
			}
		case 'access_denied':
			return {
				icon: <XCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />,
				heading: `${name} Not Connected`,
				body: `You declined access on ${name}'s consent screen, so nothing was connected. You can start the connect again from settings whenever you're ready.`,
			}
		case 'auth_failed':
			return {
				icon: <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />,
				heading: `${name} Connection Failed`,
				body: `We couldn't complete the handshake with ${name}. Nothing was changed. Try connecting again from settings.`,
			}
		case 'invalid_link':
			return {
				icon: <LinkIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />,
				heading: 'Link Expired',
				body: `This connect link has already been used or has expired. Start a new ${name} connect from settings.`,
			}
		case 'unavailable':
			return {
				icon: <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />,
				heading: 'Something Went Wrong',
				body: `We couldn't finish connecting ${name} right now. Nothing was changed. Please try again in a moment.`,
			}
	}
}

/**
 * Pure full-page result screen for a provider OAuth round trip — no router, no auth, so it
 * stories directly. Skeleton follows `InvitationPendingScreen` (semantic tokens, centered
 * card, lucide icon, uppercase mono heading, full-width buttons).
 *
 * Both buttons always render. `client` decides which one leads — in position and in variant:
 * a desktop-initiated flow leads with "Back to HumanLayer", everything else leads with
 * "Back to settings".
 */
export function ConnectResultView(props: {
	provider: ConnectResultProvider
	status: ConnectResultStatus
	client: RiptideClient
	onBackToApp: () => void
}): ReactElement {
	const { provider, status, client, onBackToApp } = props
	const { icon, heading, body } = copyFor(provider, status)
	const desktopIsPrimary = client === 'native'

	const backToApp = (
		<Button
			key="back-to-app"
			variant={desktopIsPrimary ? 'default' : 'outline'}
			className="w-full uppercase tracking-wider"
			onClick={onBackToApp}
		>
			Back to HumanLayer
		</Button>
	)
	const backToSettings = (
		<Button
			key="back-to-settings"
			variant={desktopIsPrimary ? 'outline' : 'default'}
			className="w-full uppercase tracking-wider"
			asChild
		>
			<a href="/settings">Back to settings</a>
		</Button>
	)

	return (
		<div className="flex min-h-full items-center justify-center p-6">
			<Card className="w-full max-w-md border-border bg-background p-8 text-center shadow-none">
				{icon}
				<h2 className="mb-2 font-mono uppercase tracking-wider">{heading}</h2>
				<p className="mb-6 text-sm leading-relaxed text-muted-foreground">{body}</p>

				<div className="space-y-2">
					{desktopIsPrimary ? [backToApp, backToSettings] : [backToSettings, backToApp]}
				</div>
			</Card>
		</div>
	)
}
