import { Effect } from 'effect'
import * as Schema from 'effect/Schema'

import { GitHubIssueInputInvalidError } from './github.errors'

const RawGitHubIssueInput = Schema.String
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/
const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/i

export interface ParsedGitHubIssueInput {
	readonly issueNumber: number
	readonly repositoryFullName: string | null
}

export const parseGitHubIssueInput = (
	input: unknown,
): Effect.Effect<ParsedGitHubIssueInput, GitHubIssueInputInvalidError> =>
	Effect.gen(function* () {
		const rawInput = yield* Schema.decodeUnknownEffect(RawGitHubIssueInput)(input).pipe(
			Effect.mapError(() => new GitHubIssueInputInvalidError({ reason: 'invalid_format' })),
		)
		const trimmedInput = rawInput.trim()
		if (ISSUE_NUMBER_PATTERN.test(trimmedInput)) {
			const issueNumber = Number(trimmedInput)
			if (!Number.isSafeInteger(issueNumber)) {
				return yield* Effect.fail(new GitHubIssueInputInvalidError({ reason: 'invalid_format' }))
			}
			const parsedInput: ParsedGitHubIssueInput = { issueNumber, repositoryFullName: null }
			return parsedInput
		}

		const urlMatch = GITHUB_ISSUE_URL_PATTERN.exec(trimmedInput)
		if (!urlMatch) return yield* Effect.fail(new GitHubIssueInputInvalidError({ reason: 'invalid_format' }))
		const owner = urlMatch[1]
		const repository = urlMatch[2]
		const issueNumberText = urlMatch[3]
		if (!owner || !repository || !issueNumberText) {
			return yield* Effect.fail(new GitHubIssueInputInvalidError({ reason: 'invalid_format' }))
		}
		const issueNumber = Number(issueNumberText)
		if (!Number.isSafeInteger(issueNumber)) {
			return yield* Effect.fail(new GitHubIssueInputInvalidError({ reason: 'invalid_format' }))
		}
		const parsedInput: ParsedGitHubIssueInput = {
			issueNumber,
			repositoryFullName: `${owner}/${repository}`,
		}
		return parsedInput
	}).pipe(Effect.withSpan('github.parse_issue_input'))
