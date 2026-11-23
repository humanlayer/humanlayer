import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { apiBaseOrgRequired } from '../../../base'

export const getJiraStatusProcedure = apiBaseOrgRequired.integrations.jira.getStatus.handler(
	async ({ context, errors }) => {
		const {
			auth,
			services: { jira },
		} = context
		if (!jira) {
			return { configured: false, enabled: false, connected: false, needsReauth: false, siteUrl: null }
		}
		try {
			return { ...(await jira.getIntegrationStatus(auth.organizationId)), configured: true }
		} catch (error) {
			logger.error(error, 'Failed to get Jira integration status')
			Sentry.captureException(error, { tags: { error_type: 'jira_get_status' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
