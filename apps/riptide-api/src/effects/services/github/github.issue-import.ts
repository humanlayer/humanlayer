import { Effect, Redacted } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { hash } from 'ohash'

import { Sentry } from '../../../instrument'
import type { PostgresDb } from '../postgres/postgres-db.service'
import { S3 } from '../s3/s3.service'
import { getOrRefreshGitHubInstallationToken } from './github.auth'
import {
	GitHubConnectionNotFoundError,
	GitHubInstallationSuspendedError,
	GitHubIntegrationDisabledError,
	GitHubIntegrationUnavailableError,
	GitHubIssueInputInvalidError,
	GitHubIssueNotFoundError,
	GitHubMissingPermissionsError,
	GitHubRepositoryNotAccessibleError,
	type GitHubProviderError,
} from './github.errors'
import { prepareGitHubIssueImages } from './github.images'
import { parseGitHubIssueInput } from './github.issue-input'
import { formatGitHubTicketMarkdown } from './github.markdown'
import { checkGitHubCapabilities } from './github.permissions'
import { listGitHubConnections, listGitHubRepositories } from './github.persistence'
import type {
	GitHubIssueCommentWire,
	GitHubIssueWire,
	GitHubRepository,
	GitHubTextTicketArtifactBundle,
} from './github.schema'
import { getIssue } from './procedures/get-issue'
import { listIssueCommentsPage } from './procedures/list-issue-comments'

export interface GitHubIssuePreviewComment {
	readonly id: string
	readonly url: string
	readonly body: string
	readonly authorLogin: string | null
	readonly createdAt: string
	readonly updatedAt: string
}

export interface GitHubIssuePreview {
	readonly repository: GitHubRepository
	readonly issueNumber: number
	readonly title: string
	readonly url: string
	readonly state: 'open' | 'closed'
	readonly body: string
	readonly labels: ReadonlyArray<string>
	readonly assignees: ReadonlyArray<string>
	readonly authorLogin: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly comments: ReadonlyArray<GitHubIssuePreviewComment>
}

export type GitHubIssuePreviewError =
	| GitHubConnectionNotFoundError
	| GitHubRepositoryNotAccessibleError
	| GitHubIntegrationDisabledError
	| GitHubInstallationSuspendedError
	| GitHubMissingPermissionsError
	| GitHubIssueInputInvalidError
	| GitHubIssueNotFoundError
	| GitHubIntegrationUnavailableError

export type GitHubPrepareIssueImportError = GitHubIssuePreviewError

const captureIssueProviderFailure = (error: GitHubProviderError, operation: string, repositoryId: string) =>
	Effect.logError('GitHub issue provider operation failed', error).pipe(
		Effect.annotateLogs({ operation, repository_id: repositoryId }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { integration: 'github', operation },
					extra: { repository_id: repositoryId },
				}),
			),
		),
	)

const narrowIssueProviderFailure = (input: {
	readonly issueNumber: number
	readonly repositoryId: string
	readonly operation: string
}) => ({
	GitHubProviderResponseError: (error: GitHubProviderError & { readonly status: number }) =>
		error.status === 404
			? Effect.fail(new GitHubIssueNotFoundError({ issueNumber: input.issueNumber }))
			: captureIssueProviderFailure(error, input.operation, input.repositoryId).pipe(
					Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
				),
	GitHubProviderTransportError: (error: GitHubProviderError) =>
		captureIssueProviderFailure(error, input.operation, input.repositoryId).pipe(
			Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
		),
	GitHubProviderDecodeError: (error: GitHubProviderError) =>
		captureIssueProviderFailure(error, input.operation, input.repositoryId).pipe(
			Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
		),
})

const listAllIssueComments = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Parameters<typeof listIssueCommentsPage>[0]['installationToken']
	readonly repositoryFullName: string
	readonly repositoryId: string
	readonly issueNumber: number
}): Effect.Effect<
	ReadonlyArray<GitHubIssueCommentWire>,
	GitHubIssueNotFoundError | GitHubIntegrationUnavailableError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const comments: Array<GitHubIssueCommentWire> = []
		let page = 1
		while (true) {
			const pageComments = yield* listIssueCommentsPage({ ...input, page, perPage: 100 }).pipe(
				Effect.catchTags(
					narrowIssueProviderFailure({
						issueNumber: input.issueNumber,
						repositoryId: input.repositoryId,
						operation: 'list_issue_comments',
					}),
				),
			)
			comments.push(...pageComments)
			if (pageComments.length < 100) return comments
			page += 1
		}
	}).pipe(Effect.withSpan('github.list_all_issue_comments'))

const projectIssuePreview = (
	repository: GitHubRepository,
	issue: GitHubIssueWire,
	comments: ReadonlyArray<GitHubIssueCommentWire>,
): GitHubIssuePreview => ({
	repository,
	issueNumber: Number(issue.number),
	title: issue.title,
	url: issue.html_url,
	state: issue.state,
	body: issue.body ?? '',
	labels: issue.labels.map((label) => label.name),
	assignees: issue.assignees.map((assignee) => assignee.login),
	authorLogin: issue.user?.login ?? null,
	createdAt: issue.created_at,
	updatedAt: issue.updated_at,
	comments: comments.map((comment) => ({
		id: comment.id,
		url: comment.html_url,
		body: comment.body ?? '',
		authorLogin: comment.user?.login ?? null,
		createdAt: comment.created_at,
		updatedAt: comment.updated_at,
	})),
})

export const getGitHubIssuePreview = (input: {
	readonly organizationId: string
	readonly connectionId: string
	readonly repositoryId: string
	readonly issueInput: string
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<GitHubIssuePreview, GitHubIssuePreviewError, PostgresDb | HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const parsedInput = yield* parseGitHubIssueInput(input.issueInput)
		const connectionCollection = yield* listGitHubConnections(input.organizationId)
		if (!connectionCollection.enabled) return yield* Effect.fail(new GitHubIntegrationDisabledError())

		const connection = connectionCollection.connections.find((candidate) => candidate.id === input.connectionId)
		if (!connection) {
			return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: input.connectionId }))
		}
		if (connection.status === 'suspended') {
			return yield* Effect.fail(
				new GitHubInstallationSuspendedError({
					connectionId: input.connectionId,
					suspendedAt: connection.suspendedAt,
					suspendedByLogin: connection.suspendedByLogin,
				}),
			)
		}

		const missing = checkGitHubCapabilities(connection.permissions, ['previewIssue'])
		if (missing.length > 0) {
			return yield* Effect.fail(new GitHubMissingPermissionsError({ missing, detectedBy: 'installation_grant' }))
		}

		const repositories = yield* listGitHubRepositories({
			organizationId: input.organizationId,
			connectionId: input.connectionId,
		})
		const repository = repositories.find((candidate) => candidate.id === input.repositoryId)
		if (!repository || repository.archived) {
			return yield* Effect.fail(new GitHubRepositoryNotAccessibleError({ repositoryId: input.repositoryId }))
		}
		if (
			parsedInput.repositoryFullName !== null &&
			parsedInput.repositoryFullName.toLowerCase() !== repository.fullName.toLowerCase()
		) {
			return yield* Effect.fail(new GitHubIssueInputInvalidError({ reason: 'repository_mismatch' }))
		}

		const installationToken = yield* getOrRefreshGitHubInstallationToken({
			organizationId: input.organizationId,
			connectionId: input.connectionId,
			apiBaseUrl: input.apiBaseUrl,
			issuer: input.issuer,
			signingKey: input.signingKey,
		})
		const issue = yield* getIssue({
			apiBaseUrl: input.apiBaseUrl,
			installationToken,
			repositoryFullName: repository.fullName,
			issueNumber: parsedInput.issueNumber,
		}).pipe(
			Effect.catchTags(
				narrowIssueProviderFailure({
					issueNumber: parsedInput.issueNumber,
					repositoryId: input.repositoryId,
					operation: 'get_issue',
				}),
			),
		)
		const comments = yield* listAllIssueComments({
			apiBaseUrl: input.apiBaseUrl,
			installationToken,
			repositoryFullName: repository.fullName,
			repositoryId: repository.id,
			issueNumber: parsedInput.issueNumber,
		})
		return projectIssuePreview(repository, issue, comments)
	}).pipe(
		Effect.withSpan('github.get_issue_preview', {
			attributes: {
				organization_id: input.organizationId,
				connection_id: input.connectionId,
				repository_id: input.repositoryId,
			},
		}),
	)

export const prepareGitHubIssueImport = (input: {
	readonly organizationId: string
	readonly taskId: string
	readonly importAttemptId: string
	readonly connectionId: string
	readonly repositoryId: string
	readonly issueInput: string
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<
	GitHubTextTicketArtifactBundle,
	GitHubPrepareIssueImportError,
	PostgresDb | HttpClient.HttpClient | S3
> =>
	Effect.gen(function* () {
		const issue = yield* getGitHubIssuePreview(input)
		const installationToken = yield* getOrRefreshGitHubInstallationToken({
			organizationId: input.organizationId,
			connectionId: input.connectionId,
			apiBaseUrl: input.apiBaseUrl,
			issuer: input.issuer,
			signingKey: input.signingKey,
		})
		const imageOutcomes = yield* prepareGitHubIssueImages({
			issue,
			taskId: input.taskId,
			organizationId: input.organizationId,
			importAttemptId: input.importAttemptId,
			installationToken: Redacted.value(installationToken),
		})
		const canonicalUrl = `https://github.com/${issue.repository.fullName}/issues/${issue.issueNumber}`
		const content = formatGitHubTicketMarkdown(issue, canonicalUrl, imageOutcomes)
		return {
			identity: {
				connectionId: input.connectionId,
				issueNumber: issue.issueNumber,
				repositoryId: issue.repository.id,
				repositoryFullName: issue.repository.fullName,
				url: canonicalUrl,
			},
			ticket: {
				fileName: 'ticket.md' as const,
				content,
				contentHash: hash(content),
			},
			images: imageOutcomes.flatMap((outcome) => (outcome.artifact ? [outcome.artifact] : [])),
		}
	}).pipe(
		Effect.withSpan('github.prepare_issue_import', {
			attributes: {
				organization_id: input.organizationId,
				task_id: input.taskId,
				connection_id: input.connectionId,
				repository_id: input.repositoryId,
			},
		}),
	)
