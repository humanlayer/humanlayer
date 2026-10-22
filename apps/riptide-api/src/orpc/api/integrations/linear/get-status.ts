import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { apiBaseOrgRequired } from '../../../base'

export const getLinearStatusProcedure = apiBaseOrgRequired.integrations.linear.getStatus.handler(
	async ({ context, errors }) => {
		const {
			auth,
			services: { linear },
		} = context
		try {
			return await linear.getIntegrationStatus(auth.organizationId)
		} catch (error) {
			logger.error(error, 'Failed to get Linear integration status')
			Sentry.captureException(error, { tags: { error_type: 'linear_get_status' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
