import type {
	EmailCapability,
	IntegrationCapabilities,
} from '@humanlayer/riptide-api-contract/api/integrations/get-capabilities'

export type { EmailCapability, IntegrationCapabilities }

/** The integrations whose cards show the shared "not set up" notice. */
export type ConnectableIntegration = 'slack' | 'github' | 'jira' | 'linear'

/**
 * What the settings page knows about this deployment.
 * - `checking`: the capabilities request has not answered yet.
 * - `known`: the server answered.
 * - `unknown`: the request failed (for example, an older API without the procedure). Cards then
 *   behave as they did before capabilities existed: every integration counts as set up, and the
 *   Email card is hidden because there is nothing true to say.
 */
export type CapabilitiesState =
	| { readonly status: 'checking' }
	| { readonly status: 'known'; readonly capabilities: IntegrationCapabilities }
	| { readonly status: 'unknown' }

export function capabilitiesStateFromQuery(query: {
	readonly data: IntegrationCapabilities | undefined
	readonly isError: boolean
}): CapabilitiesState {
	if (query.data) return { status: 'known', capabilities: query.data }
	if (query.isError) return { status: 'unknown' }
	return { status: 'checking' }
}

/** True once the page may start an integration's status polling. */
export function isIntegrationAvailable(state: CapabilitiesState, integration: ConnectableIntegration): boolean {
	if (state.status === 'checking') return false
	if (state.status === 'unknown') return true
	return state.capabilities[integration]
}

/** True only when the server said this integration is not set up. */
export function isIntegrationNotSetUp(state: CapabilitiesState, integration: ConnectableIntegration): boolean {
	return state.status === 'known' && !state.capabilities[integration]
}

/**
 * Billing surfaces show when the build turns enforcement on or the local preview toggle is on, and
 * never when the server reports that Stripe is not set up. While capabilities load or when the
 * request fails, the build flag and the toggle decide, as before.
 */
export function isBillingVisibleFor(input: {
	readonly enforcementEnabled: boolean
	readonly previewEnabled: boolean
	readonly billingConfigured: boolean | undefined
}): boolean {
	if (input.billingConfigured === false) return false
	return input.enforcementEnabled || input.previewEnabled
}
