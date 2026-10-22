import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import z from 'zod/v4'

import { UsersSettings } from '@/components/administration/UsersSettings'
import { useBrowserAuth } from '@/hooks/use-browser-auth'

const UsersSettingsSearchSchema = z.object({ userId: z.string().optional() })

export const Route = createFileRoute('/settings/users')({
	component: UsersSettingsRoute,
	validateSearch: UsersSettingsSearchSchema,
})

function UsersSettingsRoute() {
	const { isLoading, organizationId, roles } = useBrowserAuth()
	const { userId } = Route.useSearch()
	const navigate = useNavigate()
	if (isLoading) return null
	if (!organizationId || !roles?.includes('admin')) return <Navigate to="/settings/general" replace />
	return (
		<UsersSettings
			key={organizationId}
			selectedUserId={userId}
			onSelectedUserIdChange={(nextUserId) =>
				navigate({ to: '/settings/users', search: nextUserId ? { userId: nextUserId } : {}, replace: true })
			}
		/>
	)
}
