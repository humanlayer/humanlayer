import { createFileRoute } from '@tanstack/react-router'

import { KeybindingsSettingsSection } from '@/components/settings/KeybindingsSettingsSection'

export const Route = createFileRoute('/settings/keybindings')({
	component: KeybindingsSettingsRoute,
})

function KeybindingsSettingsRoute() {
	return <KeybindingsSettingsSection />
}
