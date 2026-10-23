import { userSettings } from '@humanlayer/db/tables/user-settings'

import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const setAdminUserMetricsAdvancedProcedure =
	apiBaseForOrganizationAdmin.auth.admin.users.setMetricsAdvancedEnabled.handler(
		async ({ context, input, errors }) => {
			const {
				auth,
				services: { db, workos },
			} = context

			// Only members of the caller's org can be targeted — otherwise an admin could
			// seed settings rows for arbitrary user ids.
			const membershipsResult = await workos.userManagement.listOrganizationMemberships({
				userId: input.userId,
				organizationId: auth.workosOrganizationId,
				statuses: ['active', 'inactive'],
				limit: 1,
			})
			const memberships = await membershipsResult.autoPagination()
			if (!memberships[0]) {
				throw errors.USER_NOT_FOUND({ data: { message: 'User not found in organization' } })
			}

			const [row] = await db
				.insert(userSettings)
				.values({
					user_id: input.userId,
					organization_id: auth.organizationId,
					metrics_advanced_enabled: input.enabled,
				})
				.onConflictDoUpdate({
					target: [userSettings.user_id, userSettings.organization_id],
					set: { metrics_advanced_enabled: input.enabled, updated_at: BigInt(Date.now()) },
				})
				.returning()

			if (!row) throw new Error('Failed to upsert user settings')

			logger.info(
				{ organizationId: auth.organizationId, targetUserId: input.userId, enabled: input.enabled },
				'Per-user advanced metrics updated',
			)

			return { userId: input.userId, metricsAdvancedEnabled: row.metrics_advanced_enabled }
		},
	)
