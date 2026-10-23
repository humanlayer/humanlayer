import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type CloudSettingsTab = 'sync'
type SyncForceMode = 'auto' | 'electric' | 'query'

interface CloudSettingsState {
	// UI state (NOT persisted)
	isOpen: boolean
	activeTab: CloudSettingsTab

	// Sync force mode (NOT persisted - session-only override)
	syncForceMode: SyncForceMode

	// Experiments (local-only, persisted)
	billingPreviewEnabled: boolean

	// UI actions
	open: (tab?: CloudSettingsTab) => void
	close: () => void
	setActiveTab: (tab: CloudSettingsTab) => void

	// Sync force mode actions
	setSyncForceMode: (mode: SyncForceMode) => void

	// Experiments actions
	setBillingPreviewEnabled: (enabled: boolean) => void
}

export const useSettingsStore = create<CloudSettingsState>()(
	persist(
		(set) => ({
			// UI state
			isOpen: false,
			activeTab: 'sync',

			// Sync force mode
			syncForceMode: 'auto',

			// Experiments
			billingPreviewEnabled: false,

			// UI actions
			open: (tab) => set({ isOpen: true, activeTab: tab ?? 'sync' }),
			close: () => set({ isOpen: false }),
			setActiveTab: (tab) => set({ activeTab: tab }),

			// Sync force mode actions
			setSyncForceMode: (mode) => set({ syncForceMode: mode }),

			// Experiments actions
			setBillingPreviewEnabled: (enabled) => set({ billingPreviewEnabled: enabled }),
		}),
		{
			name: 'riptide-cloud-settings',
			partialize: (state) => ({
				billingPreviewEnabled: state.billingPreviewEnabled,
			}),
		},
	),
)
