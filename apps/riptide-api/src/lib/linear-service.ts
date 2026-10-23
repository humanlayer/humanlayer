import { linearIntegrationInstallStates } from '@humanlayer/db/tables/linear-integration-install-states'
import { linearIntegrations } from '@humanlayer/db/tables/linear-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'
import { LinearClient } from '@linear/sdk'
import * as Sentry from '@sentry/node'
import { and, eq, isNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { logger } from '../logger'
import { consumeInstallState, createInstallState, type InstallClaim } from './integration-install-states'
import { isMoreProgressed } from './linear-status-progression'

const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize'
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
const LINEAR_SCOPES = 'read,write,comments:create'

export class LinearIssueUnavailableError extends Error {
	constructor(
		public readonly issueId: string,
		options?: ErrorOptions,
	) {
		super(`Linear issue ${issueId} is unavailable`, options)
		this.name = 'LinearIssueUnavailableError'
	}
}

class LinearReauthorizationRequiredError extends Error {
	constructor() {
		super('Linear token refresh failed — re-authorization required')
		this.name = 'LinearReauthorizationRequiredError'
	}
}

/**
 * Interface for Linear integration operations.
 * Enables mocking in tests without requiring real Linear credentials.
 */
export interface ILinearService {
	/** Mints a one-time install state and returns Linear's consent URL for it. */
	createInstallUrl(input: {
		organizationId: string
		requestedByUserId: string
		client: RiptideClient
	}): Promise<{ url: string; expiresAt: number }>
	/** Atomically claims an install state. Returns `null` when unknown, expired, or already used. */
	consumeInstallState(state: string): Promise<InstallClaim | null>
	exchangeCode(organizationId: string, connectedBy: string, code: string): Promise<{ success: boolean }>
	getIntegrationStatus(
		organizationId: string,
	): Promise<{ enabled: boolean; connected: boolean; needsReauth: boolean }>
	disconnect(organizationId: string): Promise<{ success: boolean }>
	updateIssueStatus(organizationId: string, issueId: string, statusName: string): Promise<{ updated: boolean }>
	createAttachment(organizationId: string, issueId: string, url: string, title: string): Promise<{ created: boolean }>
	getIssueMetadata(
		organizationId: string,
		issueId: string,
	): Promise<{ identifier: string; title: string; url: string; branch: string | null }>
	getIssue(
		organizationId: string,
		issueId: string,
	): Promise<{
		identifier: string
		title: string
		url: string
		branch: string | null
		status: string
		assignee: string | null
		description: string | null
		comments: { author: string; body: string; createdAt: string }[]
		parents: {
			identifier: string
			title: string
			status: string
			assignee: string | null
			description: string | null
			comments: { author: string; body: string; createdAt: string }[]
		}[]
	}>
	getAccessToken(organizationId: string): Promise<string>
}

/**
 * Production implementation using Linear OAuth 2.0 and @linear/sdk.
 * Manages token lifecycle (exchange, refresh) and persists integration state.
 */
export class LinearService implements ILinearService {
	constructor(
		private clientId: string,
		private clientSecret: string,
		private db: PostgresJsDatabase,
		/** Server-owned OAuth redirect URI; the browser never supplies one. */
		private redirectUri: string,
	) {}

	getAuthorizationUrl(state: string): string {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: this.redirectUri,
			response_type: 'code',
			scope: LINEAR_SCOPES,
			state,
			actor: 'app',
			prompt: 'consent',
		})
		return `${LINEAR_AUTH_URL}?${params.toString()}`
	}

	async createInstallUrl(input: {
		organizationId: string
		requestedByUserId: string
		client: RiptideClient
	}): Promise<{ url: string; expiresAt: number }> {
		const { state, expiresAt } = await createInstallState(this.db, linearIntegrationInstallStates, {
			organizationId: input.organizationId,
			requestedByUserId: input.requestedByUserId,
			returnClient: input.client,
		})
		return { url: this.getAuthorizationUrl(state), expiresAt }
	}

	async consumeInstallState(state: string): Promise<InstallClaim | null> {
		return consumeInstallState(this.db, linearIntegrationInstallStates, state)
	}

	async exchangeCode(organizationId: string, connectedBy: string, code: string): Promise<{ success: boolean }> {
		// Exchange authorization code for tokens
		const tokenResponse = await fetch(LINEAR_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: this.clientId,
				client_secret: this.clientSecret,
				code,
				redirect_uri: this.redirectUri,
			}),
		})

		if (!tokenResponse.ok) {
			const errorBody = await tokenResponse.text()
			throw new Error(`Linear token exchange failed: ${tokenResponse.status} ${errorBody}`)
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string
			token_type: string
			expires_in: number
			scope: string
			refresh_token: string
		}

		const tokenExpiresAt = BigInt(Date.now() + tokenData.expires_in * 1000)
		const linearOrganizationId = await this.getLinearOrganizationId(tokenData.access_token)

		// Upsert integration + enable org setting in transaction
		await this.db.transaction(async (tx) => {
			await tx
				.insert(linearIntegrations)
				.values({
					organization_id: organizationId,
					linear_organization_id: linearOrganizationId,
					access_token: tokenData.access_token,
					refresh_token: tokenData.refresh_token,
					token_expires_at: tokenExpiresAt,
					scopes: tokenData.scope,
					connected_by: connectedBy,
					needs_reauth: false,
				})
				.onConflictDoUpdate({
					target: linearIntegrations.organization_id,
					set: {
						linear_organization_id: linearOrganizationId,
						access_token: tokenData.access_token,
						refresh_token: tokenData.refresh_token,
						token_expires_at: tokenExpiresAt,
						scopes: tokenData.scope,
						connected_by: connectedBy,
						needs_reauth: false,
						updated_at: BigInt(Date.now()),
					},
				})

			// Auto-enable the integration on successful connect
			await tx
				.insert(organizationSettings)
				.values({
					organization_id: organizationId,
					linear_integration_enabled: true,
				})
				.onConflictDoUpdate({
					target: organizationSettings.organization_id,
					set: {
						linear_integration_enabled: true,
						updated_at: BigInt(Date.now()),
					},
				})
		})

		return { success: true }
	}

	private async getLinearOrganizationId(accessToken: string): Promise<string> {
		const response = await fetch(LINEAR_GRAPHQL_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query: 'query LinearOrganizationIdentity { organization { id } }' }),
		})

		if (!response.ok) {
			const errorBody = await response.text()
			throw new Error(`Linear organization lookup failed: ${response.status} ${errorBody}`)
		}

		const responseData = (await response.json()) as {
			data?: { organization?: { id?: string } }
			errors?: unknown
		}
		const linearOrganizationId = responseData.data?.organization?.id
		if (!linearOrganizationId) {
			throw new Error('Linear organization lookup returned no organization ID')
		}

		return linearOrganizationId
	}

	async getIntegrationStatus(
		organizationId: string,
	): Promise<{ enabled: boolean; connected: boolean; needsReauth: boolean }> {
		const [row] = await this.db
			.select({
				needsReauth: linearIntegrations.needs_reauth,
				orgEnabled: organizationSettings.linear_integration_enabled,
			})
			.from(linearIntegrations)
			.leftJoin(
				organizationSettings,
				eq(organizationSettings.organization_id, linearIntegrations.organization_id),
			)
			.where(eq(linearIntegrations.organization_id, organizationId))
			.limit(1)

		const connected = !!row
		const needsReauth = row?.needsReauth ?? false
		const orgEnabled = row?.orgEnabled ?? false
		const enabled = orgEnabled && connected && !needsReauth

		return {
			enabled,
			connected,
			needsReauth,
		}
	}

	async disconnect(organizationId: string): Promise<{ success: boolean }> {
		await this.db.delete(linearIntegrations).where(eq(linearIntegrations.organization_id, organizationId))
		await this.db
			.update(organizationSettings)
			.set({
				linear_integration_enabled: false,
				updated_at: BigInt(Date.now()),
			})
			.where(eq(organizationSettings.organization_id, organizationId))
		return { success: true }
	}

	/**
	 * Ensures we have a valid access token, refreshing if needed.
	 * Returns the current or refreshed access token.
	 */
	private async ensureValidToken(organizationId: string): Promise<string> {
		const [integration] = await this.db
			.select()
			.from(linearIntegrations)
			.where(eq(linearIntegrations.organization_id, organizationId))
			.limit(1)

		if (!integration) {
			throw new Error('Linear integration not connected')
		}

		// Proactively refresh if token expires within 5 minutes
		const fiveMinFromNow = BigInt(Date.now() + 5 * 60 * 1000)
		if (integration.token_expires_at < fiveMinFromNow) {
			try {
				const refreshResponse = await fetch(LINEAR_TOKEN_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						grant_type: 'refresh_token',
						client_id: this.clientId,
						client_secret: this.clientSecret,
						refresh_token: integration.refresh_token,
					}),
				})

				if (!refreshResponse.ok) {
					// Refresh failed — mark needs_reauth, but only if token_expires_at hasn't changed
					// (another request may have successfully refreshed the token already)
					await this.db
						.update(linearIntegrations)
						.set({ needs_reauth: true, updated_at: BigInt(Date.now()) })
						.where(
							and(
								eq(linearIntegrations.organization_id, organizationId),
								eq(linearIntegrations.token_expires_at, integration.token_expires_at),
							),
						)
					throw new LinearReauthorizationRequiredError()
				}

				const refreshData = (await refreshResponse.json()) as {
					access_token: string
					refresh_token: string
					expires_in: number
					scope: string
					token_type: string
				}

				const newExpiresAt = BigInt(Date.now() + refreshData.expires_in * 1000)

				await this.db
					.update(linearIntegrations)
					.set({
						access_token: refreshData.access_token,
						refresh_token: refreshData.refresh_token,
						token_expires_at: newExpiresAt,
						needs_reauth: false,
						updated_at: BigInt(Date.now()),
					})
					.where(eq(linearIntegrations.organization_id, organizationId))

				if (integration.linear_organization_id === null) {
					try {
						const linearOrganizationId = await this.getLinearOrganizationId(refreshData.access_token)
						await this.db
							.update(linearIntegrations)
							.set({
								linear_organization_id: linearOrganizationId,
								updated_at: BigInt(Date.now()),
							})
							.where(
								and(
									eq(linearIntegrations.organization_id, organizationId),
									isNull(linearIntegrations.linear_organization_id),
								),
							)
					} catch (error: unknown) {
						logger.error(error, 'Failed to backfill Linear organization ID after token refresh')
						Sentry.captureException(error, {
							tags: { error_type: 'linear_organization_id_backfill' },
							extra: { organizationId },
						})
					}
				}

				return refreshData.access_token
			} catch (error: unknown) {
				if (error instanceof LinearReauthorizationRequiredError) throw error
				logger.error(error, 'Linear token refresh failed')
				Sentry.captureException(error, {
					tags: { error_type: 'linear_token_refresh' },
					extra: { organizationId },
				})
				const message = error instanceof Error ? error.message : 'Unknown error'
				throw new Error(`Linear token refresh error: ${message}`, { cause: error })
			}
		}

		return integration.access_token
	}

	/** Get an authenticated LinearClient, refreshing the token if needed */
	private async getAuthedClient(organizationId: string): Promise<LinearClient> {
		const accessToken = await this.ensureValidToken(organizationId)
		return new LinearClient({ accessToken })
	}

	async updateIssueStatus(
		organizationId: string,
		issueId: string,
		statusName: string,
	): Promise<{ updated: boolean }> {
		const linear = await this.getAuthedClient(organizationId)
		let issue: Awaited<ReturnType<LinearClient['issue']>>
		try {
			// Normalize the issue identifier to uppercase (e.g. "core-123" -> "CORE-123"),
			// matching getIssue / getIssueMetadata. Stored ticket_id values are not
			// guaranteed to be uppercase, and Linear's identifier lookup is case-sensitive.
			issue = await linear.issue(issueId.toUpperCase())
		} catch (error) {
			if (isLinearNotFoundError(error)) {
				logger.info({ organizationId, issueId, statusName }, 'Linear issue not found while updating status')
				return { updated: false }
			}
			throw error
		}
		const team = await issue.team
		if (!team) return { updated: false }

		const states = await team.states()
		const targetState = states.nodes.find((s) => s.name.toLowerCase() === statusName.toLowerCase())
		if (!targetState) return { updated: false }

		// Don't regress the ticket: auto-advance only moves a ticket forward, so it
		// stays at its most-progressed phase when work loops back to an earlier skill
		// (e.g. /iterate-implementation after /describe-pr to address review feedback).
		const currentState = await issue.state
		if (currentState && !isMoreProgressed(targetState, currentState)) {
			logger.info(
				{ organizationId, issueId, statusName, currentStatus: currentState.name },
				'Skipping Linear status update — would not advance ticket past its current phase',
			)
			return { updated: false }
		}

		await linear.updateIssue(issue.id, { stateId: targetState.id })
		return { updated: true }
	}

	async createAttachment(
		organizationId: string,
		issueId: string,
		url: string,
		title: string,
	): Promise<{ created: boolean }> {
		const linear = await this.getAuthedClient(organizationId)

		// Check for existing attachment to prevent duplicates
		const issue = await linear.issue(issueId)
		const attachments = await issue.attachments()
		const existing = attachments.nodes.find((a) => a.url === url)
		if (existing) return { created: false }

		await linear.createAttachment({ issueId: issue.id, url, title })
		return { created: true }
	}

	async getIssueMetadata(
		organizationId: string,
		issueId: string,
	): Promise<{ identifier: string; title: string; url: string; branch: string | null }> {
		const linear = await this.getAuthedClient(organizationId)
		const issue = await getAvailableLinearIssue(linear, issueId)
		return {
			identifier: issue.identifier,
			title: issue.title,
			url: issue.url,
			branch: issue.branchName || null,
		}
	}

	async getIssue(
		organizationId: string,
		issueId: string,
	): Promise<{
		identifier: string
		title: string
		url: string
		branch: string | null
		status: string
		assignee: string | null
		description: string | null
		comments: { author: string; body: string; createdAt: string }[]
		parents: {
			identifier: string
			title: string
			status: string
			assignee: string | null
			description: string | null
			comments: { author: string; body: string; createdAt: string }[]
		}[]
	}> {
		const linear = await this.getAuthedClient(organizationId)
		const issue = await getAvailableLinearIssue(linear, issueId)
		const state = await issue.state
		const assignee = await issue.assignee

		// Fetch comments (newest first, matching CLI behavior)
		const commentsConnection = await issue.comments()
		const comments: { author: string; body: string; createdAt: string }[] = []
		for (const comment of [...commentsConnection.nodes].reverse()) {
			let commentUser: { name?: string } | null | undefined
			try {
				commentUser = await comment.user
			} catch {
				commentUser = null
			}
			comments.push({
				author: commentUser?.name || 'Unknown',
				body: comment.body,
				createdAt: comment.createdAt.toISOString(),
			})
		}

		// Walk parent chain (oldest ancestor first, matching CLI behavior)
		const parentIssues: (typeof issue)[] = []
		let currentIssue = issue
		while (true) {
			const parent = await currentIssue.parent
			if (!parent) break
			parentIssues.push(parent)
			currentIssue = parent
		}
		parentIssues.reverse()

		const parents = []
		for (const parent of parentIssues) {
			const parentState = await parent.state
			const parentAssignee = await parent.assignee
			const parentCommentsConnection = await parent.comments()
			const parentComments: { author: string; body: string; createdAt: string }[] = []
			for (const comment of [...parentCommentsConnection.nodes].reverse()) {
				let commentUser: { name?: string } | null | undefined
				try {
					commentUser = await comment.user
				} catch {
					commentUser = null
				}
				parentComments.push({
					author: commentUser?.name || 'Unknown',
					body: comment.body,
					createdAt: comment.createdAt.toISOString(),
				})
			}
			parents.push({
				identifier: parent.identifier,
				title: parent.title,
				status: parentState?.name || 'Unknown',
				assignee: parentAssignee?.name || null,
				description: parent.description || null,
				comments: parentComments,
			})
		}

		return {
			identifier: issue.identifier,
			title: issue.title,
			url: issue.url,
			branch: issue.branchName || null,
			status: state?.name || 'Unknown',
			assignee: assignee?.name || null,
			description: issue.description || null,
			comments,
			parents,
		}
	}

	/**
	 * Get the raw access token for direct API calls (e.g., downloading images).
	 * Refreshes the token if needed before returning.
	 */
	async getAccessToken(organizationId: string): Promise<string> {
		return this.ensureValidToken(organizationId)
	}
}

function isLinearNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return String(error).toLowerCase().includes('entity not found')
	}

	const maybeError = error as { message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown }
	const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : ''
	const code = typeof maybeError.code === 'string' ? maybeError.code.toLowerCase() : ''
	return (
		message.includes('entity not found') ||
		message.includes('not found') ||
		code.includes('not_found') ||
		maybeError.status === 404 ||
		maybeError.statusCode === 404
	)
}

async function getAvailableLinearIssue(linear: LinearClient, issueId: string) {
	try {
		return await linear.issue(issueId.toUpperCase())
	} catch (error) {
		if (isLinearNotFoundError(error)) {
			throw new LinearIssueUnavailableError(issueId, { cause: error })
		}
		throw error
	}
}
