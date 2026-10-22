import logger from '../../../logger'
import { apiBasePublic } from '../../base'

export const refreshTokenProcedure = apiBasePublic.auth.token.refresh.handler(async ({ input, context, errors }) => {
	const { services } = context

	try {
		const result = await services.workos.userManagement.authenticateWithRefreshToken({
			clientId: services.workos.config.clientId,
			refreshToken: input.refreshToken,
			organizationId: input.organizationId,
		})

		return {
			accessToken: result.accessToken,
			refreshToken: result.refreshToken,
		}
	} catch (error) {
		logger.error(error)
		throw errors.BAD_REQUEST({ data: { message: 'Failed to refresh token' } })
	}
})
