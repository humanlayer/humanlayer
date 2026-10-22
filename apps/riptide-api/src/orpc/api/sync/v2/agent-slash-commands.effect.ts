import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { and, getTableColumns } from 'drizzle-orm'
import { Effect } from 'effect'

import { buildAgentSlashCommandsSyncWhereV2 } from '../../../../db/sync-auth'
import { parseSyncQuery } from '../../../../db/sync-filters'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

const DEFAULT_LIMIT = 10000

export const syncV2AgentSlashCommandsEffectProcedure =
	effectOrpcBaseOrganizationRequired.sync.v2.agentSlashCommands.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb

		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { clientWhere, orderBy } = yield* parseSyncQuery({
			columns: getTableColumns(agentSlashCommands),
			where,
			sorts,
			tableName: 'agent_slash_commands',
		}).pipe(
			Effect.catchTag('SyncFilterError', (error) =>
				Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
			),
		)

		const authWhere = buildAgentSlashCommandsSyncWhereV2({ organizationId, userId })
		let query = postgres.client.select().from(agentSlashCommands).where(and(authWhere, clientWhere)).$dynamic()
		if (orderBy.length > 0) query = query.orderBy(...orderBy)
		query = query.limit(limit ?? DEFAULT_LIMIT)
		if (offset !== undefined) query = query.offset(offset)

		const rows = yield* postgres
			.query(query)
			.pipe(Effect.catchTag('PostgresDbQueryError', (error) => mapPostgresErrorToResponse(error, errors)))

		return { rows }
	})
