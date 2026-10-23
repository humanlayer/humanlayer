import { createFileRoute } from '@tanstack/react-router'

import { ExperimentsSettingsSection } from '@/components/settings/ExperimentsSettingsSection'

export const Route = createFileRoute('/settings/experiments')({
	component: ExperimentsSettingsRoute,
})

function ExperimentsSettingsRoute() {
	return <ExperimentsSettingsSection />
}
