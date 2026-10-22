import { env } from '@/env'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

/**
 * Returns true when billing UI surfaces should be visible.
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
 * re-renders when the preview toggle changes.
 */
export function useBillingVisible(): boolean {
	const billingPreviewEnabled = useSettingsStore((state) => state.billingPreviewEnabled)
	return env.billingEnforcementEnabled || billingPreviewEnabled
}
