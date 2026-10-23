import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'
import { mapSlackAutomation } from './automation-mapper'

export const listSlackAutomationsProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.slack.listAutomations.effect(function* ({ context, errors }) {
		const Postgres = yield* PostgresDb
		const rows = yield* Postgres.query(
			Postgres.client
				.select()
				.from(slackNotificationAutomations)
				.where(eq(slackNotificationAutomations.organization_id, context.auth.organizationId)),
		).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({ PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors) }),
		)
		return { automations: rows.map(mapSlackAutomation) }
	})
