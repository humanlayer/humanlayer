import { anonymousArtifactCommenters, artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const publicCommentGuestIdentityProcedure =
	effectOrpcBaseOrganizationRequired.comments.publicCommentGuestIdentity.effect(function* ({
		input,
		context,
		errors,
	}) {
		const db = yield* PostgresDb
		return yield* db
			.query(
				db.client
					.select({
						name: anonymousArtifactCommenters.display_name,
						email: anonymousArtifactCommenters.email,
					})
					.from(artifactComments)
					.innerJoin(artifacts, eq(artifacts.id, artifactComments.artifact_id))
					.innerJoin(
						anonymousArtifactCommenters,
						and(
							eq(anonymousArtifactCommenters.artifact_id, artifactComments.artifact_id),
							eq(anonymousArtifactCommenters.id, artifactComments.anonymous_author_id),
						),
					)
					.where(
						and(
							eq(artifactComments.id, input.commentId),
							eq(artifacts.organization_id, context.auth.organizationId),
						),
					)
					.limit(1),
			)
			.pipe(
				Effect.flatMap(([identity]) =>
					identity
						? Effect.succeed({ ...identity, unverified: true as const })
						: Effect.fail(errors.NOT_FOUND()),
				),
				Effect.catchTag('PostgresDbQueryError', (error) => mapPostgresErrorToResponse(error, errors)),
			)
	})
