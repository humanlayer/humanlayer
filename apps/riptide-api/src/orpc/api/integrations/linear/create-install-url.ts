import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

/**
 * Mints the one-time OAuth state row and returns Linear's consent URL.
 *
 * Stays on `apiBaseForOrganizationAdmin`, but the admin check now happens *before* the user
 * sees Linear's consent screen rather than after — a member no longer completes consent only
 * to be told `FORBIDDEN`. The onboarding "tracker connected" milestone moved to the callback
 * route, where the exchange actually succeeds.
 */
export const createLinearInstallUrlProcedure = apiBaseForOrganizationAdmin.integrations.linear.createInstallUrl.handler(
	async ({ input, context, errors }) => {
		const {
			auth,
			services: { linear },
		} = context
		try {
			return await linear.createInstallUrl({
				organizationId: auth.organizationId,
				requestedByUserId: auth.userId,
				client: input.client,
			})
		} catch (error) {
			logger.error(error, 'Failed to create Linear install URL')
			Sentry.captureException(error, { tags: { error_type: 'linear_install_url' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
