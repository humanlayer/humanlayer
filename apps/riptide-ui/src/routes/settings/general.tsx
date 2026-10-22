import { createFileRoute } from '@tanstack/react-router'

import { GeneralSettingsSection } from '@/components/settings/GeneralSettingsSection'

export const Route = createFileRoute('/settings/general')({
	component: GeneralSettingsRoute,
})

function GeneralSettingsRoute() {
	return <GeneralSettingsSection />
}
