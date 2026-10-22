/**
 * Test-mode app factory for riptide-api.
 *
 * Creates a Hono app with the same oRPC handler mounting as app.ts but accepts
 * injected dependencies instead of module-level singletons. No side effects:
 * no `import './instrument'`, no `jwksCache.start()`, no env var reads.
 *
 * Used by API tests that spin up a headless server with injected dependencies
 * such as the database, WorkOS, API auth, and daemon auth.
 */

import { serve } from '@hono/node-server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { getAuthContext } from '../src/auth/context'
import type { AuthContextOptionalOrg } from '../src/auth/jwt-validator'
import type { AppRuntime } from '../src/effects/app-runtime'
import { AccessRequestService } from '../src/effects/services/access-request/access-request.service'
import type { IJiraService } from '../src/lib/jira-service'
import type { ILinearService } from '../src/lib/linear-service'
import type { IS3Service } from '../src/lib/s3-service'
import type { IStripeService } from '../src/lib/stripe-service'
import type { WorkosSdkAdapter } from '../src/lib/workos-service'
import { apiHandler, daemonApiHandler } from '../src/orpc'
import type { ApiContext, DaemonAuthContext, DaemonContext, Services } from '../src/orpc/base'
import { type ResendWebhookDeps, registerResendWebhookRoute } from '../src/webhooks/resend'
import { registerSlackInteractionsRoute } from '../src/webhooks/slack'
import { registerStripeWebhookRoute } from '../src/webhooks/stripe'
import { registerWorkosWebhookRoute } from '../src/webhooks/workos'
import { billingKvLayerFromTestService, TestBillingKvService } from './fixtures/billing-kv-runtime'
import { createMockServices } from './mocks/auth-context.mock'
import { createRuntimeWithTestPostgresLayer, type TestRuntimeOptions } from './utils/effect-procedure-test-runtime'

export type { AuthContextOptionalOrg } from '../src/auth/jwt-validator'
// Re-exports for test fixtures
export type { WorkosSdkAdapter } from '../src/lib/workos-service'
export { createMockStripeService } from './mocks/stripe-service.mock'

/** No-op S3 service for tests that don't need real presigned URLs */
const noopS3: IS3Service = {
	getPresignedUploadUrl: async () => 'https://test-upload-url',
	getPresignedDownloadUrl: async () => 'https://test-download-url',
}

/** No-op Linear service for tests that don't need real Linear integration */
const noopLinear: ILinearService = {
	createInstallUrl: async () => {
		throw new Error('Linear not configured in test environment')
	},
	consumeInstallState: async () => {
		throw new Error('Linear not configured in test environment')
	},
	exchangeCode: async () => {
		throw new Error('Linear not configured in test environment')
	},
	getIntegrationStatus: async () => ({ enabled: false, connected: false, needsReauth: false }),
	disconnect: async () => {
		throw new Error('Linear not configured in test environment')
	},
	updateIssueStatus: async () => {
		throw new Error('Linear not configured in test environment')
	},
	createAttachment: async () => {
		throw new Error('Linear not configured in test environment')
	},
	getIssueMetadata: async () => {
		throw new Error('Linear not configured in test environment')
	},
	getIssue: async () => {
		throw new Error('Linear not configured in test environment')
	},
	getAccessToken: async () => {
		throw new Error('Linear not configured in test environment')
	},
}

/** No-op Jira service for tests that don't need real Jira integration */
const noopJira: IJiraService = {
	createInstallUrl: async () => {
		throw new Error('Jira not configured in test environment')
	},
	consumeInstallState: async () => {
		throw new Error('Jira not configured in test environment')
	},
	exchangeCode: async () => {
		throw new Error('Jira not configured in test environment')
	},
	getIntegrationStatus: async () => ({ enabled: false, connected: false, needsReauth: false, siteUrl: null }),
	getIssue: async () => {
		throw new Error('Jira not configured in test environment')
	},
	createRemoteLink: async () => {
		throw new Error('Jira not configured in test environment')
	},
	disconnect: async () => {
		throw new Error('Jira not configured in test environment')
	},
}

const noopResendWebhookDeps: ResendWebhookDeps = {
	resend: {
		webhooks: {
			verify: ({ payload }) => JSON.parse(payload),
		},
	},
	webhookSecret: 'test_resend_webhook_secret',
}

/**
 * A no-op logger used as the default for webhook routes whose deps require a
 * logger. Tests that need to assert route-level warn/info emissions construct
 * their own capturing logger (the Resend webhook test's injected-logger arrays
 * are the pattern) — see also `createApp`'s webhook registrations below.
 *
 * Method returns match `@humanlayer/logger`'s `Promise<void>` signature so this
 * value is assignable to `Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>`.
 */
const noopLogger = {
	info: async () => {},
	warn: async () => {},
	error: async () => {},
}

export type TestAppConfig = {
	/** Database client for all oRPC handlers */
	db: PostgresJsDatabase
	/** Optional read replica — falls back to db if not provided */
	dbReadReplica?: PostgresJsDatabase
	/** WorkOS service for auth routes */
	workos: WorkosSdkAdapter
	/** S3 service — defaults to no-op mock */
	s3?: IS3Service
	/** Jira service — defaults to no-op mock */
	jira?: IJiraService
	/** Linear service — defaults to no-op mock */
	linear?: ILinearService
	/** Stripe service for billing, provisioning, and seat sync routes */
	stripe: IStripeService
	/** Test-only billing KV store used to build the Effect runtime. */
	kv?: TestBillingKvService
	/** App Effect runtime seam — defaults to the canonical test runtime mock */
	effectRuntime?: AppRuntime
	billingAccess?: TestRuntimeOptions['billingAccess']
	entitlements?: TestRuntimeOptions['entitlements']
	/** Resend webhook dependencies — defaults to a no-op JSON verifier */
	resendWebhook?: ResendWebhookDeps
	/**
	 * Test API auth context — if provided, bypasses JWT validation for all
	 * /rpc/api/v1/* requests. Same bypass pattern as electric proxy testAuthContext.
	 */
	testApiAuth?: AuthContextOptionalOrg
	/**
	 * Test daemon auth context — if provided, bypasses token validation for all
	 * /rpc/daemon/v1/* requests.
	 */
	testDaemonAuth?: DaemonAuthContext
}

export type TestServicesConfig = Pick<
	TestAppConfig,
	| 'db'
	| 'dbReadReplica'
	| 'workos'
	| 's3'
	| 'jira'
	| 'linear'
	| 'stripe'
	| 'kv'
	| 'billingAccess'
	| 'entitlements'
	| 'effectRuntime'
>

/**
 * Build the `Services` bag for the headless test app.
 *
 * Layers on top of `createMockServices` (the single canonical default list) and
 * overrides only the services that need a bootable no-op rather than a
 * throw-by-default mock — `s3`, `jira`, `linear`, `kv` — plus the caller-supplied
 * `workos`/`stripe`/`db`. A new service is added in one place (`createMockServices`)
 * and only needs an override here if its throw-by-default mock would break app boot.
 *
 * The access-request procedure group + webhook backfill run through `AccessRequestService`
 * on the shared `appRuntime` (or, for the webhook test seam, a runtime built with the test
 * db — see `createApp`), so the classic service bag no longer carries an access-request
 * service.
 */
export function createTestServices(config: TestServicesConfig): Services {
	const dbReadReplica = config.dbReadReplica ?? config.db
	const kv = config.kv ?? new TestBillingKvService()
	const effectRuntime =
		config.effectRuntime ??
		createRuntimeWithTestPostgresLayer(config.db, {
			billingKv: billingKvLayerFromTestService(kv),
			billingAccess: config.billingAccess,
			entitlements: config.entitlements,
		})

	return createMockServices({
		workos: config.workos,
		db: config.db,
		dbReadReplica,
		s3: config.s3 ?? noopS3,
		jira: config.jira ?? noopJira,
		linear: config.linear ?? noopLinear,
		stripe: config.stripe,
		// Only override when supplied so the canonical default test runtime from
		// `createMockServices` is preserved otherwise.
		effectRuntime,
	})
}

function getRequestIp(req: Request): string | undefined {
	return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

export function createTestApiContext(input: {
	auth?: AuthContextOptionalOrg | null
	services: Services
	request?: Request
}): ApiContext {
	return {
		auth: input.auth ?? null,
		headers: input.request?.headers,
		requestIp: input.request ? getRequestIp(input.request) : undefined,
		services: input.services,
	}
}

export function createTestDaemonContext(input: { auth?: DaemonAuthContext | null; services: Services }): DaemonContext {
	return {
		auth: input.auth ?? null,
		services: input.services,
	}
}

/**
 * Create a headless Hono app that mounts the oRPC handlers at the same paths
 * as the production app.ts, but with injected dependencies.
 */
export function createApp(config: TestAppConfig): Hono {
	const services = createTestServices(config)
	const resendWebhook = config.resendWebhook ?? noopResendWebhookDeps

	// Test seam for the WorkOS webhook's access-request backfill. The webhook is not an
	// oRPC procedure, so it can't bind to `appRuntime`; build a runtime backed by the
	// injected TEST db (with fake WorkOS/Resend layers) using the shared test-runtime
	// helper, which wires a real `AccessRequestService` against that db. Running
	// `backfillRequesterUserId` through it lands backfill writes in the test database.
	// Mirrors the production facade in `app.ts`, which uses the live `appRuntime` instead.
	const accessRequestRuntime = createRuntimeWithTestPostgresLayer(services.db)
	const backfillAccessRequestRequesterUserId = (input: { email: string; userId: string }): Promise<void> =>
		accessRequestRuntime.runPromise(
			Effect.gen(function* () {
				const accessRequests = yield* AccessRequestService
				yield* accessRequests.backfillRequesterUserId(input)
			}),
		)

	const app = new Hono()

	// Enable CORS (same as production)
	app.use('*', cors())
	registerStripeWebhookRoute(app, { appRuntime: services.effectRuntime })
	registerWorkosWebhookRoute(app, {
		workosService: services.workos,
		stripeService: services.stripe,
		db: services.db,
		backfillAccessRequestRequesterUserId,
	})
	registerResendWebhookRoute(app, resendWebhook)
	// `logger` is a required no-op by default; a test that wants to assert the rejection
	// warn should build its own capturing logger (mirroring the Resend webhook test).
	// The Slack config comes from the injected `effectRuntime` seam
	// (`services.effectRuntime`), not the classic service bag.
	registerSlackInteractionsRoute(app, { appRuntime: services.effectRuntime, logger: noopLogger })

	// Mount API oRPC handler
	app.use('/rpc/api/v1/*', async (c, next) => {
		let auth: AuthContextOptionalOrg | null
		if (config.testApiAuth !== undefined) {
			auth = config.testApiAuth
		} else {
			try {
				auth = await getAuthContext(c.req.raw, services.effectRuntime)
			} catch {
				return c.json({ error: 'Authentication unavailable' }, 503)
			}
		}

		const { matched, response } = await apiHandler.handle(c.req.raw, {
			prefix: '/rpc/api/v1',
			context: createTestApiContext({ auth, services, request: c.req.raw }),
		})

		if (matched) {
			return c.newResponse(response.body, response)
		}

		await next()
	})

	// Mount daemon oRPC handler
	app.use('/rpc/daemon/v1/*', async (c, next) => {
		const { matched, response } = await daemonApiHandler.handle(c.req.raw, {
			prefix: '/rpc/daemon/v1',
			context: createTestDaemonContext({ auth: config.testDaemonAuth, services }),
		})

		if (matched) {
			return c.newResponse(response.body, response)
		}

		await next()
	})

	return app
}

/**
 * Start a Hono app using Node's HTTP server. Port 0 lets the OS assign a free port.
 * Returns a Bun.serve-compatible subset — call .stop() to shut down.
 */
export function startServer(app: Hono, port = 0) {
	const server = serve({ fetch: app.fetch, port })
	const address = server.address()
	const assignedPort = typeof address === 'object' && address !== null ? address.port : port

	return {
		port: assignedPort,
		stop: (_force?: boolean) => {
			;(server as { closeAllConnections?: () => void }).closeAllConnections?.()
			server.close()
		},
	}
}
