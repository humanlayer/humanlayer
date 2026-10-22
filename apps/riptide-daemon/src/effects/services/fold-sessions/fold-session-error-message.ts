import { Cause } from 'effect'

import { describeUnknownError } from '@/lib/safe-error-display'

const FALLBACK_MESSAGE = 'Fold could not run this session. Check the daemon logs for details.'
const MAX_ERROR_MESSAGE_LENGTH = 500

const normalizeErrorDetail = (detail: string): string =>
	detail
		.replace(/\s*\n\s*/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim()

const actionableFoldFailure = (detail: string): string => {
	if (detail.includes('Invalid EventLog entry input') && detail.includes('["model"]["modelId"]')) {
		return "Fold's model configuration is incompatible with this runtime (missing modelId). Restart Riptide after updating Fold."
	}
	if (detail.includes('No xAI OAuth credentials found')) {
		return 'xAI authentication is required. Run `humanlayer fold auth xai login` on the daemon host, then retry.'
	}
	return detail
}

export const describeFoldPromptFailure = (cause: Cause.Cause<unknown>): string => {
	const detail = actionableFoldFailure(normalizeErrorDetail(describeUnknownError(Cause.squash(cause))))
	if (detail === '' || detail === 'Unknown error') return FALLBACK_MESSAGE

	const message = `Fold could not run this session: ${detail}`
	return message.length <= MAX_ERROR_MESSAGE_LENGTH
		? message
		: `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3).trimEnd()}...`
}
