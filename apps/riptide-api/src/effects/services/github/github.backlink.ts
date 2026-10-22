import { artifacts } from '@humanlayer/db/tables/artifacts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'

import { Sentry } from '../../../instrument'
import { PostgresDb } from '../postgres/postgres-db.service'
import { getOrRefreshGitHubInstallationToken } from './github.auth'
import {
	GitHubConnectionNotFoundError,
	GitHubInstallationSuspendedError,
	GitHubIntegrationDisabledError,
	GitHubIntegrationUnavailableError,
	GitHubIssueInputInvalidError,
	GitHubMissingPermissionsError,
	GitHubRepositoryNotAccessibleError,
	GitHubTaskNotFoundError,
	type GitHubProviderError,
} from './github.errors'
import { checkGitHubCapabilities } from './github.permissions'
import { listGitHubConnections, listGitHubRepositories } from './github.persistence'
import type { GitHubIssueCommentWire } from './github.schema'
import { createIssueComment } from './procedures/create-issue-comment'
import { listIssueCommentsPage } from './procedures/list-issue-comments'
import { updateIssueComment } from './procedures/update-issue-comment'

export const githubTaskMarker = (taskId: string): string => `<!-- humanlayer-task:${taskId} -->`

export const commentContainsExactGitHubTaskMarker = (body: string | null, taskId: string): boolean => {
	if (body === null) return false
	const marker = githubTaskMarker(taskId)
	return body.split('\n').some((line) => line.trim() === marker)
}

export interface GitHubBacklinkArtifact {
	readonly id: string
	readonly fileName: string
}

const artifactDisplayName = (fileName: string): string => {
	const withoutExtension = fileName.replace(/\.[^.]+$/, '')
	return withoutExtension
		.split(/[-_]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(' ')
}

export const renderGitHubArtifactBacklink = (input: {
	readonly taskId: string
	readonly cloudOrigin: string
	readonly artifacts: ReadonlyArray<GitHubBacklinkArtifact>
}): string => {
	const base = input.cloudOrigin.replace(/\/+$/, '')
	const artifactLines = input.artifacts.map(
		(artifact) =>
			`- [${artifactDisplayName(artifact.fileName)}](${base}/artifacts/${encodeURIComponent(artifact.id)})`,
	)
	const sections = ['This issue is being worked on in HumanLayer.']
	if (artifactLines.length > 0) sections.push(`Artifacts:\n${artifactLines.join('\n')}`)
	sections.push(githubTaskMarker(input.taskId))
	return sections.join('\n\n')
}

const captureBacklinkFailure = (error: unknown, taskId: string, operation: string) =>
	Effect.logError('GitHub artifact backlink operation failed', error).pipe(
		Effect.annotateLogs({ task_id: taskId, operation }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { integration: 'github', operation },
					extra: { task_id: taskId },
				}),
			),
		),
	)

const narrowProviderFailure = (taskId: string, operation: string) => ({
	GitHubProviderResponseError: (error: GitHubProviderError) =>
		captureBacklinkFailure(error, taskId, operation).pipe(
			Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
		),
	GitHubProviderTransportError: (error: GitHubProviderError) =>
		captureBacklinkFailure(error, taskId, operation).pipe(
			Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
		),
	GitHubProviderDecodeError: (error: GitHubProviderError) =>
		captureBacklinkFailure(error, taskId, operation).pipe(
			Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
		),
})

const listAllIssueComments = (input: {
	readonly taskId: string
	readonly apiBaseUrl: URL
	readonly installationToken: Parameters<typeof listIssueCommentsPage>[0]['installationToken']
	readonly repositoryFullName: string
	readonly issueNumber: number
}): Effect.Effect<ReadonlyArray<GitHubIssueCommentWire>, GitHubIntegrationUnavailableError, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const comments: Array<GitHubIssueCommentWire> = []
		for (let page = 1; ; page += 1) {
			const pageComments = yield* listIssueCommentsPage({ ...input, page, perPage: 100 }).pipe(
				Effect.catchTags(narrowProviderFailure(input.taskId, 'list_issue_comments')),
			)
			comments.push(...pageComments)
			if (pageComments.length < 100) return comments
		}
	}).pipe(Effect.withSpan('github.backlink.list_all_issue_comments'))

export const syncGitHubArtifactBacklink = (input: {
	readonly organizationId: string
	readonly userId: string
	readonly taskId: string
	readonly cloudOrigin: string
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<
	void,
	| GitHubTaskNotFoundError
	| GitHubConnectionNotFoundError
	| GitHubRepositoryNotAccessibleError
	| GitHubIntegrationDisabledError
	| GitHubInstallationSuspendedError
	| GitHubMissingPermissionsError
	| GitHubIssueInputInvalidError
	| GitHubIntegrationUnavailableError,
	PostgresDb | HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [task] = yield* postgres
			.query(
				postgres.client
					.select({
						id: tasks.id,
						connectionId: tasks.github_connection_id,
						repositoryId: tasks.ticket_repository_id,
						issueNumber: tasks.ticket_id,
					})
					.from(tasks)
					.where(
						and(
							eq(tasks.id, input.taskId),
							eq(tasks.organization_id, input.organizationId),
							eq(tasks.resource_owner_user_id, input.userId),
							eq(tasks.ticket_provider, 'github'),
						),
					)
					.limit(1),
			)
			.pipe(
				Effect.catchTag('PostgresDbQueryError', (error) =>
					captureBacklinkFailure(error, input.taskId, 'resolve_backlink_task').pipe(
						Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
					),
				),
			)
		if (!task || task.connectionId === null || task.repositoryId === null || task.issueNumber === null) {
			return yield* Effect.fail(new GitHubTaskNotFoundError({ taskId: input.taskId }))
		}
		const issueNumber = Number(task.issueNumber)
		if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
			return yield* Effect.fail(new GitHubIssueInputInvalidError({ reason: 'invalid_format' }))
		}

		const connectionCollection = yield* listGitHubConnections(input.organizationId)
		if (!connectionCollection.enabled) return yield* Effect.fail(new GitHubIntegrationDisabledError())
		const connection = connectionCollection.connections.find((candidate) => candidate.id === task.connectionId)
		if (!connection) {
			return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: task.connectionId }))
		}
		if (connection.status === 'suspended') {
			return yield* Effect.fail(
				new GitHubInstallationSuspendedError({
					connectionId: connection.id,
					suspendedAt: connection.suspendedAt,
					suspendedByLogin: connection.suspendedByLogin,
				}),
			)
		}
		const missing = checkGitHubCapabilities(connection.permissions, ['writeBacklink'])
		if (missing.length > 0) {
			return yield* Effect.fail(new GitHubMissingPermissionsError({ missing, detectedBy: 'installation_grant' }))
		}

		const repositories = yield* listGitHubRepositories({
			organizationId: input.organizationId,
			connectionId: connection.id,
		})
		const repository = repositories.find((candidate) => candidate.id === task.repositoryId)
		if (!repository || repository.archived) {
			return yield* Effect.fail(new GitHubRepositoryNotAccessibleError({ repositoryId: task.repositoryId }))
		}
		const artifactRows = yield* postgres
			.query(
				postgres.client
					.select({ id: artifacts.id, fileName: artifacts.file_name })
					.from(artifacts)
					.where(
						and(
							eq(artifacts.task_id, task.id),
							eq(artifacts.organization_id, input.organizationId),
							eq(artifacts.is_deleted, false),
						),
					)
					.orderBy(asc(artifacts.file_name), asc(artifacts.id)),
			)
			.pipe(
				Effect.catchTag('PostgresDbQueryError', (error) =>
					captureBacklinkFailure(error, input.taskId, 'list_backlink_artifacts').pipe(
						Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
					),
				),
			)
		const commentBody = renderGitHubArtifactBacklink({
			taskId: task.id,
			cloudOrigin: input.cloudOrigin,
			artifacts: artifactRows,
		})
		const installationToken = yield* getOrRefreshGitHubInstallationToken({
			organizationId: input.organizationId,
			connectionId: connection.id,
			apiBaseUrl: input.apiBaseUrl,
			issuer: input.issuer,
			signingKey: input.signingKey,
		})
		const comments = yield* listAllIssueComments({
			taskId: task.id,
			apiBaseUrl: input.apiBaseUrl,
			installationToken,
			repositoryFullName: repository.fullName,
			issueNumber,
		})
		const markedComments = comments
			.filter((comment) => commentContainsExactGitHubTaskMarker(comment.body, task.id))
			.toSorted(
				(left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
			)
		if (markedComments.length > 1) {
			yield* Effect.logWarning('Duplicate GitHub task backlink comments found').pipe(
				Effect.annotateLogs({ task_id: task.id, duplicate_count: markedComments.length }),
			)
		}
		const existingComment = markedComments[0]
		if (existingComment) {
			yield* updateIssueComment({
				apiBaseUrl: input.apiBaseUrl,
				installationToken,
				repositoryFullName: repository.fullName,
				commentId: existingComment.id,
				body: commentBody,
			}).pipe(Effect.catchTags(narrowProviderFailure(task.id, 'update_issue_comment')))
		} else {
			yield* createIssueComment({
				apiBaseUrl: input.apiBaseUrl,
				installationToken,
				repositoryFullName: repository.fullName,
				issueNumber,
				body: commentBody,
			}).pipe(Effect.catchTags(narrowProviderFailure(task.id, 'create_issue_comment')))
		}
	}).pipe(
		Effect.withSpan('github.sync_artifact_backlink', {
			attributes: { organization_id: input.organizationId, task_id: input.taskId },
		}),
	)
