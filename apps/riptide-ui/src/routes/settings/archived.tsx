import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'

export const Route = createFileRoute('/settings/archived')({
	component: ArchivedSettingsRoute,
})

/** The minimalist layout renders its own archive here; the standard UI keeps the full archive page. */
function ArchivedSettingsRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return null
	return <Navigate to="/archive/tasks" replace />
}
