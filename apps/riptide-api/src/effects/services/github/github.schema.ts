import * as Schema from 'effect/Schema'

export const GitHubDecimalId = Schema.String.check(Schema.isPattern(/^\d+$/))
export type GitHubDecimalId = typeof GitHubDecimalId.Type

export const GitHubPermissionLevel = Schema.Literals(['read', 'write'])
export type GitHubPermissionLevel = typeof GitHubPermissionLevel.Type

/**
 * The permission slugs the GitHub App asks for. Decoding keeps these and drops the rest, so a
 * slug GitHub adds to the payload costs the connection nothing; the persisted twin in
 * `@humanlayer/db` reads a stored grant back under the same rule.
 */
export const GitHubInstallationPermissions = Schema.Struct({
	contents: Schema.optionalKey(GitHubPermissionLevel),
	issues: Schema.optionalKey(GitHubPermissionLevel),
	pull_requests: Schema.optionalKey(GitHubPermissionLevel),
	metadata: Schema.optionalKey(GitHubPermissionLevel),
	checks: Schema.optionalKey(GitHubPermissionLevel),
	statuses: Schema.optionalKey(GitHubPermissionLevel),
	issue_fields: Schema.optionalKey(GitHubPermissionLevel),
	issue_types: Schema.optionalKey(GitHubPermissionLevel),
	members: Schema.optionalKey(GitHubPermissionLevel),
})
export interface GitHubInstallationPermissions extends Schema.Schema.Type<typeof GitHubInstallationPermissions> {}

export const GitHubAccount = Schema.Struct({
	id: GitHubDecimalId,
	login: Schema.NonEmptyString,
	type: Schema.Literals(['Organization', 'User']),
})
export interface GitHubAccount extends Schema.Schema.Type<typeof GitHubAccount> {}

export const GitHubInstallation = Schema.Struct({
	id: GitHubDecimalId,
	account: GitHubAccount,
	repositorySelection: Schema.Literals(['all', 'selected']),
	permissions: GitHubInstallationPermissions,
})
export interface GitHubInstallation extends Schema.Schema.Type<typeof GitHubInstallation> {}

export const GitHubInstallationToken = Schema.Struct({
	token: Schema.String,
	expiresAt: Schema.Number,
})
export interface GitHubInstallationToken extends Schema.Schema.Type<typeof GitHubInstallationToken> {}

export const GitHubRepository = Schema.Struct({
	id: GitHubDecimalId,
	ownerLogin: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	fullName: Schema.NonEmptyString,
	private: Schema.Boolean,
	defaultBranch: Schema.String,
	archived: Schema.Boolean,
})
export interface GitHubRepository extends Schema.Schema.Type<typeof GitHubRepository> {}

export const GitHubTicketIdentity = Schema.Struct({
	connectionId: Schema.String,
	issueNumber: Schema.Number,
	repositoryId: GitHubDecimalId,
	repositoryFullName: Schema.NonEmptyString,
	url: Schema.String,
})
export interface GitHubTicketIdentity extends Schema.Schema.Type<typeof GitHubTicketIdentity> {}

export const PreparedTicketArtifact = Schema.Struct({
	fileName: Schema.Literal('ticket.md'),
	content: Schema.String,
	contentHash: Schema.String,
})
export interface PreparedTicketArtifact extends Schema.Schema.Type<typeof PreparedTicketArtifact> {}

export const GitHubPreparedImageArtifact = Schema.Struct({
	fileName: Schema.NonEmptyString,
	contentType: Schema.NonEmptyString,
	fileSizeBytes: Schema.Number,
	contentHash: Schema.NonEmptyString,
	s3Key: Schema.NonEmptyString,
})
export interface GitHubPreparedImageArtifact extends Schema.Schema.Type<typeof GitHubPreparedImageArtifact> {}

export const GitHubTextTicketArtifactBundle = Schema.Struct({
	identity: GitHubTicketIdentity,
	ticket: PreparedTicketArtifact,
	images: Schema.Array(GitHubPreparedImageArtifact),
})
export interface GitHubTextTicketArtifactBundle extends Schema.Schema.Type<typeof GitHubTextTicketArtifactBundle> {}

export const GitHubIssueLabelWire = Schema.Struct({
	name: Schema.String,
})

export const GitHubIssueUserWire = Schema.Struct({
	login: Schema.NonEmptyString,
})

export const GitHubIssueWire = Schema.Struct({
	number: Schema.Union([Schema.Number, GitHubDecimalId]),
	title: Schema.String,
	html_url: Schema.String,
	state: Schema.Literals(['open', 'closed']),
	body: Schema.NullOr(Schema.String),
	labels: Schema.Array(GitHubIssueLabelWire),
	assignees: Schema.Array(GitHubIssueUserWire),
	user: Schema.NullOr(GitHubIssueUserWire),
	created_at: Schema.String,
	updated_at: Schema.String,
})
export interface GitHubIssueWire extends Schema.Schema.Type<typeof GitHubIssueWire> {}

export const GitHubIssueCommentWire = Schema.Struct({
	id: GitHubDecimalId,
	html_url: Schema.String,
	body: Schema.NullOr(Schema.String),
	user: Schema.NullOr(GitHubIssueUserWire),
	created_at: Schema.String,
	updated_at: Schema.String,
})
export interface GitHubIssueCommentWire extends Schema.Schema.Type<typeof GitHubIssueCommentWire> {}

export const GitHubInstallationWire = Schema.Struct({
	id: GitHubDecimalId,
	account: Schema.Struct({
		id: GitHubDecimalId,
		login: Schema.NonEmptyString,
		type: Schema.Literals(['Organization', 'User']),
	}),
	repository_selection: Schema.Literals(['all', 'selected']),
	permissions: GitHubInstallationPermissions,
})

export const GitHubInstallationTokenWire = Schema.Struct({
	token: Schema.String,
	expires_at: Schema.String,
})

export const GitHubRepositoryWire = Schema.Struct({
	id: GitHubDecimalId,
	name: Schema.NonEmptyString,
	full_name: Schema.NonEmptyString,
	private: Schema.Boolean,
	default_branch: Schema.String,
	archived: Schema.Boolean,
	owner: Schema.Struct({ login: Schema.NonEmptyString }),
})

export const GitHubInstallationRepositoriesWire = Schema.Struct({
	total_count: GitHubDecimalId,
	repositories: Schema.Array(GitHubRepositoryWire),
})

const isDecimalDigit = (character: string | undefined): character is string =>
	character !== undefined && character >= '0' && character <= '9'

/**
 * JSON.parse rounds integer tokens before a schema can inspect them. GitHub emits
 * IDs as JSON numbers, so preserve every integer lexeme as a string and let the
 * wire schemas decide which fields are decimal IDs or safely-convertible counts.
 */
export const parseGitHubJsonPreservingIntegerLexemes = (json: string): unknown => {
	let transformed = ''
	let index = 0
	let insideString = false
	let escaped = false

	while (index < json.length) {
		const character = json[index]
		if (character === undefined) break

		if (insideString) {
			transformed += character
			if (escaped) escaped = false
			else if (character === '\\') escaped = true
			else if (character === '"') insideString = false
			index += 1
			continue
		}

		if (character === '"') {
			insideString = true
			transformed += character
			index += 1
			continue
		}

		if (character === '-' || isDecimalDigit(character)) {
			const start = index
			if (json[index] === '-') index += 1
			if (json[index] === '0') index += 1
			else while (isDecimalDigit(json[index])) index += 1
			if (json[index] === '.') {
				index += 1
				while (isDecimalDigit(json[index])) index += 1
			}
			if (json[index] === 'e' || json[index] === 'E') {
				index += 1
				if (json[index] === '+' || json[index] === '-') index += 1
				while (isDecimalDigit(json[index])) index += 1
			}

			const numberLexeme = json.slice(start, index)
			transformed += /[.eE]/.test(numberLexeme) ? numberLexeme : JSON.stringify(numberLexeme)
			continue
		}

		transformed += character
		index += 1
	}

	return JSON.parse(transformed)
}
