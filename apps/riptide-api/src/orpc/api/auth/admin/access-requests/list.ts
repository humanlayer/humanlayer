import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { apiBaseForOrganizationAdmin } from '../../../../base'

function buildDisplayName(user: { firstName?: string | null; lastName?: string | null } | null): string | null {
	if (!user) return null
	const parts = [user.firstName, user.lastName].filter((s): s is string => Boolean(s))
	return parts.length > 0 ? parts.join(' ') : null
}

export const adminListAccessRequestsProcedure = apiBaseForOrganizationAdmin.auth.admin.accessRequests.list.handler(
	async ({ context, input }) => {
		const { db, workos } = context.services
		const { organizationId } = context.auth

		const rows = await db
			.select({
				id: accessRequests.id,
				requester_email: accessRequests.requester_email,
				requester_user_id: accessRequests.requester_user_id,
				artifact_id: accessRequests.artifact_id,
				artifact_title_snapshot: accessRequests.artifact_title_snapshot,
				artifact_title: artifacts.file_name,
				task_name: tasks.name,
				requested_at: accessRequests.requested_at,
				status: accessRequests.status,
				notification_status: accessRequests.notification_status,
			})
			.from(accessRequests)
			.leftJoin(artifacts, eq(artifacts.id, accessRequests.artifact_id))
			.leftJoin(tasks, eq(tasks.id, artifacts.task_id))
			.where(and(eq(accessRequests.organization_id, organizationId), eq(accessRequests.status, input.status)))
			.orderBy(desc(accessRequests.requested_at))

		// Best-effort: resolve requester names via WorkOS for rows where requester_user_id is set.
		// Bounded concurrency so a large request list does not blast the WorkOS API.
		const userIds = [...new Set(rows.map((r) => r.requester_user_id).filter((id): id is string => Boolean(id)))]
		const entries = await Effect.runPromise(
			Effect.forEach(
				userIds,
				(userId) =>
					Effect.tryPromise(() => workos.userManagement.getUser(userId)).pipe(
						Effect.map((user) => [userId, buildDisplayName(user)] as const),
						Effect.catch(() => Effect.succeed([userId, null] as const)),
					),
				{ concurrency: 5 },
			),
		)
		const nameMap = new Map<string, string | null>(entries)

		return rows.map((r) => ({
			id: r.id,
			requesterEmail: r.requester_email,
			requesterName: r.requester_user_id ? (nameMap.get(r.requester_user_id) ?? null) : null,
			artifactId: r.artifact_id,
			artifactTitle: r.artifact_title ?? r.artifact_title_snapshot,
			taskName: r.task_name ?? null,
			requestedAt: r.requested_at.toISOString(),
			status: r.status,
			notificationStatus: r.notification_status,
		}))
	},
)
