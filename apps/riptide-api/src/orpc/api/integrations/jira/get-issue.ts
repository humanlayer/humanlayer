import * as Sentry from '@sentry/node'

import {
	JiraIntegrationDisabledError,
	JiraIntegrationNotFoundError,
	JiraIssueInputInvalidError,
	JiraIssueNotFoundError,
	JiraProviderUnavailableError,
	JiraReauthRequiredError,
} from '../../../../lib/jira-service'
import logger from '../../../../logger'
import { apiBaseOrgRequired } from '../../../base'

export const getJiraIssueProcedure = apiBaseOrgRequired.integrations.jira.getIssue.handler(
	async ({ input, context, errors }) => {
		const {
			auth,
			services: { jira },
		} = context
		try {
			return await jira.getIssue(auth.organizationId, input.issueKey)
		} catch (error) {
			if (error instanceof JiraIssueInputInvalidError) {
				throw errors.BAD_REQUEST({ data: { message: 'Invalid Jira issue key' } })
			}
			if (error instanceof JiraIntegrationDisabledError) {
				throw errors.BAD_REQUEST({ data: { message: 'Jira is disabled for this organization' } })
			}
			if (error instanceof JiraReauthRequiredError) {
				throw errors.BAD_REQUEST({
					data: { message: 'Jira needs to be reconnected in organization settings' },
				})
			}
			if (error instanceof JiraIntegrationNotFoundError || error instanceof JiraIssueNotFoundError) {
				logger.debug('Jira issue not found: %s', input.issueKey)
				throw errors.NOT_FOUND()
			}
			if (error instanceof JiraProviderUnavailableError) {
				throw errors.SERVICE_UNAVAILABLE({ data: { message: 'Jira is temporarily unavailable' } })
			}
			logger.error(error, 'Failed to get Jira issue')
			Sentry.captureException(error, { tags: { error_type: 'jira_get_issue' } })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
