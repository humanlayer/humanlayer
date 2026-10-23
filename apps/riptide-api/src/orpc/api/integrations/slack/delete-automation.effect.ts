import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const deleteSlackAutomationProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.slack.deleteAutomation.effect(function* ({
		context,
		input,
		errors,
	}) {
		const Postgres = yield* PostgresDb
		yield* Postgres.query(
			Postgres.client
				.delete(slackNotificationAutomations)
				.where(
					and(
						eq(slackNotificationAutomations.id, input.id),
						eq(slackNotificationAutomations.organization_id, context.auth.organizationId),
					),
				),
		).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({ PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors) }),
		)
		yield* Effect.logInfo('Slack automation deleted').pipe(
			Effect.annotateLogs({ automationId: input.id, organizationId: context.auth.organizationId }),
		)
		return { success: true }
	})
