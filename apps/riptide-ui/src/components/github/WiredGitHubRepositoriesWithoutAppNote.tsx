import type { FC } from 'react'

import { openCloudUrl } from '@/lib/url-opener'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

import { GitHubRepositoriesWithoutAppNote } from './GitHubRepositoriesWithoutAppNote'

export const WiredGitHubRepositoriesWithoutAppNote: FC<{ repositories: readonly string[]; isAdmin: boolean }> = ({
	repositories,
	isAdmin,
}) => {
	return (
		<GitHubRepositoriesWithoutAppNote
			repositories={repositories}
			isAdmin={isAdmin}
			onOpenSettings={() => openCloudUrl(getOrgSettingsUrl())}
		/>
	)
}
