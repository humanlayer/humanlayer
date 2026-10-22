import type { FC } from 'react'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { openCloudUrl } from '@/lib/url-opener'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

import { GitHubPermissionPrompt } from './GitHubPermissionPrompt'

const openOrgSettings = (event: React.MouseEvent) => {
	event.preventDefault()
	openCloudUrl(getOrgSettingsUrl())
}

export const WiredGitHubPermissionPrompt: FC = () => {
	const { roles } = useBrowserAuth()
	return (
		<GitHubPermissionPrompt
			isAdmin={roles?.includes('admin') ?? false}
			settingsUrl={getOrgSettingsUrl()}
			onOpenExternal={openOrgSettings}
		/>
	)
}
