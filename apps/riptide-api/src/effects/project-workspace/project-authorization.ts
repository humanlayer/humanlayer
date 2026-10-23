import { projects } from '@humanlayer/db/tables/projects'
import { and, eq, or } from 'drizzle-orm'

export interface ProjectAccessActor {
	readonly organizationId: string
	readonly userId: string
}

/** Projects are readable by their owner or, when shared, by anyone in the organization. */
export function projectReadableByActor(actor: ProjectAccessActor) {
	return and(
		eq(projects.organization_id, actor.organizationId),
		or(eq(projects.private, false), eq(projects.resource_owner_user_id, actor.userId)),
	)
}
