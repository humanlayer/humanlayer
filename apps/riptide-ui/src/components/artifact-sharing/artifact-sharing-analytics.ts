import type { ArtifactPublicPermission } from '@humanlayer/db/artifact-public-permission'

import type { ArtifactSharingDialogSource } from '@/hooks/stores/artifactSharingDialogStore'
import { capturePostHogEvent } from '@/integrations/posthog/posthog'

export function trackArtifactSharingDialogOpened(input: {
	artifactId: string
	source: ArtifactSharingDialogSource
	publicPermission: ArtifactPublicPermission
}) {
	capturePostHogEvent('artifact_sharing_dialog_opened', {
		artifact_id: input.artifactId,
		source: input.source,
		public_permission: input.publicPermission,
	})
}

export function trackArtifactPublicAccessChanged(input: {
	artifactId: string
	previousPermission: ArtifactPublicPermission
	newPermission: ArtifactPublicPermission
	actorRelationship: 'owner' | 'task_editor'
}) {
	capturePostHogEvent('artifact_public_access_changed', {
		artifact_id: input.artifactId,
		previous_permission: input.previousPermission,
		new_permission: input.newPermission,
		actor_relationship: input.actorRelationship,
	})
}

export function trackArtifactShareLinkCopied(input: {
	artifactId: string
	source: ArtifactSharingDialogSource
	linkType: 'authenticated' | 'public'
	publicPermission: ArtifactPublicPermission
}) {
	capturePostHogEvent('artifact_share_link_copied', {
		artifact_id: input.artifactId,
		source: input.source,
		link_type: input.linkType,
		public_permission: input.publicPermission,
	})
}
