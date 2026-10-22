import { getOrgSettingsUrl } from '@/utils/artifact-links'

export interface TicketLookupError {
	type: 'lookup'
	message: string
	resolutionHint?: { text: string; url: string; anchorText: string }
}

export function isLookupError(error: { message?: string } | TicketLookupError): error is TicketLookupError {
	return 'type' in error && error.type === 'lookup'
}

export function getTicketLookupError(error: unknown): TicketLookupError | null {
	if (!error || typeof error !== 'object') return null
	const candidate = error as { code?: unknown; data?: unknown }
	if (candidate.code !== 'NOT_FOUND' || !candidate.data || typeof candidate.data !== 'object') return null
	const data = candidate.data as { message?: unknown; resolutionHint?: unknown }
	if (typeof data.message !== 'string') return null
	const hint = data.resolutionHint as { text?: unknown; anchorText?: unknown } | undefined
	const lookupError: TicketLookupError = {
		type: 'lookup',
		message: data.message,
	}
	const url = getOrgSettingsUrl()
	if (hint && typeof hint.text === 'string' && typeof hint.anchorText === 'string' && url) {
		lookupError.resolutionHint = { text: hint.text, url, anchorText: hint.anchorText }
	}
	return lookupError
}
