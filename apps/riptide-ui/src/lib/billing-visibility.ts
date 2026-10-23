import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { buildConfig } from '@/lib/config'

/**
 * Hook variant for use inside React components.
 * Subscribes to the billingPreviewEnabled store slice so the component
 * re-renders when the preview toggle changes.
 */
export function useBillingVisible(): boolean {
	const billingPreviewEnabled = useSettingsStore((state) => state.billingPreviewEnabled)
	return buildConfig.billingEnforcementEnabled || billingPreviewEnabled
}
