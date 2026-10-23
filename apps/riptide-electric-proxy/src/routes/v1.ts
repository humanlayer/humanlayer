import { approvals } from '@humanlayer/db/tables/approvals'
import { artifactCommentColumnsHiddenFromPublic, artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifactColumnsHiddenFromPublic, artifacts } from '@humanlayer/db/tables/artifacts'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, getTableColumns, getTableName, sql, type Table } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'
import { Hono } from 'hono'
import { StatusCodes } from 'http-status-codes'

import type { AppConfig } from '../app-config'
import { ElectricProxy } from '../lib/effect/electric-proxy.service'
import type { ElectricRequestContext } from '../lib/electric-error-handler'
import { isSharedArtifactAccessible, isSharedArtifactCommentAccessible } from '../lib/queries'
import { isUuid } from '../lib/validation'
import {
	applyWhereToUrl,
	buildWhereFragment,
	buildWhereFragmentForSharedArtifact,
	buildWhereFragmentForSharedArtifactComments,
	buildWhereFragmentForTasks,
	buildWhereFragmentWithAcl,
} from '../lib/where-builder'
import { createAuthMiddleware } from '../middleware'
import { buildElectricOriginUrl, createElectricOriginMiddleware } from './electric-origin'

function proxyElectricResponseWithRuntime(
	config: AppConfig,
	url: URL,
	context?: Omit<ElectricRequestContext, 'electricUrl'>,
	incomingRequest?: { method: string; text: () => Promise<string> },
) {
	return config.effectRuntime.runPromise(
		Effect.gen(function* () {
			const proxy = yield* ElectricProxy
			return yield* proxy.proxyShapeRequest(url, context, incomingRequest)
		}),
	)
}

export function createV1App(config: AppConfig) {
	const app = new Hono()

	app.all('/shared/artifacts/:artifactId', async (c) => {
		const shareKey = c.req.header('x-share-key')
		if (!shareKey) return c.newResponse(null, StatusCodes.UNAUTHORIZED)

		const artifactId = c.req.param('artifactId')
		if (!isUuid(artifactId)) {
			return c.json({ error: 'Invalid artifactId format' }, StatusCodes.BAD_REQUEST)
		}

		const accessible = await isSharedArtifactAccessible(config.db, artifactId, shareKey)
		if (!accessible) return c.newResponse(null, StatusCodes.NOT_FOUND)

		const electricOriginUrl = buildElectricOriginUrl(config, new URL(c.req.url))
		electricOriginUrl.searchParams.set('table', getTableName(artifacts))
		electricOriginUrl.searchParams.set('columns', PUBLIC_ARTIFACT_COLUMNS.map((name) => `"${name}"`).join(','))

		const { fragment, params } = buildWhereFragmentForSharedArtifact(artifactId, shareKey)
		applyWhereToUrl(electricOriginUrl, fragment, params)

		return proxyElectricResponseWithRuntime(config, electricOriginUrl, undefined, c.req)
	})

	app.all('/shared/artifacts/:artifactId/comments', async (c) => {
		const shareKey = c.req.header('x-share-key')
		if (!shareKey) return c.newResponse(null, StatusCodes.UNAUTHORIZED)

		const artifactId = c.req.param('artifactId')
		if (!isUuid(artifactId)) {
			return c.json({ error: 'Invalid artifactId format' }, StatusCodes.BAD_REQUEST)
		}
		const accessible = await isSharedArtifactCommentAccessible(config.db, artifactId, shareKey)
		if (!accessible) return c.newResponse(null, StatusCodes.NOT_FOUND)

		const electricOriginUrl = buildElectricOriginUrl(config, new URL(c.req.url))
		electricOriginUrl.searchParams.set('table', getTableName(artifactComments))
		electricOriginUrl.searchParams.set(
			'columns',
			PUBLIC_ARTIFACT_COMMENT_COLUMNS.map((name) => `"${name}"`).join(','),
		)
		const { fragment, params } = buildWhereFragmentForSharedArtifactComments(artifactId)
		applyWhereToUrl(electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, electricOriginUrl, undefined, c.req)
	})

	app.use(createAuthMiddleware(config))
	app.use(createElectricOriginMiddleware(config))

	app.all('/sessions', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(sessions))
		const { fragment, params } = buildWhereFragmentWithAcl(sessions, { organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/tasks', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(tasks))
		const { fragment, params } = buildWhereFragmentForTasks({ organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/events', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(conversationEvents))
		const { fragment, params } = buildWhereFragmentWithAcl(conversationEvents, { organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/approvals', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(approvals))
		const { fragment, params } = buildWhereFragmentWithAcl(approvals, { organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/artifact-comments', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(artifactComments))
		const { fragment, params } = buildWhereFragmentWithAcl(artifactComments, { organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/artifacts', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(artifacts))
		const { fragment, params } = buildWhereFragmentWithAcl(artifacts, { organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/artifacts/metadata', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(artifacts))
		const { fragment, params } = buildWhereFragmentWithAcl(artifacts, { organizationId, userId })
		const metadataColumns = Object.values(getTableColumns(artifacts))
			.filter((col) => col.name !== 'content')
			.map((col) => `"${col.name}"`)
		c.var.electricOriginUrl.searchParams.set('columns', metadataColumns.join(','))
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/task-organization-acls', async (c) => {
		const { organizationId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(taskOrganizationAcl))
		const { fragment, params } = buildWhereFragment(taskOrganizationAcl, [
			{ column: taskOrganizationAcl.organization_id, value: organizationId },
		])
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/task-user-acls', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(taskUserAcl))

		const orgCondition = sql`${sql.identifier('organization_id')} = ${organizationId}`
		const subjectOrOwner = sql`(
			${sql.identifier('subject_user_id')} = ${userId}
			OR ${sql.identifier('resource_owner_user_id')} = ${userId}
		)`
		const queryBuilder = new QueryBuilder()
		const { sql: query, params } = queryBuilder
			.select()
			.from(taskUserAcl)
			.where(and(orgCondition, subjectOrOwner))
			.toSQL()
		const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/task-user-settings', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(taskUserSettings))
		const { fragment, params } = buildWhereFragment(taskUserSettings, [
			{ column: taskUserSettings.organization_id, value: organizationId },
			{ column: taskUserSettings.user_id, value: userId },
		])
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/queued-messages', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(queuedMessages))
		const { fragment, params } = buildWhereFragmentWithAcl(queuedMessages, { organizationId, userId })
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/tasks/:taskId/artifacts', async (c) => {
		const taskId = c.req.param('taskId')
		if (!taskId) throw new Error('taskId path param missing')
		if (!isUuid(taskId)) {
			return c.json({ error: 'Invalid taskId format' }, StatusCodes.BAD_REQUEST)
		}

		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(artifacts))
		const { fragment, params } = buildWhereFragmentWithAcl(
			artifacts,
			{ organizationId, userId },
			{ additionalConditions: [{ column: artifacts.task_id, value: taskId }] },
		)
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/sessions/:hostId', async (c) => {
		const hostId = c.req.param('hostId')
		if (!isUuid(hostId)) {
			return c.json({ error: 'Invalid hostId format' }, StatusCodes.BAD_REQUEST)
		}

		const { userId, organizationId, hostId: authHostId } = c.var.authContext

		if (authHostId && authHostId !== hostId) {
			return c.json(
				{ error: 'hostId mismatch: URL parameter does not match daemon token' },
				StatusCodes.FORBIDDEN,
			)
		}

		c.var.electricOriginUrl.searchParams.set('table', getTableName(sessions))
		const additionalConditions: Array<{
			column: typeof sessions.host_id | typeof sessions.created_by
			value: string
		}> = [{ column: sessions.host_id, value: hostId }]
		// Sharing grants visibility, not permission to watch another OS user's session paths.
		if (authHostId) additionalConditions.push({ column: sessions.created_by, value: userId })
		const { fragment, params } = buildWhereFragmentWithAcl(
			sessions,
			{ organizationId, userId },
			{ additionalConditions },
		)
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/hosts', async (c) => {
		const { organizationId, userId } = c.var.authContext
		c.var.electricOriginUrl.searchParams.set('table', getTableName(onlineHosts))
		const { fragment, params } = buildWhereFragment(onlineHosts, [
			{ column: onlineHosts.organization_id, value: organizationId },
			{ column: onlineHosts.user_id, value: userId },
		])
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/daemon/approvals', async (c) => {
		const { organizationId, userId, hostId } = c.var.authContext
		if (!hostId) return c.json({ error: 'hostId required in daemon token' }, StatusCodes.BAD_REQUEST)

		c.var.electricOriginUrl.searchParams.set('table', getTableName(approvals))
		const { fragment, params } = buildWhereFragmentWithAcl(
			approvals,
			{ organizationId, userId },
			{ additionalConditions: [{ column: approvals.host_id, value: hostId }] },
		)
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	return app
}

function columnsVisibleToPublic(table: Table, hidden: Record<string, true>): string[] {
	return Object.values(getTableColumns(table))
		.filter((col) => !(col.name in hidden))
		.map((col) => col.name)
}

export const PUBLIC_ARTIFACT_COLUMNS = columnsVisibleToPublic(artifacts, artifactColumnsHiddenFromPublic)
export const PUBLIC_ARTIFACT_COMMENT_COLUMNS = columnsVisibleToPublic(
	artifactComments,
	artifactCommentColumnsHiddenFromPublic,
)
