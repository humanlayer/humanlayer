import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'
import { mapSlackAutomation } from './automation-mapper'

export const createSlackAutomationProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.slack.createAutomation.effect(function* ({
		context,
		input,
		errors,
	}) {
		const Postgres = yield* PostgresDb
		const [row] = yield* Postgres.query(
			Postgres.client
				.insert(slackNotificationAutomations)
				.values({
					organization_id: context.auth.organizationId,
					created_by_user_id: context.auth.userId,
					name: input.name,
					channel_id: input.channelId,
					channel_name: input.channelName,
					channel_is_private: input.channelIsPrivate,
					event_types: input.eventTypes,
					owner_user_ids: input.ownerUserIds,
					enabled: input.enabled,
				})
				.returning(),
		).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({ PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors) }),
		)
		if (!row) return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
		yield* Effect.logInfo('Slack automation created').pipe(
			Effect.annotateLogs({ automationId: row.id, organizationId: context.auth.organizationId }),
		)
		return mapSlackAutomation(row)
	})
