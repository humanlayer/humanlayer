import { agentCommandDiscoveryRequests } from '@humanlayer/db/tables/agent-command-discovery-requests'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const discoverWorkspaceAgentCommandsProcedure =
	effectOrpcBaseOrganizationRequired.agentCommands.discoverWorkspace.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth

		yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [ownedHost] = yield* tx.query(
						tx.client
							.select({ hostId: onlineHosts.host_id })
							.from(onlineHosts)
							.where(
								and(
									eq(onlineHosts.host_id, input.hostId),
									eq(onlineHosts.user_id, userId),
									eq(onlineHosts.organization_id, organizationId),
								),
							)
							.limit(1),
					)
					if (!ownedHost) return yield* Effect.fail(errors.NOT_FOUND())

					yield* tx.query(
						tx.client
							.insert(agentCommandDiscoveryRequests)
							.values({
								organization_id: organizationId,
								host_id: input.hostId,
								user_id: userId,
								agent: input.agent,
								workspace_path: input.workspacePath,
							})
							.onConflictDoUpdate({
								target: [
									agentCommandDiscoveryRequests.organization_id,
									agentCommandDiscoveryRequests.host_id,
									agentCommandDiscoveryRequests.user_id,
									agentCommandDiscoveryRequests.agent,
								],
								set: { workspace_path: input.workspacePath },
							}),
					)
				}),
			)
			.pipe(
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { requested: true }
	})
