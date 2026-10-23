import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { resolveSharedArtifactAccess } from '../../../../effects/shared-artifacts/resolve-shared-artifact-access'
import { effectOrpcBasePublic } from '../../../effect-base'

export const resolveSharedArtifactProcedure = effectOrpcBasePublic.public.artifacts.resolve.effect(function* ({
	context,
	input,
	errors,
}) {
	return yield* resolveSharedArtifactAccess({
		artifactId: input.artifactId,
		shareKey: input.shareKey,
		viewer: context.auth,
	}).pipe(Effect.catchTag('PostgresDbQueryError', (error) => mapPostgresErrorToResponse(error, errors)))
})
