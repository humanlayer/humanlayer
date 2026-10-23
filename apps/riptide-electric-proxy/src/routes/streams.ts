import { Effect, Option, Schema } from 'effect'
import { Hono, type Context } from 'hono'
import { StatusCodes } from 'http-status-codes'

import type { AppConfig, SimpleAuthContext } from '../app-config'
import { type DurableStreamsIncomingRequest, DurableStreamsProxy } from '../lib/effect/durable-streams-proxy.service'
import { makeProxyRuntimeConfig } from '../lib/effect/proxy-runtime-config.service'
import { logger } from '../lib/logger'
import { canReadSession } from '../lib/queries'
import { isUuid } from '../lib/validation'
import { createAuthMiddleware, noTransformResponses } from '../middleware'

type StreamsEnv = { Variables: { authContext: SimpleAuthContext } }

function proxyToStreamWithRuntime(config: AppConfig, url: URL, incomingRequest: DurableStreamsIncomingRequest) {
	return config.effectRuntime.runPromise(
		Effect.gen(function* () {
			const proxy = yield* DurableStreamsProxy
			return yield* proxy.proxyStreamRequest(url, incomingRequest)
		}),
	)
}

export function createStreamsApp(
	config: AppConfig,
	options: { readonly sessions?: boolean; readonly taskDiffs?: boolean; readonly prStatus?: boolean } = {},
) {
	const app = new Hono<StreamsEnv>()
	const { durableStreamsBaseUrl } = makeProxyRuntimeConfig(config)

	app.use(noTransformResponses)
	app.use(createAuthMiddleware(config))

	const handleSessionStream = async (c: Context<StreamsEnv>) => {
		const sessionId = c.req.param('sessionId')
		if (!sessionId || !isUuid(sessionId)) {
			return c.json({ error: 'Invalid sessionId format' }, StatusCodes.BAD_REQUEST)
		}

		const { organizationId, userId, hostId } = c.var.authContext
		const isReadRequest = c.req.method === 'GET' || c.req.method === 'HEAD'
		if (!isReadRequest && !hostId) {
			return c.json({ error: 'Forbidden' }, StatusCodes.FORBIDDEN)
		}

		const authorized = await canReadSession(config.db, sessionId, userId, organizationId)
		if (!authorized) {
			return c.json({ error: 'Forbidden' }, StatusCodes.FORBIDDEN)
		}

		const url = new URL(`${durableStreamsBaseUrl}/v1/stream/sessions/${sessionId}`)
		url.search = new URL(c.req.url).search
		logger.info('Proxying Durable Stream request', {
			sessionId,
			method: c.req.method,
			incomingUrl: c.req.url,
			upstreamUrl: url.toString(),
		})
		return proxyToStreamWithRuntime(config, url, c.req)
	}

	if (options.sessions !== false) {
		app.all('/sessions/:sessionId', handleSessionStream)
		app.all('/sessions/:sessionId/*', handleSessionStream)
	}

	const handleTaskDiffStream =
		(streamName: 'diff-files' | 'diff-patches' | 'diff-file-versions') => async (c: Context<StreamsEnv>) => {
			const organizationId = c.req.param('organizationId')
			const taskId = c.req.param('taskId')
			if (!organizationId || !isUuid(organizationId)) {
				return c.json({ error: 'Invalid organizationId format' }, StatusCodes.BAD_REQUEST)
			}
			if (!taskId || !isUuid(taskId)) {
				return c.json({ error: 'Invalid taskId format' }, StatusCodes.BAD_REQUEST)
			}

			const authContext = c.var.authContext
			if (authContext.organizationId !== organizationId) {
				return c.json({ error: 'Forbidden' }, StatusCodes.FORBIDDEN)
			}
			const isReadRequest = c.req.method === 'GET' || c.req.method === 'HEAD'
			if (!isReadRequest && !authContext.hostId) {
				return c.json({ error: 'Forbidden' }, StatusCodes.FORBIDDEN)
			}
			const url = new URL(
				`${durableStreamsBaseUrl}/v1/stream/organizations/${organizationId}/tasks/${taskId}/${streamName}`,
			)
			url.search = new URL(c.req.url).search
			logger.info('Proxying task diff stream request', {
				organizationId,
				taskId,
				streamName,
				method: c.req.method,
				incomingUrl: c.req.url,
				upstreamUrl: url.toString(),
			})
			return proxyToStreamWithRuntime(config, url, c.req)
		}

	// `repoFullName` and `branch` may contain `/`; Hono hands them back decoded, and they are
	// re-encoded on the upstream rewrite below.
	const PrStatusStreamParams = Schema.Struct({
		organizationId: Schema.String.check(Schema.isUUID()),
		repoFullName: Schema.String.check(Schema.isBetweenLength(1, 255)),
		branch: Schema.String.check(Schema.isBetweenLength(1, 255)),
	})
	const decodePrStatusStreamParams = Schema.decodeUnknownOption(PrStatusStreamParams)

	const handlePrStatusStream = async (c: Context<StreamsEnv>) => {
		const params = decodePrStatusStreamParams({
			organizationId: c.req.param('organizationId'),
			repoFullName: c.req.param('repoFullName'),
			branch: c.req.param('branch'),
		})
		if (Option.isNone(params)) {
			return c.json({ error: 'Invalid stream parameters' }, StatusCodes.BAD_REQUEST)
		}
		const { organizationId, repoFullName, branch } = params.value

		const authContext = c.var.authContext
		if (authContext.organizationId !== organizationId) {
			return c.json({ error: 'Forbidden' }, StatusCodes.FORBIDDEN)
		}
		if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
			return c.json({ error: 'Forbidden' }, StatusCodes.FORBIDDEN)
		}

		const url = new URL(
			`${durableStreamsBaseUrl}/v1/stream/organizations/${organizationId}` +
				`/github/repos/${encodeURIComponent(repoFullName)}` +
				`/branches/${encodeURIComponent(branch)}/pr-status`,
		)
		url.search = new URL(c.req.url).search
		logger.info('Proxying PR status stream request', {
			organizationId,
			repoFullName,
			branch,
			method: c.req.method,
			incomingUrl: c.req.url,
			upstreamUrl: url.toString(),
		})
		return proxyToStreamWithRuntime(config, url, c.req)
	}

	if (options.prStatus !== false) {
		const path = '/organizations/:organizationId/github/repos/:repoFullName/branches/:branch/pr-status'
		app.all(path, handlePrStatusStream)
		app.all(`${path}/*`, handlePrStatusStream)
	}

	if (options.taskDiffs !== false) {
		const handleTaskDiffFilesStream = handleTaskDiffStream('diff-files')
		app.all('/organizations/:organizationId/tasks/:taskId/diff-files', handleTaskDiffFilesStream)
		app.all('/organizations/:organizationId/tasks/:taskId/diff-files/*', handleTaskDiffFilesStream)
		const handleTaskDiffPatchesStream = handleTaskDiffStream('diff-patches')
		app.all('/organizations/:organizationId/tasks/:taskId/diff-patches', handleTaskDiffPatchesStream)
		app.all('/organizations/:organizationId/tasks/:taskId/diff-patches/*', handleTaskDiffPatchesStream)
		const handleTaskDiffFileVersionsStream = handleTaskDiffStream('diff-file-versions')
		app.all('/organizations/:organizationId/tasks/:taskId/diff-file-versions', handleTaskDiffFileVersionsStream)
		app.all('/organizations/:organizationId/tasks/:taskId/diff-file-versions/*', handleTaskDiffFileVersionsStream)
	}

	return app
}
