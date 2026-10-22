import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { buildBillingSearchParams, normalizeBillingRedirectSearch } from '@/domains/billing/redirect'
import { buildNavigationDeepLink } from '@/domains/deep-links/handler'
import { useMountEffect } from '@/hooks/useMountEffect'

export const Route = createFileRoute('/billing/return')({
	component: BillingReturnPage,
	validateSearch: normalizeBillingRedirectSearch,
})

function BillingReturnPage() {
	const search = Route.useSearch()
	const navigate = useNavigate()
	const [isAttemptingDeepLink, setIsAttemptingDeepLink] = useState(true)

	useMountEffect(() => {
		const queryString = buildBillingSearchParams(search)
		const deepLinkUrl = buildNavigationDeepLink('settings/billing', queryString)

		window.location.href = deepLinkUrl

		const timeout = setTimeout(() => {
			setIsAttemptingDeepLink(false)
			navigate({ to: '/settings/billing', search })
		}, 2000)

		return () => clearTimeout(timeout)
	})

	if (isAttemptingDeepLink) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<Card className="max-w-md p-8 text-center">
					<SyncGridAnimation
						variant="snake"
						speed={120}
						className="mx-auto mb-4 w-12 text-muted-foreground"
					/>
					<h2 className="mb-2 font-mono uppercase tracking-wider">Opening in HumanLayer…</h2>
					<p className="text-sm text-muted-foreground">
						If the app does not open, you will be redirected to billing in the browser.
					</p>
				</Card>
			</div>
		)
	}

	return null
}
