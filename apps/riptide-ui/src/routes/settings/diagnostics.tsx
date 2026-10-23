import { createFileRoute } from '@tanstack/react-router'

import { DiagnosticsSettingsSection } from '@/components/settings/DiagnosticsSettingsSection'

export const Route = createFileRoute('/settings/diagnostics')({
	component: DiagnosticsSettingsRoute,
})

function DiagnosticsSettingsRoute() {
	return <DiagnosticsSettingsSection />
}
