import { createFileRoute, Navigate } from '@tanstack/react-router'

import { AccessRequestsSettings } from '@/components/administration/AccessRequestsSettings'
import { useBrowserAuth } from '@/hooks/use-browser-auth'

export const Route = createFileRoute('/settings/access-requests')({ component: AccessRequestsRoute })

function AccessRequestsRoute() {
	const { isLoading, organizationId, roles } = useBrowserAuth()
	if (isLoading) return null
	if (!organizationId || !roles?.includes('admin')) return <Navigate to="/settings/general" replace />
	return <AccessRequestsSettings key={organizationId} />
}
