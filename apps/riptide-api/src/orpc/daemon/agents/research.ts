import { researchDocumentation } from '@humanlayer/ai/doc-researcher'
import * as Sentry from '@sentry/node'

import { createRiptideReliableLanguageModel } from '../../../lib/reliable-language-model'
import logger from '../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../base'

export const researchProcedure = daemonBase.agents.research
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { question, packageName, language } = input
		const { userId, organizationId, hostId } = context.auth

		return await Sentry.withScope(async (scope) => {
			scope.setTag('operation', 'documentation_research')
			scope.setContext('research', { packageName, userId, organizationId, hostId })

			try {
				logger.info({ packageName, question, userId, organizationId }, 'Starting documentation research')

				const result = await researchDocumentation(
					{ question, packageName, language },
					{ model: createRiptideReliableLanguageModel('sonnet') },
				)

				logger.info({ packageName, resultType: result.type }, 'Documentation research completed')

				return {
					success: result.type === 'answer',
					response: result.type === 'answer' ? result.content : result.message,
				}
			} catch (error) {
				logger.error({ error, packageName }, 'Documentation research failed')
				Sentry.captureException(error)
				throw errors.INTERNAL_SERVER_ERROR()
			}
		})
	})
