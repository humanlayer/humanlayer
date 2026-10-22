import { call } from '@orpc/server'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	GitHubConnectionNotFoundError,
	GitHubDisconnectFailedError,
} from '../../src/effects/services/github/github.errors'
import { GitHubService } from '../../src/effects/services/github/github.service'
import { createGitHubInstallUrlProcedure as liveCreateInstallUrlProcedure } from '../../src/orpc/api/integrations/github/create-install-url.effect'
import { disconnectGitHubProcedure as liveDisconnectProcedure } from '../../src/orpc/api/integrations/github/disconnect.effect'
import { getGitHubConnectionProcedure as liveGetConnectionProcedure } from '../../src/orpc/api/integrations/github/get-connection.effect'
import { getGitHubIssuePreviewProcedure as liveGetIssuePreviewProcedure } from '../../src/orpc/api/integrations/github/get-issue-preview.effect'
import { listGitHubConnectionsProcedure as liveListConnectionsProcedure } from '../../src/orpc/api/integrations/github/list-connections.effect'
import { listGitHubRepositoriesProcedure as liveListRepositoriesProcedure } from '../../src/orpc/api/integrations/github/list-repositories.effect'
import { refreshGitHubConnectionProcedure as liveRefreshConnectionProcedure } from '../../src/orpc/api/integrations/github/refresh-connection.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'

describe('GitHub integration procedures', () => {
	const organizationId = '019f536c-b021-763a-84b2-bbd8ee8e2913'
	const connectionId = '019f536c-b021-763a-84b2-bbd8ee8e2914'
	const failingConnectionId = '019f536c-b021-763a-84b2-bbd8ee8e2915'
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let createInstallUrlProcedure: typeof liveCreateInstallUrlProcedure
	let listConnectionsProcedure: typeof liveListConnectionsProcedure
	let getConnectionProcedure: typeof liveGetConnectionProcedure
	let getIssuePreviewProcedure: typeof liveGetIssuePreviewProcedure
	let listRepositoriesProcedure: typeof liveListRepositoriesProcedure
	let refreshConnectionProcedure: typeof liveRefreshConnectionProcedure
	let disconnectProcedure: typeof liveDisconnectProcedure

	const connection = {
		id: connectionId,
		accountId: '9007199254740990',
		accountLogin: 'humanlayer',
		accountType: 'Organization' as const,
		repositorySelection: 'selected' as const,
		repositoryCount: 1,
		permissions: { metadata: 'read' as const, issues: 'write' as const },
		status: 'active' as const,
		needsReauth: false,
		suspendedAt: null,
		suspendedByLogin: null,
		managementUrl: 'https://github.com/organizations/humanlayer/settings/installations/42',
		capabilities: {
			listRepositories: true,
			previewIssue: true,
			writeBacklink: true,
			readContents: false,
			writeContents: false,
			readPullRequests: false,
			writePullRequests: false,
			readChecks: false,
			readCommitStatuses: false,
		},
		lastReconciledAt: 1_752_688_800_000,
	}

	beforeAll(() => {
		runtime = createRuntimeWithTestPostgresLayer({} as never, {
			github: Layer.succeed(GitHubService, {
				createInstallUrl: ({ organizationId: requestedOrganizationId, requestedByUserId }) =>
					Effect.succeed({
						url: `https://github.test/install?org=${requestedOrganizationId}&user=${requestedByUserId}`,
						expiresAt: 123,
					}),
				completeInstallation: () => Effect.die('completeInstallation not used'),
				mutatePullRequest: () => Effect.die('mutatePullRequest not used'),
				listConnections: ({ organizationId: requestedOrganizationId }) =>
					Effect.succeed({ enabled: requestedOrganizationId === organizationId, connections: [connection] }),
				getConnection: ({ organizationId: requestedOrganizationId, connectionId: requestedConnectionId }) =>
					requestedOrganizationId === organizationId && requestedConnectionId === connectionId
						? Effect.succeed(connection)
						: Effect.fail(new GitHubConnectionNotFoundError({ connectionId: requestedConnectionId })),
				listRepositories: ({ organizationId: requestedOrganizationId, connectionId: requestedConnectionId }) =>
					requestedOrganizationId === organizationId && requestedConnectionId === connectionId
						? Effect.succeed([
								{
									id: '101',
									ownerLogin: 'humanlayer',
									name: 'riptide',
									fullName: 'humanlayer/riptide',
									private: true,
									defaultBranch: 'main',
									archived: false,
								},
							])
						: Effect.fail(new GitHubConnectionNotFoundError({ connectionId: requestedConnectionId })),
				getIssuePreview: ({
					organizationId: requestedOrganizationId,
					connectionId: requestedConnectionId,
					repositoryId,
					issueInput,
				}) =>
					requestedOrganizationId === organizationId &&
					requestedConnectionId === connectionId &&
					repositoryId === '101'
						? Effect.succeed({
								repository: {
									id: '101',
									ownerLogin: 'humanlayer',
									name: 'riptide',
									fullName: 'humanlayer/riptide',
									private: true,
									defaultBranch: 'main',
									archived: false,
								},
								issueNumber: Number(issueInput),
								title: 'Preview issue',
								url: 'https://github.com/humanlayer/riptide/issues/42',
								state: 'open' as const,
								body: 'Issue body',
								labels: ['integration'],
								assignees: ['octocat'],
								authorLogin: 'mona',
								createdAt: '2026-07-17T00:00:00Z',
								updatedAt: '2026-07-17T00:00:00Z',
								comments: [],
							})
						: Effect.fail(new GitHubConnectionNotFoundError({ connectionId: requestedConnectionId })),
				prepareIssueImport: () => Effect.die('prepareIssueImport not used'),
				syncArtifactBacklink: () => Effect.die('syncArtifactBacklink not used'),
				refreshConnection: ({ organizationId: requestedOrganizationId, connectionId: requestedConnectionId }) =>
					requestedOrganizationId === organizationId && requestedConnectionId === connectionId
						? Effect.succeed(connection)
						: Effect.fail(new GitHubConnectionNotFoundError({ connectionId: requestedConnectionId })),
				disconnect: ({ organizationId: requestedOrganizationId, connectionId: requestedConnectionId }) => {
					if (requestedOrganizationId !== organizationId) {
						return Effect.fail(new GitHubConnectionNotFoundError({ connectionId: requestedConnectionId }))
					}
					if (requestedConnectionId === failingConnectionId) {
						return Effect.fail(
							new GitHubDisconnectFailedError({
								connectionId: requestedConnectionId,
								cause: 'github_down',
							}),
						)
					}
					return requestedConnectionId === connectionId
						? Effect.succeed({ success: true as const })
						: Effect.fail(new GitHubConnectionNotFoundError({ connectionId: requestedConnectionId }))
				},
				fetchPullRequest: () => Effect.die('fetchPullRequest not used'),
				verifyWebhook: () => Effect.die('verifyWebhook not used'),
				handleWebhook: () => Effect.void,
			}),
		})
		createInstallUrlProcedure = bindProcedureToRuntime(liveCreateInstallUrlProcedure, runtime)
		listConnectionsProcedure = bindProcedureToRuntime(liveListConnectionsProcedure, runtime)
		getConnectionProcedure = bindProcedureToRuntime(liveGetConnectionProcedure, runtime)
		getIssuePreviewProcedure = bindProcedureToRuntime(liveGetIssuePreviewProcedure, runtime)
		listRepositoriesProcedure = bindProcedureToRuntime(liveListRepositoriesProcedure, runtime)
		refreshConnectionProcedure = bindProcedureToRuntime(liveRefreshConnectionProcedure, runtime)
		disconnectProcedure = bindProcedureToRuntime(liveDisconnectProcedure, runtime)
	})

	afterAll(async () => {
		await runtime?.dispose()
	})

	const context = (role: 'admin' | 'member' = 'admin', requestedOrganizationId = organizationId) =>
		createMockApiContext({
			auth: createMockApiAuth({
				role,
				roles: [role],
				organizationId: requestedOrganizationId,
				userId: 'github-admin',
			}),
		})

	test('requires organization admin access to create install links', async () => {
		await expect(call(createInstallUrlProcedure, {}, { context: context('member') })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
	})

	test('projects organization-scoped connections and repositories', async () => {
		await expect(call(listConnectionsProcedure, {}, { context: context('member') })).resolves.toEqual({
			enabled: true,
			connections: [connection],
		})
		await expect(call(getConnectionProcedure, { connectionId }, { context: context('member') })).resolves.toEqual({
			connection,
		})
		await expect(
			call(listRepositoriesProcedure, { connectionId }, { context: context('member') }),
		).resolves.toMatchObject({ repositories: [{ id: '101', fullName: 'humanlayer/riptide' }] })
	})

	test('returns an organization-scoped issue preview without requiring admin access', async () => {
		await expect(
			call(
				getIssuePreviewProcedure,
				{ connectionId, repositoryId: '101', issueInput: '42' },
				{ context: context('member') },
			),
		).resolves.toMatchObject({ issueNumber: 42, title: 'Preview issue', repository: { id: '101' } })
	})

	test('maps cross-organization connection IDs to not found', async () => {
		await expect(
			call(getConnectionProcedure, { connectionId }, { context: context('member', randomOrganizationId()) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await expect(
			call(listRepositoriesProcedure, { connectionId }, { context: context('member', randomOrganizationId()) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('requires organization admin access to refresh and disconnect one connection', async () => {
		await expect(
			call(refreshConnectionProcedure, { connectionId }, { context: context('member') }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await expect(call(disconnectProcedure, { connectionId }, { context: context('member') })).rejects.toMatchObject(
			{ code: 'FORBIDDEN' },
		)
	})

	test('refreshes and disconnects a connection for its owning organization', async () => {
		await expect(
			call(refreshConnectionProcedure, { connectionId }, { context: context('admin') }),
		).resolves.toEqual({ connection })
		await expect(call(disconnectProcedure, { connectionId }, { context: context('admin') })).resolves.toEqual({
			success: true,
		})
	})

	test('maps cross-organization refresh and disconnect IDs to not found', async () => {
		await expect(
			call(refreshConnectionProcedure, { connectionId }, { context: context('admin', randomOrganizationId()) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await expect(
			call(disconnectProcedure, { connectionId }, { context: context('admin', randomOrganizationId()) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('maps a disconnect that GitHub could not confirm to service unavailable, preserving local state', async () => {
		await expect(
			call(disconnectProcedure, { connectionId: failingConnectionId }, { context: context('admin') }),
		).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
	})
})

const randomOrganizationId = () => '019f536c-b021-763a-84b2-bbd8ee8e2999'
