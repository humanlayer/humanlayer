import { createFileRoute } from '@tanstack/react-router'

import { AgentSignInSettingsSection } from '@/components/settings/AgentSignInSettingsSection'

export const Route = createFileRoute('/settings/agent-sign-in')({
	component: AgentSignInSettingsSection,
})
