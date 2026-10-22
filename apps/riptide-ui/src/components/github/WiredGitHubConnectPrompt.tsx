import type { FC } from 'react'

import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'
import { openCloudUrl } from '@/lib/url-opener'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

import { type GitHubConnectReason, GitHubConnectPrompt } from './GitHubConnectPrompt'

const openOrgSettings = (event: React.MouseEvent) => {
	event.preventDefault()
	openCloudUrl(getOrgSettingsUrl())
}

export const WiredGitHubConnectPrompt: FC<{
	reason: GitHubConnectReason
	isAdmin: boolean
	repositories?: readonly string[]
}> = ({ reason, isAdmin, repositories }) => {
	const connect = useConnectIntegrationAction()
	const openSettings = () => openCloudUrl(getOrgSettingsUrl())
	const onAction = reason === 'repositories_without_app' ? openSettings : () => void connect('github')
	return (
		<GitHubConnectPrompt
			reason={reason}
			isAdmin={isAdmin}
			settingsUrl={getOrgSettingsUrl()}
			repositories={repositories}
			onOpenExternal={openOrgSettings}
			onAction={onAction}
		/>
	)
}
