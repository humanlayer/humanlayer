import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'
import { mapSlackAutomation } from './automation-mapper'

export const updateSlackAutomationProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.slack.updateAutomation.effect(function* ({
		context,
		input,
		errors,
	}) {
		const Postgres = yield* PostgresDb
		const updates: Partial<typeof slackNotificationAutomations.$inferInsert> = {
			updated_at: BigInt(Date.now()),
		}
		if (input.name !== undefined) updates.name = input.name
		if (input.channelId !== undefined) updates.channel_id = input.channelId
		if (input.channelName !== undefined) updates.channel_name = input.channelName
		if (input.channelIsPrivate !== undefined) updates.channel_is_private = input.channelIsPrivate
		if (input.eventTypes !== undefined) updates.event_types = input.eventTypes
		if (input.ownerUserIds !== undefined) updates.owner_user_ids = input.ownerUserIds
		if (input.enabled !== undefined) updates.enabled = input.enabled
		const [row] = yield* Postgres.query(
			Postgres.client
				.update(slackNotificationAutomations)
				.set(updates)
				.where(
					and(
						eq(slackNotificationAutomations.id, input.id),
						eq(slackNotificationAutomations.organization_id, context.auth.organizationId),
					),
				)
				.returning(),
		).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({ PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors) }),
		)
		if (!row) return yield* Effect.fail(errors.NOT_FOUND())
		yield* Effect.logInfo('Slack automation updated').pipe(
			Effect.annotateLogs({ automationId: row.id, organizationId: context.auth.organizationId }),
		)
		return mapSlackAutomation(row)
	})
