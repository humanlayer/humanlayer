import {
	findSelectedMember,
	type OrganizationMember as AdminOrganizationMember,
} from '@humanlayer/ui/administration/member'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import z from 'zod/v4'

import { useRiptideApi } from '@/api/client'
import { UserDetails } from '@/components/UserDetails'
import { UsersTable } from '@/components/UsersTable'

const AdminUsersSearchSchema = z.object({
	userId: z.string().optional(),
})

export const Route = createFileRoute('/admin/users')({
	component: AdminUsersPage,
	// `?userId=` is the source of truth for which member's detail panel is open,
	// so the panel is deep-linkable (e.g. from the Team Metrics "Top Users" table).
	validateSearch: AdminUsersSearchSchema,
})

function AdminUsersPage() {
	const { isLoading, roles } = useAuth()
	const navigate = useNavigate()
	const { userId } = Route.useSearch()
	const { queryClient: apiQueryClient } = useRiptideApi()
	const { data } = useQuery(apiQueryClient.auth.admin.users.list.queryOptions({ input: {} }))

	if (isLoading) return null

	if (!roles?.includes('admin')) {
		navigate({ to: '/artifacts' })
		return null
	}

	const users = data?.users ?? []
	const selectedUser = findSelectedMember(users, userId) ?? null

	const selectUser = (user: AdminOrganizationMember | null) =>
		navigate({ to: '/admin/users', search: user ? { userId: user.id } : {} })

	return (
		<div className="p-6 space-y-6">
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className={selectedUser ? 'lg:col-span-2' : 'lg:col-span-3'}>
					<UsersTable onUserSelect={selectUser} />
				</div>
				{selectedUser && (
					<div className="lg:col-span-1">
						<UserDetails user={selectedUser} onClose={() => selectUser(null)} />
					</div>
				)}
			</div>
		</div>
	)
}
