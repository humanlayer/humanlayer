import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { apiBaseForOrganizationAdmin, requiresJira } from '../../../base'

export const disconnectJiraProcedure = apiBaseForOrganizationAdmin.integrations.jira.disconnect
	.use(requiresJira)
	.handler(async ({ context, errors }) => {
		const {
			auth,
			services: { jira },
		} = context
		try {
			return await jira.disconnect(auth.organizationId)
		} catch (error) {
			logger.error(error, 'Failed to disconnect Jira integration')
			Sentry.captureException(error, { tags: { error_type: 'jira_disconnect' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	})
