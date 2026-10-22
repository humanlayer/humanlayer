import * as Sentry from '@sentry/node'

import logger from '../../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../../base'

export const createLinearAttachmentProcedure = daemonBase.integrations.linear.createAttachment
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { linear } = context.services
		try {
			return await linear.createAttachment(organizationId, input.issueId, input.url, input.title)
		} catch (error) {
			logger.error(error, 'Failed to create Linear attachment')
			Sentry.captureException(error, { tags: { error_type: 'linear_create_attachment' } })
			throw errors.LINEAR_ATTACHMENT_FAILED({
				data: { message: error instanceof Error ? error.message : 'Failed to create Linear attachment' },
			})
		}
	})
