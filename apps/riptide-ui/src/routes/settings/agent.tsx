import { createFileRoute } from '@tanstack/react-router'

import { AgentSettingsSection } from '@/components/settings/AgentSettingsSection'
import { useRedirectIfSettingsSectionHidden } from '@/components/settings/settings-sections'

export const Route = createFileRoute('/settings/agent')({
	component: AgentSettingsRoute,
})

function AgentSettingsRoute() {
	useRedirectIfSettingsSectionHidden('agent')
	return <AgentSettingsSection />
}
