import { useOptimisticMutation } from '@/hooks/useOptimisticMutation'
import { useSharingActions } from '@/hooks/useSharingActions'

export function useArtifactPublicPermissionMutation() {
	const { updateArtifactSharing } = useSharingActions()
	return useOptimisticMutation(updateArtifactSharing)
}
