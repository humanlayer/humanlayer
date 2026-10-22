import type { AuthContext, AuthContextOptionalOrg } from '../../src/auth/jwt-validator'
import type { ApiContext, DaemonAuthContext, DaemonContext, Services } from '../../src/orpc/base'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import {
	createDefaultTestEffectRuntime,
	createRuntimeWithTestPostgresLayer,
	type TestRuntimeOptions,
	workosLayerFromTestSdkAdapter,
} from '../utils/effect-procedure-test-runtime'
import { createMockJiraService } from './jira-service.mock'
import { createMockLinearService } from './linear-service.mock'
import { createMockS3Service } from './s3-service.mock'
import { createMockStripeService } from './stripe-service.mock'
import { createMockWorkosService } from './workos-service.mock'

/**
 * The single source of truth for default service mocks used by `call()`-based tests.
 *
 * Every context factory (`createMockApiContext`, `createMockApiContextNoOrg`,
 * `createMockDaemonContext`) and the headless-app `createTestServices` factory layer
 * on top of this function, so adding a new service to `Services` only requires a
 * default here. Overrides shallow-merge on top; pass only the services a test customizes.
 *
 * Billing access and entitlements are Effect services in the runtime, so a test that supplies
 * its own `effectRuntime` must build it with those runtime options instead.
 */
export function createMockServices(
	overrides?: Partial<Services>,
	runtimeOptions?: Pick<TestRuntimeOptions, 'billingAccess' | 'entitlements'>,
): Services {
	const kv = new TestBillingKvService()
	const billingKv = billingKvLayerFromTestService(kv)
	const effectRuntime =
		overrides?.effectRuntime ??
		(overrides?.db
			? createRuntimeWithTestPostgresLayer(overrides.db, {
					...(overrides.workos ? { workos: workosLayerFromTestSdkAdapter(overrides.workos) } : {}),
					billingKv,
					...runtimeOptions,
				})
			: createDefaultTestEffectRuntime({ billingKv, ...runtimeOptions }))
	return {
		workos: createMockWorkosService(),
		stripe: createMockStripeService(),
		s3: createMockS3Service(),
		jira: createMockJiraService(),
		linear: createMockLinearService(),
		db: {} as Services['db'],
		dbReadReplica: {} as Services['dbReadReplica'],
		effectRuntime,
		...overrides,
	}
}

/**
 * Create a mock API auth context with organization (for apiBaseOrgRequired routes)
 *
 * @example
 * ```ts
 * const auth = createMockApiAuth({ userId: 'user-123' })
 * // or with all defaults
 * const auth = createMockApiAuth()
 * ```
 */
export function createMockApiAuth(overrides?: Partial<AuthContext>): AuthContext {
	return {
		userId: 'test-user-id',
		organizationId: 'test-org-id',
		workosOrganizationId: 'workos-org-id',
		role: '',
		roles: [],
		permissions: [],
		entitlements: [],
		sessionId: 'test-session-id',
		...overrides,
	}
}

/**
 * Create a mock API auth context without organization (for apiBaseNoOrg routes)
 *
 * @example
 * ```ts
 * const auth = createMockApiAuthNoOrg({ userId: 'user-123' })
 * // or with all defaults (no org)
 * const auth = createMockApiAuthNoOrg()
 * ```
 */
export function createMockApiAuthNoOrg(overrides?: Partial<AuthContextOptionalOrg>): AuthContextOptionalOrg {
	return {
		userId: 'test-user-id',
		organizationId: undefined,
		workosOrganizationId: undefined,
		role: '',
		roles: [],
		permissions: [],
		entitlements: [],
		sessionId: 'test-session-id',
		...overrides,
	}
}

/**
 * Create a mock daemon auth context (for daemonBase routes)
 *
 * @example
 * ```ts
 * const auth = createMockDaemonAuth({ hostId: 'host-abc' })
 * // or with all defaults
 * const auth = createMockDaemonAuth()
 * ```
 */
export function createMockDaemonAuth(overrides?: Partial<DaemonAuthContext>): DaemonAuthContext {
	return {
		userId: 'test-user-id',
		organizationId: 'test-org-id',
		hostId: 'test-host-id',
		...overrides,
	}
}

/**
 * Create a full mock API context (auth + services) for use with call()
 *
 * @example
 * ```ts
 * import { call } from '@orpc/server'
 *
 * const ctx = createMockApiContext({
 *   auth: { userId: 'user-123' },
 *   services: { workos: myMockWorkos, db: myMockDb }
 * })
 * const result = await call(procedure, input, { context: ctx })
 * ```
 */
export function createMockApiContext(overrides?: {
	auth?: Partial<AuthContext> | null
	services?: Partial<Services>
	billingAccess?: TestRuntimeOptions['billingAccess']
	entitlements?: TestRuntimeOptions['entitlements']
}): ApiContext {
	return {
		auth: overrides?.auth === null ? null : createMockApiAuth(overrides?.auth),
		services: createMockServices(overrides?.services, {
			billingAccess: overrides?.billingAccess,
			entitlements: overrides?.entitlements,
		}),
	}
}

/**
 * Create a full mock API context without org (auth + services) for use with call()
 *
 * @example
 * ```ts
 * import { call } from '@orpc/server'
 *
 * const ctx = createMockApiContextNoOrg({
 *   auth: { userId: 'user-123' },
 *   services: { workos: myMockWorkos }
 * })
 * const result = await call(listOrganizations, {}, { context: ctx })
 * ```
 */
export function createMockApiContextNoOrg(overrides?: {
	auth?: Partial<AuthContextOptionalOrg> | null
	services?: Partial<Services>
	billingAccess?: TestRuntimeOptions['billingAccess']
	entitlements?: TestRuntimeOptions['entitlements']
}): ApiContext {
	return {
		auth: overrides?.auth === null ? null : createMockApiAuthNoOrg(overrides?.auth),
		services: createMockServices(overrides?.services, {
			billingAccess: overrides?.billingAccess,
			entitlements: overrides?.entitlements,
		}),
	}
}

/**
 * Create a full mock daemon context (auth + services) for use with call()
 *
 * @example
 * ```ts
 * import { call } from '@orpc/server'
 *
 * const ctx = createMockDaemonContext({
 *   auth: { hostId: 'host-abc' },
 *   services: { db: myMockDb }
 * })
 * const result = await call(daemonProcedure, input, { context: ctx })
 * ```
 */
export function createMockDaemonContext(overrides?: {
	auth?: Partial<DaemonAuthContext> | null
	services?: Partial<Services>
	billingAccess?: TestRuntimeOptions['billingAccess']
	entitlements?: TestRuntimeOptions['entitlements']
}): DaemonContext {
	return {
		auth: overrides?.auth === null ? null : createMockDaemonAuth(overrides?.auth),
		services: createMockServices(overrides?.services, {
			billingAccess: overrides?.billingAccess,
			entitlements: overrides?.entitlements,
		}),
	}
}
