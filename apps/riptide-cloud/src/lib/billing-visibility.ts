import { env } from '@/env'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useIntegrationCapabilities } from '@/hooks/useIntegrationCapabilities'
import { isBillingVisibleFor } from '@/lib/integration-capabilities'

/**
 * Returns true when billing UI surfaces should be visible, from the build flag and the preview
 * toggle alone. Prefer `useBillingVisible` in components: only the hook also hides billing when
 * the server reports that Stripe is not set up.
 *
 * Billing is visible when:
 * - Billing enforcement is enabled in the build (production/dev deployments), OR
 * - The user has opted into the local billing preview toggle
 */
export function isBillingVisible(): boolean {
	return env.billingEnforcementEnabled || useSettingsStore.getState().billingPreviewEnabled
}

/**
 * Hook variant for use inside React components.
 * Subscribes to the billingPreviewEnabled store slice so the component
 * re-renders when the preview toggle changes. Hides billing, even with the preview toggle on,
 * when the server reports that Stripe is not set up on this deployment.
 */
export function useBillingVisible(): boolean {
	const billingPreviewEnabled = useSettingsStore((state) => state.billingPreviewEnabled)
	const wantsBilling = env.billingEnforcementEnabled || billingPreviewEnabled
	// Ask the server only when the answer could change the result.
	const capabilities = useIntegrationCapabilities({ enabled: wantsBilling })
	return isBillingVisibleFor({
		enforcementEnabled: env.billingEnforcementEnabled,
		previewEnabled: billingPreviewEnabled,
		billingConfigured: capabilities.status === 'known' ? capabilities.capabilities.billing : undefined,
	})
}
