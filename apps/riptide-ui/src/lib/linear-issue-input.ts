import z from 'zod/v4'

const LINEAR_ISSUE_INPUT_ERROR = 'Enter a Linear issue ID or URL'

export type ParsedLinearIssueInput =
	| { ok: true; issueId: string; source: 'identifier' | 'url' }
	| { ok: false; message: string }

export const LinearIssueIdentifierSchema = z
	.string()
	.trim()
	.regex(/^[A-Z0-9][A-Z0-9-]*-\d+$/i, LINEAR_ISSUE_INPUT_ERROR)

const LinearIssueUrlSchema = z
	.string()
	.trim()
	.url(LINEAR_ISSUE_INPUT_ERROR)
	.transform((value, ctx) => {
		const url = new URL(value)
		const segments = url.pathname.split('/').filter(Boolean)
		const issueId = segments[2]

		if (url.protocol !== 'https:' || url.hostname !== 'linear.app' || segments[1] !== 'issue' || !issueId) {
			ctx.addIssue({ code: 'custom', message: LINEAR_ISSUE_INPUT_ERROR })
			return z.NEVER
		}

		const identifier = LinearIssueIdentifierSchema.safeParse(issueId)
		if (!identifier.success) {
			ctx.addIssue({ code: 'custom', message: LINEAR_ISSUE_INPUT_ERROR })
			return z.NEVER
		}

		return identifier.data
	})

export const LinearIssueInputSchema = z
	.string()
	.trim()
	.transform((value, ctx) => {
		if (!value) {
			ctx.addIssue({ code: 'custom', message: LINEAR_ISSUE_INPUT_ERROR })
			return z.NEVER
		}

		const source: 'identifier' | 'url' = looksLikeUrl(value) ? 'url' : 'identifier'
		const parsed =
			source === 'url' ? LinearIssueUrlSchema.safeParse(value) : LinearIssueIdentifierSchema.safeParse(value)

		if (!parsed.success) {
			ctx.addIssue({ code: 'custom', message: LINEAR_ISSUE_INPUT_ERROR })
			return z.NEVER
		}

		return { issueId: parsed.data, source }
	})

function looksLikeUrl(value: string): boolean {
	try {
		new URL(value)
		return true
	} catch {
		return false
	}
}

export function parseLinearIssueInput(value: string): ParsedLinearIssueInput {
	const parsed = LinearIssueInputSchema.safeParse(value)
	if (!parsed.success) {
		return { ok: false, message: LINEAR_ISSUE_INPUT_ERROR }
	}

	return { ok: true, issueId: parsed.data.issueId, source: parsed.data.source }
}
