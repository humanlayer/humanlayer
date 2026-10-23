import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DiagnosticState {
	artifactSidePanelTraceEnabled: boolean
	setArtifactSidePanelTraceEnabled: (enabled: boolean) => void
}

export const useDiagnosticStore = create<DiagnosticState>()(
	persist(
		(set) => ({
			artifactSidePanelTraceEnabled: false,
			setArtifactSidePanelTraceEnabled: (enabled) => set({ artifactSidePanelTraceEnabled: enabled }),
		}),
		{
			name: 'riptide-diagnostics',
			version: 1,
			partialize: (state) => ({ artifactSidePanelTraceEnabled: state.artifactSidePanelTraceEnabled }),
		},
	),
)
