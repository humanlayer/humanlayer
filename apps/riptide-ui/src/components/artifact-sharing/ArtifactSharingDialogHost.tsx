import { effectivePublicPermission } from '@humanlayer/db/artifact-public-permission'
import type { ArtifactPublicPermission } from '@humanlayer/db/artifact-public-permission'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useArtifactSharingDialogStore } from '@/hooks/stores/artifactSharingDialogStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useArtifactPublicPermissionMutation } from '@/hooks/useArtifactPublicPermissionMutation'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useUserInfo } from '@/hooks/useUserInfo'
import { copyAsyncTextToClipboard } from '@/lib/clipboard'
import { useRiptideApi } from '@/orpc/client'
import { getArtifactSharingUrl } from '@/utils/artifact-links'

import { trackArtifactPublicAccessChanged, trackArtifactShareLinkCopied } from './artifact-sharing-analytics'
import { ArtifactSharingDialog } from './ArtifactSharingDialog'

const toastOptions = { duration: 3000, closeButton: true } as const

export function ArtifactSharingDialogHost() {
	const target = useArtifactSharingDialogStore((state) => state.target)
	const open = useArtifactSharingDialogStore((state) => state.open)
	const setOpen = useArtifactSharingDialogStore((state) => state.setOpen)
	const { artifactsMetadataCollection, taskOrganizationAclsCollection, tasksCollection, taskUserAclsCollection } =
		useSync()
	const { userId } = useUserInfo()
	const { organizationId } = useBrowserAuth()
	const { queryClient } = useRiptideApi()
	const { data: organizationsData } = useQuery(
		queryClient.auth.user.organizations.list.queryOptions({ enabled: !!organizationId }),
	)
	const organizationName =
		organizationsData?.organizations.find((organization) => organization.organizationId === organizationId)
			?.organizationName ?? 'your organization'
	const publicSharingEnabled = useSettingsStore((state) => state.orgSettings.enableCreatingPubliclyShareableLinks)
	const permissionMutation = useArtifactPublicPermissionMutation()

	const { data: artifactRows } = useLiveQuery(
		(query) => {
			if (!target) return undefined
			return query
				.from({ artifact: artifactsMetadataCollection })
				.where(({ artifact }) => eq(artifact.id, target.artifactId))
		},
		[artifactsMetadataCollection, target?.artifactId],
	)
	const artifact = artifactRows?.[0]
	const taskId = artifact?.task_id
	const { data: taskRows } = useLiveQuery(
		(query) => {
			if (!taskId) return undefined
			return query.from({ task: tasksCollection }).where(({ task }) => eq(task.id, taskId))
		},
		[tasksCollection, taskId],
	)
	const task = taskRows?.[0]
	const taskPermissions = useTaskPermissions(
		task,
		userId ?? undefined,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)

	if (!target || !artifact) return null

	const permission = effectivePublicPermission(artifact, { publicLinksAllowed: publicSharingEnabled })
	const canCopy = permission === 'off' ? taskId !== null && taskId !== undefined : artifact.share_key !== null

	const handlePermissionChange = (nextPermission: ArtifactPublicPermission) => {
		if (nextPermission === permission || permissionMutation.isPending) return
		permissionMutation.mutate(
			{ artifactId: artifact.id, permission: nextPermission },
			{
				onSuccess: () => {
					trackArtifactPublicAccessChanged({
						artifactId: artifact.id,
						previousPermission: permission,
						newPermission: nextPermission,
						actorRelationship: taskPermissions.isOwner ? 'owner' : 'task_editor',
					})
				},
				onError: () => {
					toast.error('Could not change public access. Your previous setting was restored.', toastOptions)
				},
			},
		)
	}

	const handleCopyLink = async () => {
		if (!taskId) return
		const linkType = permission === 'off' ? 'authenticated' : 'public'
		const url = getArtifactSharingUrl(taskId, artifact.id, permission, artifact.share_key)
		if (!url) return
		try {
			await copyAsyncTextToClipboard(Promise.resolve(url))
			trackArtifactShareLinkCopied({
				artifactId: artifact.id,
				source: target.source,
				linkType,
				publicPermission: permission,
			})
			toast.success('Link copied', toastOptions)
		} catch {
			toast.error('Could not copy link. Copy it again.', toastOptions)
		}
	}

	return (
		<ArtifactSharingDialog
			open={open}
			fileName={artifact.file_name}
			organizationName={organizationName}
			permission={permission}
			canEditPermission={taskPermissions.canEditTask}
			publicSharingEnabled={publicSharingEnabled}
			isPending={permissionMutation.isPending}
			canCopy={canCopy}
			onOpenChange={setOpen}
			onPermissionChange={handlePermissionChange}
			onCopyLink={() => void handleCopyLink()}
		/>
	)
}
