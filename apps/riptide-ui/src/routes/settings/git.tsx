import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'

export const Route = createFileRoute('/settings/git')({
	component: GitSettingsRoute,
})

/** Git preferences only shape the minimalist layout's Commit and Open PR buttons. */
function GitSettingsRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return null
	return <Navigate to="/settings/general" replace />
}
