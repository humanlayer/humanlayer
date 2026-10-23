import { effectivePublicPermission, type ArtifactPublicPermission } from '@humanlayer/db/artifact-public-permission'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import type { SharedArtifactResolution } from '@humanlayer/riptide-api-contract/api/public/artifacts/resolve'
import { eq } from 'drizzle-orm'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'

import type { AuthContextOptionalOrg } from '../../auth/jwt-validator'
import { checkTaskReadPermission } from '../../db/task-auth'
import { PostgresDb } from '../services/postgres/postgres-db.service'
import { WorkosService } from '../services/workos/workos.service'

type ResolveSharedArtifactAccessInput = {
	artifactId: string
	shareKey?: string
	viewer: AuthContextOptionalOrg | null
}

function capabilityResolution(
	artifact:
		| {
				shareKey: string | null
				shareEnabled: boolean
				publicPermission: ArtifactPublicPermission
				publicLinksAllowed: boolean | null
		  }
		| undefined,
	shareKey: string | undefined,
): SharedArtifactResolution | null {
	if (!artifact || !shareKey || artifact.shareKey !== shareKey) return null
	const permission = effectivePublicPermission(
		{ share_enabled: artifact.shareEnabled, public_permission: artifact.publicPermission },
		{ publicLinksAllowed: artifact.publicLinksAllowed ?? true },
	)
	return permission === 'off' ? null : { kind: 'public', permission }
}

export const resolveSharedArtifactAccess = Effect.fn('shared_artifacts.resolve_access')(function* (
	input: ResolveSharedArtifactAccessInput,
) {
	const db = yield* PostgresDb
	const workos = yield* WorkosService

	const rows = yield* db.query(
		db.client
			.select({
				id: artifacts.id,
				taskId: artifacts.task_id,
				organizationId: artifacts.organization_id,
				shareKey: artifacts.share_key,
				shareEnabled: artifacts.share_enabled,
				publicPermission: artifacts.public_permission,
				workosOrganizationId: organizations.workos_organization_id,
				publicLinksAllowed: organizationSettings.enable_creating_publicly_shareable_links,
			})
			.from(artifacts)
			.innerJoin(organizations, eq(organizations.id, artifacts.organization_id))
			.leftJoin(organizationSettings, eq(organizationSettings.organization_id, artifacts.organization_id))
			.where(eq(artifacts.id, input.artifactId))
			.limit(1),
	)
	const artifact = rows[0]
	if (!artifact) return { kind: 'unavailable' } as const

	const publicResult = capabilityResolution(artifact, input.shareKey)
	const viewer = input.viewer
	const taskId = artifact.taskId
	if (!viewer?.userId || !taskId) return publicResult ?? ({ kind: 'unavailable' } as const)

	if (viewer.organizationId === artifact.organizationId) {
		const access = yield* db.run(() =>
			checkTaskReadPermission(db.client, taskId, viewer.userId, artifact.organizationId),
		)
		if (access.ok) {
			return { kind: 'authenticated', taskId, artifactId: artifact.id } as const
		}
		return publicResult ?? ({ kind: 'unavailable' } as const)
	}

	const memberships = yield* workos
		.listActiveOrganizationMemberships({
			userId: viewer.userId,
			organizationId: artifact.workosOrganizationId,
			limit: 1,
		})
		.pipe(Effect.result)

	if (Result.isSuccess(memberships) && memberships.success.length > 0) {
		const access = yield* db.run(() =>
			checkTaskReadPermission(db.client, taskId, viewer.userId, artifact.organizationId),
		)
		if (access.ok) {
			return {
				kind: 'switch_organization',
				workosOrganizationId: artifact.workosOrganizationId,
				taskId,
				artifactId: artifact.id,
			} as const
		}
	}

	if (publicResult) return publicResult
	return { kind: 'unavailable' } as const
})
