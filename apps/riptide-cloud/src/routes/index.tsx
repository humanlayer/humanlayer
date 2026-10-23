import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'

export const Route = createFileRoute('/')({
	component: HomePage,
})

function HomePage() {
	const { user, organizationId, isLoading } = useAuth()
	const navigate = useNavigate()

	// Temporary - redirect to tasks for now (redirect during render, no effect needed)
	if (!isLoading && user && organizationId) {
		navigate({ to: '/tasks' })
		return null
	}

	return (
		<div className="flex items-center justify-center h-full">
			<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
		</div>
	)
}
