import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { getTableName } from 'drizzle-orm'
import { Effect } from 'effect'
import { Hono } from 'hono'

import type { AppConfig } from '../app-config'
import { ElectricProxy } from '../lib/effect/electric-proxy.service'
import type { ElectricRequestContext } from '../lib/electric-error-handler'
import {
	buildAgentSlashCommandsColumns,
	buildOnlineHostsColumns,
	buildWhereFragmentForOrgScopedRows,
} from '../lib/v2-where-builder'
import { applyWhereToUrl } from '../lib/where-builder'
import { createAuthMiddleware } from '../middleware'
import { createElectricOriginMiddleware } from './electric-origin'

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

/**
 * v3 routes exist for shapes whose contract diverged from v2; v2 routes stay
 * untouched so released clients keep their expected row shapes.
 */
export function createV3App(config: AppConfig) {
	const app = new Hono()

	app.use(createAuthMiddleware(config))
	app.use(createElectricOriginMiddleware(config))

	// Same auth scoping as /v2/hosts. All registration columns are synchronized,
	// including heartbeat timestamps and durable online/offline status updates.
	app.all('/hosts', async (c) => {
		c.var.electricOriginUrl.searchParams.set('table', getTableName(onlineHosts))
		c.var.electricOriginUrl.searchParams.set('columns', buildOnlineHostsColumns())
		const { fragment, params } = buildWhereFragmentForOrgScopedRows(onlineHosts, c.var.authContext)
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	app.all('/agent-slash-commands', async (c) => {
		c.var.electricOriginUrl.searchParams.set('table', getTableName(agentSlashCommands))
		c.var.electricOriginUrl.searchParams.set('columns', buildAgentSlashCommandsColumns())
		c.var.electricOriginUrl.searchParams.set('replica', 'full')
		const { fragment, params } = buildWhereFragmentForOrgScopedRows(agentSlashCommands, c.var.authContext, {
			additionalConditions: [{ column: agentSlashCommands.user_id, value: c.var.authContext.userId }],
		})
		applyWhereToUrl(c.var.electricOriginUrl, fragment, params)
		return proxyElectricResponseWithRuntime(config, c.var.electricOriginUrl, undefined, c.req)
	})

	return app
}
