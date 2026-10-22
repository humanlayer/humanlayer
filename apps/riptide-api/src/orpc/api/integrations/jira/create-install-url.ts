import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const createJiraInstallUrlProcedure = apiBaseForOrganizationAdmin.integrations.jira.createInstallUrl.handler(
	async ({ input, context, errors }) => {
		const {
			auth,
			services: { jira },
		} = context
		try {
			return await jira.createInstallUrl({
				organizationId: auth.organizationId,
				requestedByUserId: auth.userId,
				client: input.client,
			})
		} catch (error) {
			logger.error(error, 'Failed to create Jira install URL')
			Sentry.captureException(error, { tags: { error_type: 'jira_install_url' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
