import { HOST_LEVEL_WORKSPACE_PATH, agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { and, desc, eq, ne, notInArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

// A row is one working directory the agent ran in, keyed by exact path and never deleted by the
// daemon, so worktrees accumulate forever and every row syncs to the browser. The daemon is the
// authority on what is live, so each report keeps only the host-level row plus this many most
// recent workspace rows for the host; stale directories fall off. Every report refreshes the row
// it writes, so the just-reported directory is always kept.
const MAX_WORKSPACE_ROWS_PER_HOST = 20

export const reportAgentCommandsProcedure = effectOrpcDaemonBase.agentCommands.report
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { organizationId, userId, hostId } = context.auth

		if (input.hostId !== hostId) {
			return yield* Effect.fail(errors.FORBIDDEN())
		}

		const workspacePath = input.workspacePath ?? HOST_LEVEL_WORKSPACE_PATH
		const forHostAgent = and(
			eq(agentSlashCommands.organization_id, organizationId),
			eq(agentSlashCommands.user_id, userId),
			eq(agentSlashCommands.host_id, hostId),
			eq(agentSlashCommands.agent, input.agent),
		)

		yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					yield* tx.query(
						tx.client
							.insert(agentSlashCommands)
							.values({
								organization_id: organizationId,
								user_id: userId,
								host_id: hostId,
								agent: input.agent,
								workspace_path: workspacePath,
								commands: input.commands,
								skills: input.skills,
							})
							.onConflictDoUpdate({
								target: [
									agentSlashCommands.organization_id,
									agentSlashCommands.user_id,
									agentSlashCommands.host_id,
									agentSlashCommands.agent,
									agentSlashCommands.workspace_path,
								],
								set: {
									commands: input.keepExistingCommands
										? sql`${agentSlashCommands.commands}`
										: input.commands,
									skills: input.skills,
								},
							}),
					)

					const mostRecentWorkspacePaths = tx.client
						.select({ workspace_path: agentSlashCommands.workspace_path })
						.from(agentSlashCommands)
						.where(and(forHostAgent, ne(agentSlashCommands.workspace_path, HOST_LEVEL_WORKSPACE_PATH)))
						.orderBy(desc(agentSlashCommands.updated_at))
						.limit(MAX_WORKSPACE_ROWS_PER_HOST)

					yield* tx.query(
						tx.client
							.delete(agentSlashCommands)
							.where(
								and(
									forHostAgent,
									ne(agentSlashCommands.workspace_path, HOST_LEVEL_WORKSPACE_PATH),
									notInArray(agentSlashCommands.workspace_path, mostRecentWorkspacePaths),
								),
							),
					)
				}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { updated: true }
	})
