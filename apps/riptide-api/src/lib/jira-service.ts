import { jiraIntegrationInstallStates } from '@humanlayer/db/tables/jira-integration-install-states'
import { jiraIntegrations } from '@humanlayer/db/tables/jira-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { Version3Client } from 'jira.js'
import type { Issue as JiraApiIssue } from 'jira.js/version3/models'

import { logger } from '../logger'
import { consumeInstallState, createInstallState, type InstallClaim } from './integration-install-states'

export class JiraIntegrationNotFoundError extends Error {
	constructor(options?: ErrorOptions) {
		super('Jira integration not found', options)
		this.name = 'JiraIntegrationNotFoundError'
	}
}

export class JiraIntegrationDisabledError extends Error {
	constructor(options?: ErrorOptions) {
		super('Jira is disabled for this organization', options)
		this.name = 'JiraIntegrationDisabledError'
	}
}

export class JiraReauthRequiredError extends Error {
	constructor(options?: ErrorOptions) {
		super('Jira requires re-authorization', options)
		this.name = 'JiraReauthRequiredError'
	}
}

export class JiraIssueNotFoundError extends Error {
	constructor(
		public readonly issueKey: string,
		options?: ErrorOptions,
	) {
		super(`Jira issue ${issueKey} is unavailable`, options)
		this.name = 'JiraIssueNotFoundError'
	}
}

export class JiraIssueInputInvalidError extends Error {
	constructor(
		public readonly issueKey: string,
		options?: ErrorOptions,
	) {
		super('Jira issue key is invalid', options)
		this.name = 'JiraIssueInputInvalidError'
	}
}

export class JiraProviderUnavailableError extends Error {
	constructor(options?: ErrorOptions) {
		super('Jira is unavailable', options)
		this.name = 'JiraProviderUnavailableError'
	}
}

export interface JiraIssue {
	key: string
	summary: string
	url: string
	status?: string
	description?: string
}

type JiraGetIssueResponse = JiraApiIssue

const JiraIssueResponse = Schema.Struct({
	key: Schema.optionalKey(Schema.String),
	fields: Schema.optionalKey(
		Schema.Struct({
			summary: Schema.optionalKey(Schema.String),
			status: Schema.optionalKey(Schema.Struct({ name: Schema.optionalKey(Schema.String) })),
			description: Schema.optionalKey(Schema.Unknown),
		}),
	),
})

export function parseJiraIssueResponse(response: JiraGetIssueResponse, siteUrl: string): JiraIssue {
	const parsedResponse = Option.getOrUndefined(Schema.decodeUnknownOption(JiraIssueResponse)(response))
	const key = parsedResponse?.key?.trim() ?? ''
	const fields = parsedResponse?.fields
	const summary = fields?.summary?.trim() ?? ''
	if (!key || !fields || !summary) throw new JiraProviderUnavailableError()

	let url: URL
	try {
		const site = new URL(siteUrl)
		if (site.protocol !== 'https:' && site.protocol !== 'http:') throw new Error('Unsupported Jira site protocol')
		url = new URL(`browse/${encodeURIComponent(key)}`, `${site.toString().replace(/\/$/, '')}/`)
	} catch (error) {
		throw new JiraProviderUnavailableError({ cause: error })
	}

	return {
		key,
		summary,
		url: url.toString(),
		status: fields.status?.name,
		description: fields.description ? adfToMarkdown(fields.description) : undefined,
	}
}

const AdfNode = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.Array(Schema.Unknown)),
	attrs: Schema.optionalKey(Schema.Unknown),
	marks: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				type: Schema.String,
				attrs: Schema.optionalKey(Schema.Unknown),
			}),
		),
	),
})

const AdfDocument = Schema.Struct({ content: Schema.Array(AdfNode) })
const AdfHeadingAttributes = Schema.Struct({ level: Schema.optionalKey(Schema.Number) })
const AdfCodeBlockAttributes = Schema.Struct({ language: Schema.optionalKey(Schema.String) })
const AdfLinkAttributes = Schema.Struct({ href: Schema.optionalKey(Schema.String) })
const AdfMentionAttributes = Schema.Struct({ text: Schema.optionalKey(Schema.String) })
const AdfEmojiAttributes = Schema.Struct({ shortName: Schema.optionalKey(Schema.String) })
const AdfInlineCardAttributes = Schema.Struct({ url: Schema.optionalKey(Schema.String) })

function parseAdfAttributes<S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	attrs: unknown,
): S['Type'] | undefined {
	return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(attrs))
}

/**
 * Convert Atlassian Document Format (ADF) to Markdown.
 * Handles headings, paragraphs, lists, code blocks, inline marks, links, etc.
 */
function adfToMarkdown(adf: unknown): string {
	const document = Option.getOrUndefined(Schema.decodeUnknownOption(AdfDocument)(adf))
	return document?.content.map((node) => renderBlock(node)).join('\n') ?? ''
}

function renderBlock(rawNode: unknown): string {
	const node = Option.getOrUndefined(Schema.decodeUnknownOption(AdfNode)(rawNode))
	if (!node) return ''
	switch (node.type) {
		case 'paragraph':
			return `${renderInlineContent(node.content)}\n`
		case 'heading': {
			const level = parseAdfAttributes(AdfHeadingAttributes, node.attrs)?.level ?? 1
			const prefix = '#'.repeat(level)
			return `${prefix} ${renderInlineContent(node.content)}\n`
		}
		case 'bulletList':
			return `${(node.content ?? []).map((item) => renderListItem(item, '- ')).join('\n')}\n`
		case 'orderedList':
			return `${(node.content ?? []).map((item, i) => renderListItem(item, `${i + 1}. `)).join('\n')}\n`
		case 'listItem':
			return (node.content ?? []).map((child) => renderBlock(child)).join('')
		case 'codeBlock': {
			const lang = parseAdfAttributes(AdfCodeBlockAttributes, node.attrs)?.language ?? ''
			return `\`\`\`${lang}\n${renderInlineContent(node.content)}\n\`\`\`\n`
		}
		case 'blockquote':
			return `${(node.content ?? [])
				.map((child) =>
					renderBlock(child)
						.split('\n')
						.map((line) => (line ? `> ${line}` : '>'))
						.join('\n'),
				)
				.join('\n')}\n`
		case 'rule':
			return '---\n'
		case 'mediaSingle':
		case 'media':
			return ''
		case 'table':
			return `${renderTable(node)}\n`
		default:
			return `${renderInlineContent(node.content)}\n`
	}
}

function renderListItem(rawNode: unknown, prefix: string): string {
	const node = Option.getOrUndefined(Schema.decodeUnknownOption(AdfNode)(rawNode))
	if (!node) return ''
	const children = node.content ?? []
	const lines: string[] = []
	for (const [i, child] of children.entries()) {
		const block = renderBlock(child).trimEnd()
		if (i === 0) {
			lines.push(`${prefix}${block}`)
		} else {
			// Indent continuation blocks
			const indent = ' '.repeat(prefix.length)
			lines.push(
				block
					.split('\n')
					.map((l) => `${indent}${l}`)
					.join('\n'),
			)
		}
	}
	return lines.join('\n')
}

function renderInlineContent(content?: ReadonlyArray<unknown>): string {
	if (!content) return ''
	return content.map((node) => renderInline(node)).join('')
}

function renderInline(rawNode: unknown): string {
	const node = Option.getOrUndefined(Schema.decodeUnknownOption(AdfNode)(rawNode))
	if (!node) return ''
	if (node.type === 'text') {
		let text = node.text ?? ''
		for (const mark of node.marks ?? []) {
			switch (mark.type) {
				case 'strong':
					text = `**${text}**`
					break
				case 'em':
					text = `*${text}*`
					break
				case 'code':
					text = `\`${text}\``
					break
				case 'strike':
					text = `~~${text}~~`
					break
				case 'link':
					text = `[${text}](${parseAdfAttributes(AdfLinkAttributes, mark.attrs)?.href ?? ''})`
					break
			}
		}
		return text
	}
	if (node.type === 'hardBreak') return '\n'
	if (node.type === 'mention') return `@${parseAdfAttributes(AdfMentionAttributes, node.attrs)?.text ?? 'user'}`
	if (node.type === 'emoji') return parseAdfAttributes(AdfEmojiAttributes, node.attrs)?.shortName ?? ''
	if (node.type === 'inlineCard') return parseAdfAttributes(AdfInlineCardAttributes, node.attrs)?.url ?? ''
	return ''
}

function renderTable(rawNode: unknown): string {
	const node = Option.getOrUndefined(Schema.decodeUnknownOption(AdfNode)(rawNode))
	if (!node) return ''
	const rows = node.content ?? []
	if (rows.length === 0) return ''
	const rendered = rows.map((rawRow) => {
		const row = Option.getOrUndefined(Schema.decodeUnknownOption(AdfNode)(rawRow))
		return (row?.content ?? []).map((rawCell) => {
			const cell = Option.getOrUndefined(Schema.decodeUnknownOption(AdfNode)(rawCell))
			return (cell?.content ?? []).map((block) => renderBlock(block).trim()).join(' ')
		})
	})
	const colCount = rendered[0]?.length ?? 0
	const header = `| ${rendered[0]?.join(' | ') ?? ''} |`
	const separator = `| ${Array(colCount).fill('---').join(' | ')} |`
	const body = rendered
		.slice(1)
		.map((row) => `| ${row.join(' | ')} |`)
		.join('\n')
	return [header, separator, body].filter(Boolean).join('\n')
}

/**
 * Interface for Jira integration operations.
 * Enables mocking in tests without requiring real Atlassian credentials.
 */
export interface IJiraService {
	createInstallUrl(input: {
		organizationId: string
		requestedByUserId: string
		client: RiptideClient
	}): Promise<{ url: string; expiresAt: number }>
	consumeInstallState(state: string): Promise<InstallClaim | null>
	exchangeCode(organizationId: string, connectedBy: string, code: string): Promise<{ siteUrl: string }>
	getIntegrationStatus(organizationId: string): Promise<{
		enabled: boolean
		connected: boolean
		needsReauth: boolean
		siteUrl: string | null
	}>
	getIssue(organizationId: string, issueKey: string): Promise<JiraIssue>
	createRemoteLink(
		organizationId: string,
		issueKey: string,
		url: string,
		title: string,
		globalId: string,
	): Promise<{ created: boolean }>
	disconnect(organizationId: string): Promise<{ success: boolean }>
}

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize'
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'
const JIRA_SCOPES = 'offline_access read:jira-work write:jira-work'

/**
 * Production implementation using Atlassian OAuth 2.0 and jira.js SDK.
 * Manages token lifecycle (exchange, refresh, revocation) and persists integration state.
 */
export class JiraService implements IJiraService {
	constructor(
		private clientId: string,
		private clientSecret: string,
		private db: PostgresJsDatabase,
		private redirectUri: string,
	) {}

	getAuthorizationUrl(state: string): string {
		const params = new URLSearchParams({
			audience: 'api.atlassian.com',
			client_id: this.clientId,
			scope: JIRA_SCOPES,
			redirect_uri: this.redirectUri,
			state,
			response_type: 'code',
			prompt: 'consent',
		})
		return `${ATLASSIAN_AUTH_URL}?${params.toString()}`
	}

	async createInstallUrl(input: {
		organizationId: string
		requestedByUserId: string
		client: RiptideClient
	}): Promise<{ url: string; expiresAt: number }> {
		const { state, expiresAt } = await createInstallState(this.db, jiraIntegrationInstallStates, {
			organizationId: input.organizationId,
			requestedByUserId: input.requestedByUserId,
			returnClient: input.client,
		})
		return { url: this.getAuthorizationUrl(state), expiresAt }
	}

	async consumeInstallState(state: string): Promise<InstallClaim | null> {
		return consumeInstallState(this.db, jiraIntegrationInstallStates, state)
	}

	async exchangeCode(organizationId: string, connectedBy: string, code: string): Promise<{ siteUrl: string }> {
		// Exchange authorization code for tokens
		const tokenResponse = await fetch(ATLASSIAN_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'authorization_code',
				client_id: this.clientId,
				client_secret: this.clientSecret,
				code,
				redirect_uri: this.redirectUri,
			}),
		})

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text()
			throw new Error(`Jira token exchange failed: ${error}`)
		}

		const tokens = (await tokenResponse.json()) as {
			access_token: string
			refresh_token: string
			expires_in: number
			scope: string
		}

		// Get accessible resources to find cloudId and site URL
		const resourcesResponse = await fetch(ATLASSIAN_RESOURCES_URL, {
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		})

		if (!resourcesResponse.ok) {
			throw new Error('Failed to fetch Jira accessible resources')
		}

		const resources = (await resourcesResponse.json()) as Array<{
			id: string
			url: string
			name: string
			scopes: string[]
		}>

		if (resources.length === 0 || !resources[0]) {
			throw new Error('No accessible Jira sites found')
		}

		// Use the first accessible resource (one site per org)
		const site = resources[0]

		// Upsert jira_integrations and auto-enable in a transaction
		await this.db.transaction(async (tx) => {
			await tx
				.insert(jiraIntegrations)
				.values({
					organization_id: organizationId,
					cloud_id: site.id,
					site_url: site.url,
					access_token: tokens.access_token,
					refresh_token: tokens.refresh_token,
					token_expires_at: BigInt(Date.now() + tokens.expires_in * 1000),
					scopes: tokens.scope,
					connected_by: connectedBy,
					needs_reauth: false,
				})
				.onConflictDoUpdate({
					target: jiraIntegrations.organization_id,
					set: {
						cloud_id: site.id,
						site_url: site.url,
						access_token: tokens.access_token,
						refresh_token: tokens.refresh_token,
						token_expires_at: BigInt(Date.now() + tokens.expires_in * 1000),
						scopes: tokens.scope,
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
					jira_integration_enabled: true,
				})
				.onConflictDoUpdate({
					target: organizationSettings.organization_id,
					set: {
						jira_integration_enabled: true,
						updated_at: BigInt(Date.now()),
					},
				})
		})

		return { siteUrl: site.url }
	}

	async getIntegrationStatus(organizationId: string): Promise<{
		enabled: boolean
		connected: boolean
		needsReauth: boolean
		siteUrl: string | null
	}> {
		const [row] = await this.db
			.select({
				needsReauth: jiraIntegrations.needs_reauth,
				siteUrl: jiraIntegrations.site_url,
				orgEnabled: organizationSettings.jira_integration_enabled,
			})
			.from(jiraIntegrations)
			.leftJoin(organizationSettings, eq(organizationSettings.organization_id, jiraIntegrations.organization_id))
			.where(eq(jiraIntegrations.organization_id, organizationId))
			.limit(1)

		const connected = !!row
		const needsReauth = row?.needsReauth ?? false
		const orgEnabled = row?.orgEnabled ?? false
		const enabled = orgEnabled && connected && !needsReauth

		return {
			enabled,
			connected,
			needsReauth,
			siteUrl: row?.siteUrl ?? null,
		}
	}

	private async getAuthedClient(organizationId: string): Promise<{
		client: InstanceType<typeof Version3Client>
		integration: typeof jiraIntegrations.$inferSelect
	}> {
		// Policy is enforced here rather than at each caller so every Jira read and write honours the
		// org's enabled flag and reauth state, including the task-create import path.
		const [row] = await this.db
			.select({ integration: jiraIntegrations, orgEnabled: organizationSettings.jira_integration_enabled })
			.from(jiraIntegrations)
			.leftJoin(organizationSettings, eq(organizationSettings.organization_id, jiraIntegrations.organization_id))
			.where(eq(jiraIntegrations.organization_id, organizationId))
			.limit(1)

		if (!row) {
			throw new JiraIntegrationNotFoundError()
		}
		if (!row.orgEnabled) {
			throw new JiraIntegrationDisabledError()
		}

		const integration = row.integration
		if (integration.needs_reauth) {
			throw new JiraReauthRequiredError()
		}

		// Proactively refresh if token expires within 5 minutes
		const fiveMinFromNow = BigInt(Date.now() + 5 * 60 * 1000)
		if (integration.token_expires_at < fiveMinFromNow) {
			try {
				const refreshResponse = await fetch(ATLASSIAN_TOKEN_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
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
						.update(jiraIntegrations)
						.set({ needs_reauth: true, updated_at: BigInt(Date.now()) })
						.where(
							and(
								eq(jiraIntegrations.organization_id, organizationId),
								eq(jiraIntegrations.token_expires_at, integration.token_expires_at),
							),
						)
					throw new JiraReauthRequiredError()
				}

				const tokens = (await refreshResponse.json()) as {
					access_token: string
					refresh_token: string
					expires_in: number
				}

				// Atomically persist both rotated tokens
				await this.db
					.update(jiraIntegrations)
					.set({
						access_token: tokens.access_token,
						refresh_token: tokens.refresh_token,
						token_expires_at: BigInt(Date.now() + tokens.expires_in * 1000),
						needs_reauth: false,
						updated_at: BigInt(Date.now()),
					})
					.where(eq(jiraIntegrations.organization_id, organizationId))

				integration.access_token = tokens.access_token
			} catch (err) {
				if (jiraServiceErrorName(err) === 'JiraReauthRequiredError') throw err
				logger.error(err, 'Jira token refresh failed')
				Sentry.captureException(err, {
					tags: { error_type: 'jira_token_refresh' },
					extra: { organizationId },
				})
				throw new Error(`Jira token refresh error: ${jiraErrorMessage(err) ?? 'unknown provider error'}`)
			}
		}

		const client = new Version3Client({
			host: `https://api.atlassian.com/ex/jira/${integration.cloud_id}`,
			authentication: {
				oauth2: { accessToken: integration.access_token },
			},
		})

		return { client, integration }
	}

	async getIssue(organizationId: string, issueKey: string): Promise<JiraIssue> {
		const normalizedIssueKey = issueKey.trim()
		if (!normalizedIssueKey) throw new JiraIssueInputInvalidError(issueKey)

		let clientAndIntegration: Awaited<ReturnType<JiraService['getAuthedClient']>>
		try {
			clientAndIntegration = await this.getAuthedClient(organizationId)
		} catch (error) {
			// Policy and authorization failures are actionable by the caller; only genuine transport or
			// refresh faults degrade to a temporary outage.
			if (jiraServiceErrorName(error) !== undefined) {
				throw error
			}
			throw new JiraProviderUnavailableError({ cause: error })
		}

		const { client, integration } = clientAndIntegration
		try {
			const response = await client.issues.getIssue({
				issueIdOrKey: normalizedIssueKey,
				fields: ['summary', 'status', 'description'],
			})
			return parseJiraIssueResponse(response, integration.site_url)
		} catch (error) {
			const status = getJiraErrorStatus(error)
			if (status === 400) throw new JiraIssueInputInvalidError(normalizedIssueKey, { cause: error })
			if (status === 401 || status === 403) throw new JiraReauthRequiredError({ cause: error })
			if (status === 404) throw new JiraIssueNotFoundError(normalizedIssueKey, { cause: error })
			throw new JiraProviderUnavailableError({ cause: error })
		}
	}

	async createRemoteLink(
		organizationId: string,
		issueKey: string,
		url: string,
		title: string,
		globalId: string,
	): Promise<{ created: boolean }> {
		const { client } = await this.getAuthedClient(organizationId)
		await client.issueRemoteLinks.createOrUpdateRemoteIssueLink({
			issueIdOrKey: issueKey,
			globalId,
			object: {
				url,
				title,
			},
		})
		return { created: true }
	}

	async disconnect(organizationId: string): Promise<{ success: boolean }> {
		await this.db.delete(jiraIntegrations).where(eq(jiraIntegrations.organization_id, organizationId))
		await this.db
			.update(organizationSettings)
			.set({
				jira_integration_enabled: false,
				updated_at: BigInt(Date.now()),
			})
			.where(eq(organizationSettings.organization_id, organizationId))
		return { success: true }
	}
}

const JiraErrorStatus = Schema.Union([Schema.Number, Schema.NumberFromString])
const JiraServiceErrorName = Schema.Struct({
	name: Schema.Union([
		Schema.Literal('JiraIntegrationNotFoundError'),
		Schema.Literal('JiraIntegrationDisabledError'),
		Schema.Literal('JiraReauthRequiredError'),
	]),
})
const JiraErrorMessage = Schema.Struct({ message: Schema.optionalKey(Schema.String) })
const JiraProviderError = Schema.Struct({
	status: Schema.optionalKey(JiraErrorStatus),
	statusCode: Schema.optionalKey(JiraErrorStatus),
	response: Schema.optionalKey(Schema.Struct({ status: Schema.optionalKey(JiraErrorStatus) })),
	cause: Schema.optionalKey(
		Schema.Struct({
			status: Schema.optionalKey(JiraErrorStatus),
			response: Schema.optionalKey(Schema.Struct({ status: Schema.optionalKey(JiraErrorStatus) })),
		}),
	),
})

function jiraServiceErrorName(error: unknown): string | undefined {
	return Option.getOrUndefined(Schema.decodeUnknownOption(JiraServiceErrorName)(error))?.name
}

function jiraErrorMessage(error: unknown): string | undefined {
	return Option.getOrUndefined(Schema.decodeUnknownOption(JiraErrorMessage)(error))?.message
}

function getJiraErrorStatus(error: unknown): number | undefined {
	const providerError = Option.getOrUndefined(Schema.decodeUnknownOption(JiraProviderError)(error))
	return (
		providerError?.cause?.response?.status ??
		providerError?.cause?.status ??
		providerError?.response?.status ??
		providerError?.status ??
		providerError?.statusCode
	)
}
