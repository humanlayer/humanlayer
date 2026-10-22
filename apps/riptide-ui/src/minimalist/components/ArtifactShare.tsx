import { type ArtifactPublicPermission, effectivePublicPermission } from '@humanlayer/db/artifact-public-permission'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useRef, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useArtifactPublicPermissionMutation } from '@/hooks/useArtifactPublicPermissionMutation'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { useUi } from '@/minimalist/lib/ui-state'
import { useCopy } from '@/minimalist/lib/use-copy'
import { getArtifactSharingUrl } from '@/utils/artifact-links'

const ACCESS: Array<{ value: ArtifactPublicPermission; label: string; detail: string }> = [
	{ value: 'off', label: 'Only your organization', detail: 'People in the organization who can see the task' },
	{ value: 'view', label: 'Anyone with the link can view', detail: 'No sign-in needed' },
	{ value: 'comment', label: 'Anyone with the link can comment', detail: 'Their comments come back here' },
]

/** Who can open the artifact's link, and the link itself. */
export function ArtifactShare({ artifactId, taskId }: { artifactId: string; taskId: string }) {
	const { artifactsMetadataCollection: artifacts } = useSync()
	const publicLinksAllowed = useSettingsStore((state) => state.orgSettings.enableCreatingPubliclyShareableLinks)
	const permissionMutation = useArtifactPublicPermissionMutation()
	const { showToast } = useUi()
	const copy = useCopy()
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const { data } = useLiveQuery(
		(q) => q.from({ artifact: artifacts }).where(({ artifact }) => eq(artifact.id, artifactId)),
		[artifacts, artifactId],
	)
	const row = data?.[0]
	if (!row) return null
	const permission = effectivePublicPermission(row, { publicLinksAllowed })
	const url = getArtifactSharingUrl(taskId, artifactId, permission, row.share_key)

	return (
		<>
			<button type="button" ref={anchor} className="btn ghost sm" onClick={() => setOpen(true)}>
				Share
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below-end" width={290}>
				<MenuLabel>Who can open the link</MenuLabel>
				{ACCESS.map((option) => (
					<MenuItem
						key={option.value}
						label={option.label}
						detail={option.detail}
						checked={permission === option.value}
						disabled={permissionMutation.isPending || (option.value !== 'off' && !publicLinksAllowed)}
						onSelect={() => {
							if (option.value === permission) return
							permissionMutation.mutate(
								{ artifactId, permission: option.value },
								{
									onError: () =>
										showToast(
											'Could not change who can open the link. The previous setting is back.',
										),
								},
							)
						}}
					/>
				))}
				{publicLinksAllowed ? null : (
					<div className="note">An admin turned off public links for this organization.</div>
				)}
				<MenuSeparator />
				<MenuItem
					label="Copy link"
					disabled={!url}
					onSelect={() => {
						setOpen(false)
						if (!url) return
						copy(url, 'Link copied', 'Could not copy the link. Try again.')
					}}
				/>
			</Menu>
		</>
	)
}
