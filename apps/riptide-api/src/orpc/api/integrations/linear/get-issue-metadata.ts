import * as Sentry from '@sentry/node'

import { LinearIssueUnavailableError } from '../../../../lib/linear-service'
import logger from '../../../../logger'
import { apiBaseOrgRequired } from '../../../base'

const unavailableIssueData = (issueId: string) => ({
	message: `Couldn't load Linear ticket ${issueId.toUpperCase()}. It may not exist, or the Linear integration may not have access to its team/subteam.`,
	resolutionHint: { text: 'Check your Linear integration', anchorText: 'settings' },
})

export const getLinearIssueMetadataProcedure = apiBaseOrgRequired.integrations.linear.getIssueMetadata.handler(
	async ({ input, context, errors }) => {
		const {
			auth,
			services: { linear },
		} = context
		try {
			return await linear.getIssueMetadata(auth.organizationId, input.issueId)
		} catch (error) {
			logger.error(error, 'Failed to get Linear issue metadata')
			Sentry.captureException(error, { tags: { error_type: 'linear_get_issue_metadata' } })
			if (error instanceof LinearIssueUnavailableError) {
				throw errors.NOT_FOUND({ data: unavailableIssueData(error.issueId) })
			}
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
