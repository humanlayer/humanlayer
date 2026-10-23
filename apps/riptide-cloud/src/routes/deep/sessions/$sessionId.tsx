import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { buildDesktopDeepLink } from '@/lib/deep-link'
import { useSync } from '@/providers/SyncProvider'

export const Route = createFileRoute('/deep/sessions/$sessionId')({
	component: SessionDeepLinkPage,
})

function SessionDeepLinkPage() {
	const { sessionId } = Route.useParams()
	const navigate = useNavigate()
	const { sessionsCollection } = useSync()
	const [isAttemptingDeepLink, setIsAttemptingDeepLink] = useState(true)

	// Query for the session to get its task_id
	const { data: sessionData } = useLiveQuery(
		(q) =>
			q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => eq(sessions.id, sessionId))
				.select(({ sessions }) => ({ task_id: sessions.task_id })),
		[sessionsCollection, sessionId],
	)

	const session = sessionData?.[0]
	const sessionRef = useRef(session)
	sessionRef.current = session

	useMountEffect(() => {
		const deepLinkUrl = buildDesktopDeepLink(`/sessions/${sessionId}`)

		// Attempt to open deep link via location.href
		// If the native app handles the protocol, it opens; if not, the browser silently ignores it
		// and the user stays on this page until the fallback timeout fires
		window.location.href = deepLinkUrl

		// Wait ~2 seconds, then navigate to fallback cloud content
		const timeout = setTimeout(() => {
			setIsAttemptingDeepLink(false)
			if (sessionRef.current?.task_id) {
				// Navigate to the session's parent task artifacts page
				navigate({ to: '/tasks/$taskId/artifacts', params: { taskId: sessionRef.current.task_id } })
			}
			// If session data hasn't loaded yet, the user will see the "Session Not Found" fallback
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
						If the app doesn't open, you'll be redirected to view this session's task in the browser.
					</p>
				</Card>
			</div>
		)
	}

	// If we're past the deep link attempt and still no session data, show not found
	if (!session) {
		return (
			<div className="flex items-center justify-center h-full">
				<Card className="p-8 text-center max-w-md">
					<h2 className="font-mono uppercase tracking-wider mb-2">Session Not Found</h2>
					<p className="text-sm text-muted-foreground mb-6">
						This session may not exist or may be in a different organization.
					</p>
					<Button variant="outline" asChild>
						<Link to="/install">Install HumanLayer</Link>
					</Button>
				</Card>
			</div>
		)
	}

	// This state is transient — the component will unmount as soon as navigate() triggers
	return null
}
