import { createFileRoute } from '@tanstack/react-router'

import { TipsSettingsSection } from '@/components/settings/TipsSettingsSection'

export const Route = createFileRoute('/settings/tips')({
	component: TipsSettingsRoute,
})

function TipsSettingsRoute() {
	return <TipsSettingsSection />
}
