import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../../base'

export const updateLinearIssueStatusProcedure = daemonBase.integrations.linear.updateIssueStatus
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { linear } = context.services
		try {
			return await linear.updateIssueStatus(organizationId, input.issueId, input.statusName)
		} catch (error) {
			logger.error(error, 'Failed to update Linear issue status')
			Sentry.captureException(error, { tags: { error_type: 'linear_update_issue_status' } })
			throw errors.LINEAR_STATUS_FAILED({
				data: { message: error instanceof Error ? error.message : 'Failed to update Linear issue status' },
			})
		}
	})
