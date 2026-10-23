import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Entitlements } from '../../../../effects/services/billing/entitlements.service'
import { isInMetricsAudience } from '../../../../effects/services/metrics/metrics-audience'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { isOrganizationAdmin } from '../../../base'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getUserInfoEffectProcedure = effectOrpcBaseOrganizationRequired.auth.user.info.effect(function* ({
	context,
	errors,
}) {
	// services
	const postgres = yield* PostgresDb

	// impl
	const { userId, organizationId } = context.auth

	const [settings] = yield* postgres
		.query(
			postgres.client
				.select({
					commitTrackingEnabled: organizationSettings.commit_tracking_enabled,
					prTrackingEnabled: organizationSettings.pr_tracking_enabled,
					advancedMetricsVisibleToAllMembers: organizationSettings.advanced_metrics_visible_to_all_members,
				})
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, organizationId))
				.limit(1),
		)
		.pipe(
			Effect.tap(() => Effect.logInfo('Fetched user info').pipe(Effect.annotateLogs({ userId, organizationId }))),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	const entitlements = yield* Entitlements
	const advancedMetricsAvailable = yield* entitlements.hasFeature(organizationId, 'advancedMetrics')
	const isAdmin = isOrganizationAdmin(context.auth)

	return {
		userId: context.auth.userId,
		workosOrganizationId: context.auth.workosOrganizationId,
		organizationId: context.auth.organizationId,
		role: context.auth.role,
		roles: context.auth.roles,
		advancedMetricsAvailable,
		advancedMetricsVisible:
			advancedMetricsAvailable &&
			isInMetricsAudience({
				isAdmin,
				visibleToAllMembers: settings?.advancedMetricsVisibleToAllMembers ?? false,
			}),
		commitTrackingEnabled: settings?.commitTrackingEnabled ?? false,
		prTrackingEnabled: settings?.prTrackingEnabled ?? false,
	}
})
