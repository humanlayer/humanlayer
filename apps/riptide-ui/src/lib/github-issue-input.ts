import z from 'zod/v4'

export type ParsedGitHubIssueInput =
	| { readonly ok: true; readonly issueNumber: number; readonly repositoryFullName: string | null }
	| { readonly ok: false; readonly message: string }

const GITHUB_ISSUE_INPUT_ERROR = 'Enter a valid GitHub issue number or URL.'
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/
const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/i

export const GitHubIssueInputSchema = z
	.string()
	.trim()
	.transform((input, ctx) => {
		if (ISSUE_NUMBER_PATTERN.test(input)) {
			const issueNumber = Number(input)
			if (Number.isSafeInteger(issueNumber)) {
				return { issueNumber, repositoryFullName: null }
			}
		}

		const urlMatch = GITHUB_ISSUE_URL_PATTERN.exec(input)
		const owner = urlMatch?.[1]
		const repository = urlMatch?.[2]
		const issueNumberText = urlMatch?.[3]
		if (owner && repository && issueNumberText) {
			const issueNumber = Number(issueNumberText)
			if (Number.isSafeInteger(issueNumber)) {
				return { issueNumber, repositoryFullName: `${owner}/${repository}` }
			}
		}

		ctx.addIssue({ code: 'custom', message: GITHUB_ISSUE_INPUT_ERROR })
		return z.NEVER
	})

export function parseGitHubIssueInput(rawInput: string): ParsedGitHubIssueInput {
	const parsed = GitHubIssueInputSchema.safeParse(rawInput)
	return parsed.success ? { ok: true, ...parsed.data } : { ok: false, message: GITHUB_ISSUE_INPUT_ERROR }
}
