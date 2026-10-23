import { generateTaskSummary } from '@humanlayer/ai/generate-task-summary'
import * as Sentry from '@sentry/node'

import { createRiptideReliableLanguageModel } from '../../../lib/reliable-language-model'
import { apiBaseOrgRequired } from '../../base'

export const generateTitleProcedure = apiBaseOrgRequired.ai.generateTitle.handler(async ({ input, errors }) => {
	try {
		const title = await generateTaskSummary(input.text, { model: createRiptideReliableLanguageModel('haiku') })
		return { title }
	} catch (error) {
		Sentry.captureException(error)
		throw errors.INTERNAL_SERVER_ERROR()
	}
})
