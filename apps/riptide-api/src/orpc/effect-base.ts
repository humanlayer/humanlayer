/**
 * This file creates effect wrappers of existing bases so we can build effect procedures
 * using existing non-effect bases
 */

import { implementEffect } from '@humanlayer/effect-orpc'
import { RiptideApiContract, RiptideDaemonApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { ORPCError } from '@orpc/contract'
import { Effect } from 'effect'

import type { AuthContext, AuthContextOptionalOrg } from '../auth/jwt-validator'
import { appRuntime } from '../effects/app-runtime'
import { decideBillingAccess } from '../effects/services/billing/billing-access.service'
import { hasFeature } from '../effects/services/billing/entitlements.service'
import { sharesMetricsWithMembers } from '../effects/services/metrics/metrics-audience'
import { Sentry } from '../instrument'
import { isBillingEnforcementEnabled } from '../lib/environment'
import { type DaemonAuthContext, isAuthContextWithOrg, isOrganizationAdmin, type Services } from './base'

const runLog = (effect: Effect.Effect<void>) => Effect.runSync(effect)

function getErrorString(error: unknown): string {
	try {
		return String(error)
	} catch {
		return '[unable to stringify error]'
	}
}

function getErrorName(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
		? error.name
		: undefined
}

function getErrorMessage(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
		? error.message
		: undefined
}

function getErrorStack(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string'
		? error.stack
		: undefined
}

function getEffectCausePretty(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('effectCausePretty' in error)) return undefined
	return typeof error.effectCausePretty === 'string' ? error.effectCausePretty : undefined
}

function logEffectOrpcError(error: unknown, path: readonly string[] | undefined): void {
	const procedureName = path?.join('.') ?? 'unknown'
	if (error instanceof ORPCError) {
		const cause = error.cause
		runLog(
			Effect.logError('Effect oRPC procedure failed', error).pipe(
				Effect.annotateLogs({
					code: error.code,
					defined: error.defined,
					cause,
					causeName: getErrorName(cause),
					causeMessage: getErrorMessage(cause),
					causeString: cause === undefined ? undefined : getErrorString(cause),
					causeStack: getErrorStack(cause),
					data: error.data,
					effectCausePretty: getEffectCausePretty(error),
					procedureName,
				}),
			),
		)
		return
	}

	runLog(
		Effect.logError('Effect oRPC procedure failed unexpectedly', error).pipe(
			Effect.annotateLogs({ procedureName }),
		),
	)
}

/**
 * True for a failure that is a client/business outcome rather than a server bug: a declared
 * oRPC error or any 4xx. A NOT_FOUND/FORBIDDEN/BAD_REQUEST must never reach Sentry.
 *
 * The `error.defined` check alone is insufficient here — the effect-orpc bridge does not
 * seed its runtime error map from the contract, so errors raised via the `errors` bag
 * (e.g. `errors.NOT_FOUND()`) arrive with `defined: false` even though the contract
 * declares them. Status-based classification is correct regardless (see RIPTIDE-API-CD).
 *
 * Exported so a procedure that taps its own error channel (to capture a rich cause before
 * mapping it to a flat 5xx) can apply the SAME filter the base does, instead of bypassing it.
 */
export function isExpectedClientError(error: unknown): boolean {
	return error instanceof ORPCError && (error.defined || error.status < 500)
}

function captureUnexpectedEffectOrpcError(error: unknown, path?: readonly string[]): void {
	if (isExpectedClientError(error)) return
	Sentry.captureException(error, {
		fingerprint: path ? ['{{ default }}', path.join('.')] : ['{{ default }}'],
		tags: path ? { operation: path.join('.'), route_group: path[0] } : undefined,
	})
}

/**
 * NOTE: the servies ARE available but we do NOT want them - we want to encourage
 * using dependency injection with Effect layers into the runtime
 * so our implementer mutes the context.services key:
 */

export type EffectApiContext = {
	auth: AuthContextOptionalOrg | null
	// services: Services // muted
	headers?: Headers | Record<string, string | undefined>
	requestIp?: string
}

const effectImplementer = implementEffect(RiptideApiContract, appRuntime).$context<EffectApiContext>()

function setUserSentryContext(auth: AuthContext) {
	Sentry.setUser({ id: auth.userId })
	Sentry.setTag('auth_type', 'user')
	Sentry.setTag('organization_id', auth.organizationId)
	Sentry.setTag('workos_organization_id', auth.workosOrganizationId)
}

/**
 * Reusable middlware to require that the user has an organization, will be used on various API bases
 */
const organizationRequired = effectImplementer.middleware(async ({ context, next, errors }) => {
	if (!isAuthContextWithOrg(context.auth)) {
		throw errors.ORGANIZATION_REQUIRED({
			data: { message: 'Please select an organization to continue' },
		})
	}
	setUserSentryContext(context.auth)
	// TypeScript knows auth is AuthContext after type guard
	return next({ context: { requestId: context.requestIp, headers: context.headers, auth: context.auth } })
})

/**
 * Effect-aware oRPC base that requires the user have an organization
 */
export const effectOrpcBaseOrganizationRequired = effectImplementer // First: Check auth exists, narrow from null
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { requestId: context.requestIp, headers: context.headers, auth: context.auth } })
	})
	// Second: Require organization, narrow to AuthContext
	.use(organizationRequired)
	.annotateSpan(({ context, path }) => ({
		operation: path.join('.'),
		route_group: path[0],
		auth_type: isAuthContextWithOrg(context.auth) ? 'user' : 'anonymous',
		user_id: context.auth?.userId,
		organization_id: isAuthContextWithOrg(context.auth) ? context.auth.organizationId : undefined,
		workos_organization_id: isAuthContextWithOrg(context.auth) ? context.auth.workosOrganizationId : undefined,
	}))
	// Third: Sentry error capture
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			logEffectOrpcError(error, path)
			captureUnexpectedEffectOrpcError(error, path)
			throw error
		}
	})

/**
 * Effect-aware public oRPC base. Mirrors the classic {@link apiBasePublic}: no auth
 * narrowing (anonymous callers are allowed and `context.auth` may be null), just span
 * annotation plus error logging/Sentry capture. Used by public Effect procedures such
 * as access-request creation, which resolve their dependencies (Postgres, WorkOS,
 * AccessRequestService) from the shared `appRuntime` instead of `context.services`.
 */
export const effectOrpcBasePublic = effectImplementer
	.annotateSpan(({ context, path }) => ({
		operation: path.join('.'),
		route_group: path[0],
		auth_type: isAuthContextWithOrg(context.auth) ? 'user' : 'anonymous',
		user_id: context.auth?.userId,
		organization_id: isAuthContextWithOrg(context.auth) ? context.auth.organizationId : undefined,
		workos_organization_id: isAuthContextWithOrg(context.auth) ? context.auth.workosOrganizationId : undefined,
	}))
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			logEffectOrpcError(error, path)
			captureUnexpectedEffectOrpcError(error, path)
			throw error
		}
	})

/**
 * Effect-aware oRPC base for organization admin routes. Mirrors the classic
 * {@link apiBaseForOrganizationAdmin}: requires auth (non-null), requires an
 * organization, requires the admin role, then annotates the span and captures
 * unexpected failures to Sentry. Admin Effect procedures (e.g. access-request archive)
 * obtain their dependencies from the shared `appRuntime`.
 */
export const effectOrpcBaseForOrganizationAdmin = effectImplementer
	// First: Check auth exists, narrow from null
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { requestId: context.requestIp, headers: context.headers, auth: context.auth } })
	})
	// Second: Require organization, narrow to AuthContext
	.use(organizationRequired)
	// Third: Require admin role
	.use(async ({ context, next, errors }) => {
		if (!isOrganizationAdmin(context.auth)) {
			throw errors.FORBIDDEN()
		}
		return next({ context })
	})
	.annotateSpan(({ context, path }) => ({
		operation: path.join('.'),
		route_group: path[0],
		auth_type: 'user',
		user_id: context.auth?.userId,
		organization_id: isAuthContextWithOrg(context.auth) ? context.auth.organizationId : undefined,
		workos_organization_id: isAuthContextWithOrg(context.auth) ? context.auth.workosOrganizationId : undefined,
	}))
	// Fourth: Sentry error capture
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			logEffectOrpcError(error, path)
			captureUnexpectedEffectOrpcError(error, path)
			throw error
		}
	})

/**
 * Effect-aware oRPC base for the Advanced Metrics routes. Mirrors the classic
 * {@link apiBaseForAdvancedMetrics}: the billing entitlement, so the per-member cost aggregates
 * stay unreachable — even to an org admin hitting the RPC directly — unless the org pays for
 * Riptide, and then the audience gate, so a non-admin member reaches them only where an admin has
 * opened the page to the whole org.
 *
 * Native middleware, not an Effect one: the implementer exposes the Effect `.use(function* …)`
 * overload only on a contract leaf, so a router-level base can take native middleware only.
 */
const advancedMetricsRequired = effectImplementer.middleware<{ auth: AuthContext; services: Services }, unknown>(
	async ({ context, next, errors }) => {
		const metricsContext = context as { auth: AuthContext; services: Services }
		const entitled = await hasFeature(
			metricsContext.services.effectRuntime,
			metricsContext.auth.organizationId,
			'advancedMetrics',
		)
		if (!entitled) {
			throw errors.FORBIDDEN()
		}
		const shares = await sharesMetricsWithMembers(metricsContext.services.effectRuntime, {
			organizationId: metricsContext.auth.organizationId,
			isAdmin: isOrganizationAdmin(metricsContext.auth),
		})
		if (!shares) {
			throw errors.FORBIDDEN()
		}
		return next({ context: metricsContext })
	},
)

export const effectOrpcBaseForAdvancedMetrics = effectOrpcBaseOrganizationRequired.use(advancedMetricsRequired)

/**
 * Middleware on the effect implementer for a procedure whick requires billing
 */
export const requiresBillingEffectMiddleware = effectImplementer.middleware<
	{ auth: AuthContext; services: Services },
	unknown
>(async ({ context, next, errors, path }) => {
	const billingContext = context as { auth: AuthContext; services: Services }
	if (!isBillingEnforcementEnabled()) {
		return next({ context: billingContext })
	}

	const procedureName = path.join('.')
	try {
		const decision = await billingContext.services.effectRuntime.runPromise(
			decideBillingAccess({ organizationId: billingContext.auth.organizationId, operation: procedureName }),
		)

		if (decision === 'fail_open') {
			runLog(
				Effect.logWarning('Billing enforcement failed open for billing-required operation').pipe(
					Effect.annotateLogs({ procedureName }),
				),
			)
			Sentry.captureMessage('Billing enforcement failed open for billing-required operation', {
				level: 'warning',
				tags: { error_type: 'billing_enforcement_fail_open', procedure: procedureName },
			})
			return next({ context: billingContext })
		}

		if (decision === 'blocked') {
			runLog(
				Effect.logInfo('Billing enforcement blocked billing-required operation').pipe(
					Effect.annotateLogs({ procedureName }),
				),
			)
			throw errors.BILLING_REQUIRED()
		}

		return next({ context: billingContext })
	} catch (error) {
		if (error instanceof ORPCError) throw error
		runLog(
			Effect.logError('Billing middleware failed unexpectedly', error).pipe(
				Effect.annotateLogs({ procedureName }),
			),
		)
		Sentry.captureException(error, {
			tags: { error_type: 'billing_middleware_failure', procedure: procedureName },
		})
		throw errors.SERVICE_UNAVAILABLE()
	}
})

/**
 * Effect oRPC context for daemon-authenticated routes.
 *
 * Like {@link EffectApiContext}, the classic `services` bag is intentionally muted so
 * daemon Effect procedures obtain their dependencies from the shared `appRuntime`
 * layers. The billing middleware below reads the request's `services.effectRuntime`.
 */
export type EffectDaemonContext = {
	auth: DaemonAuthContext | null
	// services: Services // muted
	headers?: Headers | Record<string, string | undefined>
	requestIp?: string
}

const effectDaemonImplementer = implementEffect(RiptideDaemonApiContract, appRuntime).$context<EffectDaemonContext>()

/**
 * Effect-aware daemon oRPC base. Requires daemon auth (non-null) and captures
 * unexpected failures to Sentry, mirroring the classic `daemonBase`.
 */
export const effectOrpcDaemonBase = effectDaemonImplementer
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth, headers: context.headers, requestId: context.requestIp } })
	})
	.annotateSpan(({ context, path }) => ({
		operation: path.join('.'),
		route_group: path[0],
		auth_type: 'daemon',
		user_id: context.auth?.userId,
		organization_id: context.auth?.organizationId,
		host_id: context.auth?.hostId,
	}))
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			logEffectOrpcError(error, path)
			captureUnexpectedEffectOrpcError(error, path)
			throw error
		}
	})

/**
 * Billing guard for daemon-authenticated Effect routes.
 *
 * Reads organizationId from context.auth (daemon token claims). Daemon tokens are
 * long-lived, so billing is evaluated on every billing-gated request. This mirrors the
 * classic `requiresDaemonBillingMiddleware` exactly, including the fail-open behavior
 * when the billing service is missing, so converting a daemon route to Effect does not
 * change billing enforcement.
 */
export const requiresDaemonBillingEffectMiddleware = effectDaemonImplementer.middleware<
	{ auth: DaemonAuthContext; services: Services },
	unknown
>(async ({ context, next, errors, path }) => {
	const daemonContext = context as { auth: DaemonAuthContext; services: Services }
	if (!isBillingEnforcementEnabled()) {
		return next({ context: daemonContext })
	}

	const procedureName = path.join('.')
	try {
		const decision = await daemonContext.services.effectRuntime.runPromise(
			decideBillingAccess({ organizationId: daemonContext.auth.organizationId, operation: procedureName }),
		)

		if (decision === 'fail_open') {
			runLog(
				Effect.logWarning('Billing enforcement failed open for daemon billing-required operation').pipe(
					Effect.annotateLogs({ procedureName }),
				),
			)
			Sentry.captureMessage('Billing enforcement failed open for daemon billing-required operation', {
				level: 'warning',
				tags: { error_type: 'billing_enforcement_fail_open', procedure: procedureName },
			})
			return next({ context: daemonContext })
		}

		if (decision === 'blocked') {
			runLog(
				Effect.logInfo('Billing enforcement blocked daemon billing-required operation').pipe(
					Effect.annotateLogs({ procedureName }),
				),
			)
			throw errors.BILLING_REQUIRED()
		}

		return next({ context: daemonContext })
	} catch (error) {
		if (error instanceof ORPCError) throw error
		runLog(
			Effect.logError('Daemon billing middleware failed unexpectedly', error).pipe(
				Effect.annotateLogs({ procedureName }),
			),
		)
		Sentry.captureException(error, {
			tags: { error_type: 'billing_middleware_failure', procedure: procedureName },
		})
		throw errors.SERVICE_UNAVAILABLE()
	}
})
