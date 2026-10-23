import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../../base'

export const createJiraRemoteLinkProcedure = daemonBase.integrations.jira.createRemoteLink
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { jira } = context.services
		try {
			return await jira.createRemoteLink(organizationId, input.issueKey, input.url, input.title, input.globalId)
		} catch (error) {
			logger.error(error, 'Failed to create Jira remote link')
			Sentry.captureException(error, { tags: { error_type: 'jira_create_remote_link' } })
			throw errors.JIRA_LINK_FAILED({
				data: { message: error instanceof Error ? error.message : 'Failed to create Jira remote link' },
			})
		}
	})
