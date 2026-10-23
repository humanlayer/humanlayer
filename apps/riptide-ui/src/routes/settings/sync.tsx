import { createFileRoute } from '@tanstack/react-router'

import { SyncSettingsSection } from '@/components/settings/SyncSettingsSection'

export const Route = createFileRoute('/settings/sync')({
	component: SyncSettingsRoute,
})

function SyncSettingsRoute() {
	return <SyncSettingsSection />
}
