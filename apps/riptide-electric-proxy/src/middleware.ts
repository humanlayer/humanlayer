import type { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import type { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import type { projects } from '@humanlayer/db/tables/projects'
import type { sessions } from '@humanlayer/db/tables/sessions'
import type { tasks } from '@humanlayer/db/tables/tasks'
import { getTableName, sql } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { createMiddleware } from 'hono/factory'
import { StatusCodes } from 'http-status-codes'

import type { AppConfig, SimpleAuthContext } from './app-config'
import { createJWTValidator } from './auth/jwt-validator'
import { Sentry } from './lib/effect/sentry.service'
import { logger } from './lib/logger'

/**
 * A stripped-down version of the auth context we'd normally get from a workos JWT, so that we can also apply it
 * to daemon identities - since this service doesn't care about the differences.
 * hostId is only present for daemon tokens.
 */

/**
 * Tables in the database that have an organization_id filter
 */
export type OrganizationFilterableTable =
	| typeof sessions
	| typeof conversationEvents
	| typeof tasks
	| typeof projects
	| typeof onlineHosts

/**
 * This is a generic middleware that sets the table and organization ID filter for a shape stream
 * @param table
 * @returns
 */
export const withTableAndOrganizationFilter = (table: OrganizationFilterableTable) =>
	createMiddleware(async (c, next) => {
		// Set the table query param to the name of the table

		// Build type-safe where expression using the internal organization UUID
		const whereExpression = sql`${sql.identifier(table.organization_id.name)} = ${c.var.authContext.organizationId}`
		const queryBuilder = new QueryBuilder()
		const { sql: query, params } = queryBuilder.select().from(table).where(whereExpression).toSQL()
		const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')

		params.forEach((value, index) => {
			c.var.electricOriginUrl.searchParams.set(`params[${index + 1}]`, String(value))
		})
		c.var.electricOriginUrl.searchParams.set('where', fragment)
		c.var.electricOriginUrl.searchParams.set('table', getTableName(table))

		await next()
	})

/**
 * Creates an auth middleware. If testAuthContext is provided, it bypasses
 * real auth validation and uses the provided context directly (for testing).
 */
export const createAuthMiddleware = (config: AppConfig) => {
	const validateJWT = createJWTValidator(config.effectRuntime)

	return createMiddleware(async (c, next) => {
		// Test mode: bypass auth and use provided context
		if (config.testAuthContext) {
			c.set('authContext', config.testAuthContext)
			return next()
		}

		if (!config.validateDaemonToken) {
			logger.error('Auth middleware configured without auth services')
			return c.newResponse(null, StatusCodes.UNAUTHORIZED)
		}

		let authContext: SimpleAuthContext | null = null
		try {
			const authHeader = c.req.header('authorization')
			const daemonAuthHeader = c.req.header('x-daemon-authorization')

			// User authorization path
			if (authHeader) {
				const match = authHeader.match(/^Bearer (.+)$/)
				// Extract Bearer token
				if (!match || !match[1]) {
					logger.error('Unable to locate token in authorization header')
					authContext = null
				} else {
					// Validate JWT and extract auth context
					const token = match[1]
					authContext = await validateJWT(token)
				}
			}

			if (daemonAuthHeader) {
				try {
					const ctx = await config.validateDaemonToken(daemonAuthHeader)
					if (ctx)
						authContext = {
							organizationId: ctx.organizationId,
							userId: ctx.userId,
							hostId: ctx.hostId,
						}
				} catch (error) {
					logger.error('Daemon token validation failed', error)
				}
			}
		} catch (error) {
			// Only token *validation* failures are auth failures. next() must run OUTSIDE this
			// try/catch so a downstream handler error is never mislabeled as an auth_failure 401.
			Sentry.captureException(error, {
				tags: { error_type: 'auth_failure' },
			})
			return c.newResponse(null, StatusCodes.UNAUTHORIZED)
		}

		if (!authContext) return c.newResponse(null, StatusCodes.UNAUTHORIZED)

		Sentry.setUser({ id: authContext.userId })
		Sentry.setTag('organization_id', authContext.organizationId)
		c.set('authContext', {
			organizationId: authContext.organizationId,
			userId: authContext.userId,
			hostId: authContext.hostId,
		})
		return next()
	})
}

/**
 * Declares every response from a route untransformable by intermediaries:
 * `no-transform` is what opts the route out of the app-level compress
 * middleware (and any compliant proxy/CDN transform) — a buffering transform
 * would hold a stream's incremental chunks back. Mount this on any streaming
 * route and the compression exclusion follows automatically; no path list.
 *
 * Only the transform contract is ours — the upstream's caching policy
 * (no-store vs no-cache vs public, max-age) passes through untouched.
 * Cache-Control is a list header, so append() composes correctly.
 */
export const noTransformResponses = createMiddleware(async (c, next) => {
	await next()
	if (!(c.res.headers.get('Cache-Control') ?? '').toLowerCase().includes('no-transform')) {
		c.res.headers.append('Cache-Control', 'no-transform')
	}
	c.res.headers.set('X-Accel-Buffering', 'no')
})
