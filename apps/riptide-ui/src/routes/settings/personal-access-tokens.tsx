import { createFileRoute } from '@tanstack/react-router'

import { PersonalAccessTokensSettingsSection } from '@/components/settings/PersonalAccessTokensSettingsSection'

export const Route = createFileRoute('/settings/personal-access-tokens')({
	component: PersonalAccessTokensSettingsSection,
})
