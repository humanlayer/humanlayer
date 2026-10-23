import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { buildDesktopDeepLink } from '@/lib/deep-link'

export const Route = createFileRoute('/deep/tasks/$taskId')({
	component: TaskDeepLinkPage,
})

function TaskDeepLinkPage() {
	const { taskId } = Route.useParams()
	const navigate = useNavigate()
	const [isAttemptingDeepLink, setIsAttemptingDeepLink] = useState(true)

	useMountEffect(() => {
		const deepLinkUrl = buildDesktopDeepLink(`/tasks/${taskId}`)

		// Attempt to open deep link via location.href
		// If the native app handles the protocol, it opens; if not, the browser silently ignores it
		// and the user stays on this page until the fallback timeout fires
		window.location.href = deepLinkUrl

		// Wait ~2 seconds, then navigate to fallback cloud content
		const timeout = setTimeout(() => {
			setIsAttemptingDeepLink(false)
			navigate({ to: '/tasks/$taskId/artifacts', params: { taskId } })
		}, 2000)

		return () => clearTimeout(timeout)
	})

	if (isAttemptingDeepLink) {
		return (
			<div className="flex items-center justify-center h-full">
				<Card className="p-8 text-center max-w-md">
					<SyncGridAnimation
						variant="snake"
						speed={120}
						className="w-12 mx-auto text-muted-foreground mb-4"
					/>
					<h2 className="font-mono uppercase tracking-wider mb-2">Opening in HumanLayer...</h2>
					<p className="text-sm text-muted-foreground">
						If the app doesn't open, you'll be redirected to view this task in the browser.
					</p>
				</Card>
			</div>
		)
	}

	// This state is transient — the component will unmount as soon as navigate() triggers
	return null
}
