import { createFileRoute } from '@tanstack/react-router'

import { DaemonsSettingsSection } from '@/components/settings/DaemonsSettingsSection'

export const Route = createFileRoute('/settings/daemons')({
	component: DaemonsSettingsRoute,
})

function DaemonsSettingsRoute() {
	return <DaemonsSettingsSection />
}
