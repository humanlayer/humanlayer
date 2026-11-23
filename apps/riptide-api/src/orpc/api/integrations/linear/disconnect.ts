import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { apiBaseForOrganizationAdmin, requiresLinear } from '../../../base'

export const disconnectLinearProcedure = apiBaseForOrganizationAdmin.integrations.linear.disconnect
	.use(requiresLinear)
	.handler(async ({ context, errors }) => {
		const {
			auth,
			services: { linear },
		} = context
		try {
			return await linear.disconnect(auth.organizationId)
		} catch (error) {
			logger.error(error, 'Failed to disconnect Linear integration')
			Sentry.captureException(error, { tags: { error_type: 'linear_disconnect' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	})
