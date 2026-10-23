import { effectivePublicPermission } from '@humanlayer/db/artifact-public-permission'
import { useCallback } from 'react'

import { trackArtifactSharingDialogOpened } from '@/components/artifact-sharing/artifact-sharing-analytics'
import { useSync } from '@/components/providers/SyncProvider'
import {
	type ArtifactSharingDialogTarget,
	useArtifactSharingDialogStore,
} from '@/hooks/stores/artifactSharingDialogStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

export function useArtifactSharingDialog() {
	const { artifactsMetadataCollection } = useSync()
	const openDialog = useArtifactSharingDialogStore((state) => state.openDialog)
	const openSharingDialog = useCallback(
		(target: ArtifactSharingDialogTarget) => {
			const artifact = artifactsMetadataCollection.state.get(target.artifactId)
			trackArtifactSharingDialogOpened({
				artifactId: target.artifactId,
				source: target.source,
				publicPermission: artifact
					? effectivePublicPermission(artifact, {
							publicLinksAllowed:
								useSettingsStore.getState().orgSettings.enableCreatingPubliclyShareableLinks,
						})
					: 'off',
			})
			openDialog(target)
		},
		[artifactsMetadataCollection, openDialog],
	)
	return { openSharingDialog }
}
