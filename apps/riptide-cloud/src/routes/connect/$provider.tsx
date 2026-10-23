import { RIPTIDE_CLIENTS } from '@humanlayer/riptide-api-contract/types/client'
import { Card } from '@humanlayer/ui/components/card'
import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { ConnectResultView, type ConnectResultProvider, type ConnectResultStatus } from '@/components/ConnectResultView'
import { buildDesktopFocusDeepLink } from '@/lib/deep-link'

const CONNECT_PROVIDERS = ['linear', 'jira'] as const
const CONNECT_STATUSES = ['connected', 'access_denied', 'auth_failed', 'invalid_link', 'unavailable'] as const

/**
 * Everything defaults rather than fails. This screen is the terminal state of an OAuth round
 * trip — a validation error here would strand the user exactly the way the old spinner did.
 * Unknown status falls back to `unavailable` and unknown client to `cloud`, following the
 * billing checkout-completion parse.
 */
const connectSearchSchema = z.object({
	status: z.enum(CONNECT_STATUSES).catch('unavailable'),
	client: z.enum(RIPTIDE_CLIENTS).catch('cloud'),
})

export const Route = createFileRoute('/connect/$provider')({
	component: ConnectResultPage,
	validateSearch: connectSearchSchema,
})

function isConnectProvider(value: string): value is ConnectResultProvider {
	return (CONNECT_PROVIDERS as readonly string[]).includes(value)
}

function ConnectResultPage() {
	const { provider } = Route.useParams()
	const { status, client } = Route.useSearch()

	if (!isConnectProvider(provider)) {
		return (
			<div className="flex min-h-full items-center justify-center p-6">
				<Card className="w-full max-w-md border-border bg-background p-8 text-center shadow-none">
					<h2 className="mb-2 font-mono uppercase tracking-wider">Unknown Integration</h2>
					<p className="text-sm leading-relaxed text-muted-foreground">
						There is no "{provider}" integration to connect.
					</p>
				</Card>
			</div>
		)
	}

	return (
		<ConnectResultView
			provider={provider}
			status={status as ConnectResultStatus}
			client={client}
			// The desktop app stayed on the user's in-progress form, so focus it without routing.
			onBackToApp={() => {
				window.location.href = buildDesktopFocusDeepLink()
			}}
		/>
	)
}
