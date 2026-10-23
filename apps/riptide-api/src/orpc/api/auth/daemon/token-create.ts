import { createSignedDaemonToken } from '../../../../auth/daemon-tokens'
import logger from '../../../../logger'
import { apiBaseOrgRequired, requiresBillingMiddleware } from '../../../base'

export const createDaemonTokenProcedure = apiBaseOrgRequired.auth.daemon.token.create
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		try {
			const token = await createSignedDaemonToken(context.auth.userId, context.auth.organizationId, input.hostId)
			return { token }
		} catch (error) {
			logger.error(error)
			throw errors.INTERNAL_SERVER_ERROR()
		}
	})
