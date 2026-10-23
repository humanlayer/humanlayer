import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

export const PUBLIC_ENVIRONMENTS = ['prod', 'beta', 'dev', 'local'] as const
export const PublicEnvironment = Schema.Literals(PUBLIC_ENVIRONMENTS)
export type PublicEnvironment = typeof PublicEnvironment.Type

export function parsePublicEnvironment(value: unknown): PublicEnvironment {
	return Option.getOrElse(Schema.decodeUnknownOption(PublicEnvironment)(value), () => 'prod' as const)
}

/**
 * Type-safe environment variable access.
 * All VITE_PUBLIC_ prefixed vars are exposed to the client.
 * Env validation happens at build time in vite.config.ts
 */
export const env = {
	publicEnvironment: parsePublicEnvironment(import.meta.env.VITE_PUBLIC_ENVIRONMENT),
	VITE_PUBLIC_RIPTIDE_API_ORIGIN: import.meta.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN as string,
	VITE_PUBLIC_SYNC_ORIGIN: import.meta.env.VITE_PUBLIC_SYNC_ORIGIN as string,
	VITE_PUBLIC_WORKOS_CLIENT_ID: import.meta.env.VITE_PUBLIC_WORKOS_CLIENT_ID as string,
	/**
	 * Origin of the riptide-ui web app ('https://app.<domain>'), for links to
	 * pages this app does not host — a task's real page lives there, not here.
	 *
	 * OPTIONAL on purpose. It is unset in local dev and in the mock build, and a
	 * link that cannot be built is not worth failing a build over: callers fall
	 * back to a route inside this app. See `taskAppUrl`.
	 */
	VITE_PUBLIC_APP_ORIGIN: import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined,
	VITE_PUBLIC_WORKOS_FORCE_DEV_MODE: import.meta.env.VITE_PUBLIC_WORKOS_FORCE_DEV_MODE as
		| 'true'
		| 'false'
		| undefined,
	VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED: import.meta.env.VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED as
		| 'true'
		| 'false'
		| undefined,
	billingEnforcementEnabled: import.meta.env.VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED === 'true',
	VITE_PUBLIC_BLOCK_NEW_ORG_CREATION: import.meta.env.VITE_PUBLIC_BLOCK_NEW_ORG_CREATION as
		| 'true'
		| 'false'
		| undefined,
	blockNewOrgCreation: import.meta.env.VITE_PUBLIC_BLOCK_NEW_ORG_CREATION === 'true',
	DEV: import.meta.env.DEV,
	PROD: import.meta.env.PROD,
} as const
